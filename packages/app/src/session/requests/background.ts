import type {
  JsonValue,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  ShellInfo,
} from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { createMemo } from "solid-js"

// `started` is when the work began running: the latest call's run time, the child session's creation, or the shell's
// start. A subagent's `partID` names the call that still blocks the run.
type Subagent = {
  id: string
  type: "subagent"
  sessionID: string | undefined
  partID: string | undefined
  label: string | undefined
  agent?: string
  started: number
}

type Task =
  | (Omit<Subagent, "label"> & { label: string })
  | { id: string; type: "shell"; label: string; started: number }

const decodeString = Schema.decodeUnknownOption(Schema.String)

// Tool input and metadata are open JSON, so a field of the wrong type reads as absent.
const text = (value: JsonValue | undefined) => Option.getOrUndefined(decodeString(value))

export function createSessionBackground(input: {
  sessionID: () => string | undefined
  messages: (id: string) => SessionMessageInfo[]
  sessions: () => SessionInfo[]
  status: (id: string) => "idle" | "running"
  shells: () => ShellInfo[]
}) {
  const history = createMemo(() => {
    // The latest call for each child names it; calls never decide whether it still runs.
    const calls = new Map<string, { label: string | undefined; agent: string | undefined; started: number }>()
    const id = input.sessionID()

    const assistant = (id ? input.messages(id) : []).reduce<SessionMessageAssistant | undefined>((latest, message) => {
      if (message.type !== "assistant") return latest
      message.content.forEach((part) => {
        if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") return
        const sessionID = text(part.state.metadata?.sessionID)

        if (!sessionID) return
        calls.set(sessionID, {
          label: text(part.state.input.description),
          agent: text(part.state.input.agent),
          started: part.time.ran ?? part.time.created,
        })
      })

      return message.time.completed === undefined ? message : latest
    }, undefined)

    return {
      calls,
      blocking:
        assistant?.content.flatMap((part) => {
          if (part.type !== "tool" || part.state.status !== "running") return []

          if (part.name !== "shell" && part.name !== "subagent") return []
          const shell = part.name === "shell"

          return [
            {
              type: shell ? ("shell" as const) : ("subagent" as const),
              partID: part.id,
              id: text(shell ? part.state.metadata.shellID : part.state.metadata.sessionID),
              label: text(shell ? part.state.input.command : part.state.input.description),
              agent: shell ? undefined : text(part.state.input.agent),
              started: part.time.ran ?? part.time.created,
            },
          ]
        }) ?? [],
    }
  })

  const blocking = createMemo(() => history().blocking)

  // Like the TUI, a subagent runs exactly while its session, or any session below it, is running. A blocking call
  // stands in only until its child session is known.
  const subagents = createMemo(() => {
    const id = input.sessionID()

    if (!id) return []
    const current = history()
    const sessions = input.sessions()
    const parents = new Map(sessions.map((info) => [info.id, info.parentID]))

    const descends = (sessionID: string) => {
      const seen = new Set<string>()
      let parentID = parents.get(sessionID)

      while (parentID && !seen.has(parentID)) {
        if (parentID === id) return true
        seen.add(parentID)
        parentID = parents.get(parentID)
      }

      return false
    }

    // A call names its child once the child exists; until the call reports it, the child's title is its description.
    const calls = current.blocking.flatMap((item) => (item.type === "subagent" ? [item] : []))

    const child = (item: (typeof calls)[number], info: SessionInfo) =>
      item.id ? info.id === item.id : !!item.label && info.parentID === id && info.title === item.label

    const running = sessions.flatMap((info): Subagent[] => {
      if (input.status(info.id) !== "running" || !descends(info.id)) return []
      const latest = current.calls.get(info.id)

      return [
        {
          id: info.id,
          type: "subagent",
          sessionID: info.id,
          partID: calls.find((item) => child(item, info))?.partID,
          label: latest?.label ?? info.title ?? info.id,
          agent: latest?.agent,
          started: latest?.started ?? info.time.created,
        },
      ]
    })

    const pending = calls.flatMap((item): Subagent[] =>
      sessions.some((info) => child(item, info))
        ? []
        : [
            {
              id: item.id ?? item.partID,
              type: "subagent",
              sessionID: item.id,
              partID: item.partID,
              label: item.label,
              agent: item.agent,
              started: item.started,
            },
          ],
    )

    // Work that blocks the run comes before work already in the background.
    return [...pending, ...running.filter((task) => task.partID), ...running.filter((task) => !task.partID)]
  })

  // Background work: running subagents whose call no longer blocks the run, and the session's live shells outside
  // its blocking calls.
  const tasks = createMemo((): Task[] => {
    const id = input.sessionID()

    if (!id) return []
    const current = history()

    const shells = input.shells().flatMap((shell) => {
      if (shell.status !== "running" || shell.metadata.sessionID !== id) return []

      if (
        current.blocking.some(
          (item) => item.type === "shell" && (item.id === shell.id || (!!item.label && shell.command === item.label)),
        )
      )
        return []

      return [{ id: shell.id, type: "shell" as const, label: shell.command, started: shell.time.started }]
    })

    return [
      ...subagents().flatMap((task) => (task.partID ? [] : [{ ...task, label: task.label ?? task.id }])),
      ...shells,
    ]
  })

  return { blocking, subagents, tasks }
}
