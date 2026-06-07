import type { Event, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import { bootstrapSessionData, createSessionData, reduceSessionData, type SessionData } from "./session-data"
import { messagePrompt, type SessionMessages } from "./session.shared"
import { messageTurnSummaryCommit } from "./turn-summary"
import type { FooterPatch, LocalReplayRow, RunProvider, StreamCommit } from "./types"

type ReplayInput = {
  messages: SessionMessages
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  thinking: boolean
  limits: Record<string, number>
  providers?: RunProvider[]
}

type ReplayConfig = {
  limits: Record<string, number>
  providers?: RunProvider[]
  summaries: ReadonlySet<string>
}

export type SessionReplay = {
  data: SessionData
  commits: StreamCommit[]
  patch?: FooterPatch
}

type ReplayMessage = {
  commits: StreamCommit[]
  patch?: FooterPatch
}

const SHELL_SYNTHETIC_USER_TEXT = "The following tool was executed by the user"

function apply(data: SessionData, event: Event, sessionID: string, thinking: boolean, limits: Record<string, number>) {
  return reduceSessionData({
    data,
    event,
    sessionID,
    thinking,
    limits,
  })
}

function mergePatch(left: FooterPatch | undefined, right: FooterPatch | undefined) {
  if (!left) {
    return right
  }

  if (!right) {
    return left
  }

  return {
    ...left,
    ...right,
  }
}

function active(data: SessionData) {
  return data.part.size > 0 || data.tools.size > 0
}

function replayPatch(data: SessionData, patch: FooterPatch | undefined) {
  if (active(data)) {
    if (!patch) {
      return {
        phase: "running",
      } satisfies FooterPatch
    }

    return {
      ...patch,
      phase: "running",
    } satisfies FooterPatch
  }

  if (data.permissions.length > 0 || data.questions.length > 0) {
    if (!patch) {
      return {
        phase: "idle",
      } satisfies FooterPatch
    }

    return {
      ...patch,
      phase: "idle",
    } satisfies FooterPatch
  }

  if (!patch) {
    return undefined
  }

  return {
    ...patch,
    phase: "idle",
    status: "",
  } satisfies FooterPatch
}

function isShellSyntheticUser(message: SessionMessages[number]) {
  if (message.info.role !== "user") {
    return false
  }

  const prompt = messagePrompt(message)
  return (
    !prompt.text.trim() &&
    prompt.parts.length === 0 &&
    message.parts.some((part) => part.type === "text" && part.synthetic && part.text === SHELL_SYNTHETIC_USER_TEXT)
  )
}

function isShellSyntheticAssistant(message: SessionMessages[number], shellParents: ReadonlySet<string>) {
  return (
    message.info.role === "assistant" &&
    shellParents.has(message.info.parentID) &&
    message.parts.some((part) => part.type === "tool" && part.tool === "bash")
  )
}

function summaryMessageIDs(messages: SessionMessages): ReadonlySet<string> {
  const shellParents = new Set(messages.filter(isShellSyntheticUser).map((message) => message.info.id))
  const parents = new Set<string>()
  const summaries = new Set<string>()

  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx]
    if (!message || message.info.role !== "assistant") {
      continue
    }

    if (isShellSyntheticAssistant(message, shellParents)) {
      continue
    }

    if (parents.has(message.info.parentID)) {
      continue
    }

    parents.add(message.info.parentID)

    const completed = message.info.time.completed
    if (typeof completed === "number" && completed > message.info.time.created) {
      summaries.add(message.info.id)
    }
  }

  return summaries
}

function replayMessage(
  data: SessionData,
  message: SessionMessages[number],
  thinking: boolean,
  config: ReplayConfig,
): ReplayMessage {
  if (message.info.role === "user") {
    const prompt = messagePrompt(message)
    if (!prompt.text.trim()) {
      return {
        commits: [],
      }
    }

    return {
      commits: [
        {
          kind: "user",
          text: prompt.text,
          phase: "start",
          source: "system",
          messageID: message.info.id,
        },
      ],
    }
  }

  const commits: StreamCommit[] = []
  let patch: FooterPatch | undefined

  const info = apply(
    data,
    {
      id: `bootstrap:message:${message.info.id}`,
      type: "message.updated",
      properties: {
        sessionID: message.info.sessionID,
        info: message.info,
      },
    },
    message.info.sessionID,
    thinking,
    config.limits,
  )
  commits.push(...info.commits)
  patch = mergePatch(patch, info.footer?.patch)

  for (const part of message.parts) {
    const next = apply(
      data,
      {
        id: `bootstrap:part:${part.id}`,
        type: "message.part.updated",
        properties: {
          sessionID: part.sessionID,
          part,
          time: 0,
        },
      },
      message.info.sessionID,
      thinking,
      config.limits,
    )
    patch = mergePatch(patch, next.footer?.patch)
    commits.push(...next.commits)
  }

  const summary = config.summaries.has(message.info.id)
    ? messageTurnSummaryCommit(message, config.providers)
    : undefined
  if (summary) {
    commits.push(summary)
  }

  return {
    commits,
    patch,
  }
}

