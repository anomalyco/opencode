import type { Event, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import { bootstrapSessionData, createSessionData, reduceSessionData, type SessionData } from "./session-data"
import { messagePrompt, type SessionMessages } from "./session.shared"
import type { FooterPatch, StreamCommit } from "./types"

type ReplayInput = {
  messages: SessionMessages
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  thinking: boolean
  limits: Record<string, number>
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

function replayMessage(
  data: SessionData,
  message: SessionMessages[number],
  thinking: boolean,
  limits: Record<string, number>,
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
    limits,
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
      limits,
    )
    patch = mergePatch(patch, next.footer?.patch)
    commits.push(...next.commits)
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

  bootstrapSessionData({
    data,
    messages: input.messages,
    permissions: input.permissions,
    questions: input.questions,
  })

  for (const message of input.messages) {
    const next = replayMessage(data, message, input.thinking, input.limits)
    commits.push(...next.commits)
    patch = mergePatch(patch, next.patch)
  }

  return {
    data,
    commits,
    patch: replayPatch(data, patch),
  }
}

export function replayLocalRows(messages: SessionMessages, commits: StreamCommit[], rows: StreamCommit[]): StreamCommit[] {
  const persisted = new Set(messages.map((message) => message.info.id))
  return rows.reduce((out, row) => {
    if (row.kind === "user" && row.messageID && persisted.has(row.messageID)) {
      return out
    }

    if (!row.messageID) {
      return [...out, row]
    }

    if (persisted.has(row.messageID)) {
      const after = out.findLastIndex((commit) => commit.messageID === row.messageID)
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
