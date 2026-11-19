import type {
  JobInfo,
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
  label: string
  agent?: string
  started: number
}

type Task = Subagent | { id: string; type: "shell"; label: string; started: number }

type Script = { id: string; type: "script"; label: string; started: number }

const decodeString = Schema.decodeUnknownOption(Schema.String)

// A script's calls stream through its execute call's metadata.
const decodeCall = Schema.decodeUnknownOption(
  Schema.Struct({
    tool: Schema.String,
    status: Schema.String,
    input: Schema.Struct({ command: Schema.String }),
  }),
)

// Tool input and metadata are open JSON, so a field of the wrong type reads as absent.
const text = (value: JsonValue | undefined) => Option.getOrUndefined(decodeString(value))

export function createSessionBackground(input: {
  sessionID: () => string | undefined
  messages: (id: string) => SessionMessageInfo[]
  sessions: () => SessionInfo[]
  status: (id: string) => "idle" | "running"
  shells: () => ShellInfo[]
  // The session's running Code Mode jobs, which only list scripts moved to the background.
  jobs: () => readonly JobInfo[]
}) {
  const history = createMemo(() => {
    // The latest call for each child names it; calls never decide whether it still runs.
    const calls = new Map<string, { label: string | undefined; agent: string | undefined; started: number }>()
    // A script moved to the background ends its execute call with the job's id; its first line names it.
    const scripts = new Map<string, { label: string | undefined; started: number }>()
    const finished = new Set<string>()
    const id = input.sessionID()

    const assistant = (id ? input.messages(id) : []).reduce<SessionMessageAssistant | undefined>((latest, message) => {
      // A background script reports its result as a synthetic message carrying its job's id.
      if (message.type === "synthetic") {
        const jobID = text(message.metadata?.jobID)

        if (jobID) finished.add(jobID)
      }

      if (message.type !== "assistant") return latest
      message.content.forEach((part) => {
        if (part.type === "tool" && part.name === "execute" && part.state.status === "completed") {
          const jobID = text(part.state.metadata?.jobID)

          if (jobID)
            scripts.set(jobID, {
              label: firstLine(text(part.state.input.code)),
              started: part.time.ran ?? part.time.created,
            })
        }

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
      scripts,
      finished,
      blocking:
        assistant?.content.flatMap((part) => {
          if (part.type !== "tool" || part.state.status !== "running") return []

          // A script in the foreground blocks the turn, and so do the shells it is running.
          if (part.name === "execute")
            return [
              {
                type: "execute" as const,
                partID: part.id,
                id: undefined,
                label: firstLine(text(part.state.input.code)),
                agent: undefined,
                started: part.time.ran ?? part.time.created,
                commands: executeShellCommands(part.state.metadata.toolCalls),
              },
            ]

          if (part.name !== "shell") return []

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
        current.blocking.some((item) =>
          item.type === "shell"
            ? item.id === shell.id || (!!item.label && shell.command === item.label)
            : shell.time.started >= item.started && item.commands.includes(shell.command),
        )
      )
        return []

      return [{ id: shell.id, type: "shell" as const, label: shell.command, started: shell.time.started }]
    })

    return [...subagents(), ...shells]
  })

  // Scripts moved to the background, while their job runs. A script's result message ends it before the job list
  // catches up.
  const scripts = createMemo((): Script[] => {
    const id = input.sessionID()

    if (!id) return []
    const current = history()

    return input.jobs().flatMap((job) => {
      if (job.kind !== "codemode" || job.status !== "running" || job.sessionID !== id || current.finished.has(job.id))
        return []
      const call = current.scripts.get(job.id)

      return [{ id: job.id, type: "script" as const, label: call?.label ?? job.id, started: job.time.started }]
    })
  })

  // Scripts that ended their call in the background and have not reported back, so the job list is worth asking.
  const pending = createMemo(() => {
    const current = history()

    return [...current.scripts.keys()].filter((jobID) => !current.finished.has(jobID))
  })

  return { blocking, tasks, scripts, pending }
}

function firstLine(code: string | undefined) {
  return code
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

// The commands of the shells a running script has started and not finished.
function executeShellCommands(calls: JsonValue | undefined) {
  if (!Array.isArray(calls)) return []

  return calls.flatMap((call) =>
    Option.match(decodeCall(call), {
      onNone: () => [],
      onSome: (item) => (item.tool === "shell" && item.status === "running" ? [item.input.command] : []),
    }),
  )
}
