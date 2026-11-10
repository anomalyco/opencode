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
// start.
type Subagent = {
  id: string
  type: "subagent"
  sessionID: string
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
          if (part.type !== "tool" || part.state.status !== "running" || part.name !== "shell") return []

          return [
            {
              type: "shell" as const,
              partID: part.id,
              id: text(part.state.metadata.shellID),
              label: text(part.state.input.command),
              agent: undefined,
              started: part.time.ran ?? part.time.created,
            },
          ]
        }) ?? [],
    }
  })

  const blocking = createMemo(() => history().blocking)

  // Like the TUI, a subagent runs exactly while its session, or any session below it, is running. Subagents always run
  // in the background, so every running descendant is background work.
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

    // The latest call for a child names it; its own session decides whether it still runs.
    return sessions.flatMap((info): Subagent[] => {
      if (input.status(info.id) !== "running" || !descends(info.id)) return []
      const latest = current.calls.get(info.id)

      return [
        {
          id: info.id,
          type: "subagent",
          sessionID: info.id,
          label: latest?.label ?? info.title ?? info.id,
          agent: latest?.agent,
          started: latest?.started ?? info.time.created,
        },
      ]
    })
  })

  // Background work: every running subagent, and the session's live shells outside its blocking calls.
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

    return [...subagents().map((task) => ({ ...task, label: task.label ?? task.id })), ...shells]
  })

  return { blocking, subagents, tasks }
}