export function replaySession(input: ReplayInput): SessionReplay {
  const data = createSessionData()
  const commits: StreamCommit[] = []
  let patch: FooterPatch | undefined
  const summaries = summaryMessageIDs(input.messages)

  bootstrapSessionData({
    data,
    messages: input.messages,
    permissions: input.permissions,
    questions: input.questions,
  })

  for (const message of input.messages) {
    const next = replayMessage(data, message, input.thinking, {
      limits: input.limits,
      providers: input.providers,
      summaries,
    })
    commits.push(...next.commits)
    patch = mergePatch(patch, next.patch)
  }

  return {
    data,
    commits,
    patch: replayPatch(data, patch),
  }
}

export function replayLocalRows(
  messages: SessionMessages,
  commits: StreamCommit[],
  rows: LocalReplayRow[],
): StreamCommit[] {
  const persisted = new Set(messages.map((message) => message.info.id))
  return rows.reduce((out, local) => {
    const row = local.commit
    if (row.kind === "user" && row.messageID && persisted.has(row.messageID)) {
      return out
    }

    if (!row.messageID) {
      return [...out, row]
    }

    const exact = local.after
      ? out.findIndex(
          (commit) =>
            commit.kind === local.after?.kind &&
            commit.text === local.after.text &&
            commit.phase === local.after.phase &&
            commit.toolState === local.after.toolState &&
            (local.after.partID ? commit.partID === local.after.partID : commit.messageID === local.after.messageID),
        )
      : -1
    const anchored =
      exact !== -1
        ? exact
        : local.after
          ? out.findLastIndex((commit) =>
              local.after?.partID
                ? commit.partID === local.after.partID
                : commit.kind === local.after?.kind && commit.messageID === local.after.messageID,
            )
          : -1
    if (anchored !== -1) {
      const commit = out[anchored]
      const visible = local.after?.visible
      if (commit && visible && commit.text.startsWith(visible) && commit.text.length > visible.length) {
        return [
          ...out.slice(0, anchored),
          { ...commit, text: visible },
          row,
          { ...commit, text: commit.text.slice(visible.length) },
          ...out.slice(anchored + 1),
        ]
      }

      return [...out.slice(0, anchored + 1), row, ...out.slice(anchored + 1)]
    }

    const after = out.findIndex((commit) => commit.kind === "user" && commit.messageID === row.messageID)
    if (after !== -1) {
      return [...out.slice(0, after + 1), row, ...out.slice(after + 1)]
    }

    const before = out.findIndex((commit) => commit.messageID && row.messageID! < commit.messageID)
    if (before === -1) {
      return [...out, row]
    }

    return [...out.slice(0, before), row, ...out.slice(before)]
  }, commits)
}

export function replayActiveText(data: SessionData, current: SessionData): StreamCommit[] {
  return [...current.part.entries()].flatMap(([partID, kind]) => {
    if (kind === "user" || current.end.has(partID) || data.ids.has(partID)) {
      return []
    }

    const text = current.text.get(partID) ?? ""
    const existing = data.text.get(partID) ?? ""
    const sent = current.sent.get(partID) ?? 0
    const existingSent = data.sent.get(partID) ?? 0
    const visible = current.visible.get(partID) ?? ""
    const existingVisible = data.visible.get(partID) ?? ""
    if (!text.startsWith(existing) || existingSent > sent || !visible.startsWith(existingVisible)) {
      return []
    }

    data.part.set(partID, kind)
    data.text.set(partID, text)
    data.sent.set(partID, sent)
    data.visible.set(partID, visible)
    const messageID = current.msg.get(partID)
    if (messageID) {
      data.msg.set(partID, messageID)
      const role = current.role.get(messageID)
      if (role) {
        data.role.set(messageID, role)
      }
    }

    const chunk = visible.slice(existingVisible.length)
    if (!chunk) {
      return []
    }

    return [
      {
        kind,
        text: chunk,
        phase: "progress",
        source: kind,
        ...(messageID ? { messageID } : {}),
        partID,
      },
    ] satisfies StreamCommit[]
  })
}
