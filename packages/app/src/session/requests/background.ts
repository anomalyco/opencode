import type { SessionInfo, SessionMessageAssistant, SessionMessageInfo, ShellInfo } from "@opencode/client/promise"
import { scanSubagentTranscript } from "@opencode/session-ui/subagent-transcript"
import { Predicate } from "effect"
import { createMemo } from "solid-js"

type Task =
  | { id: string; type: "subagent"; label: string; agent?: string }
  | { id: string; type: "shell"; label: string }

export function createSessionBackground(input: {
  sessionID: () => string | undefined
  messages: (id: string) => SessionMessageInfo[]
  sessions: () => SessionInfo[]
  status: (id: string) => "idle" | "running"
  shells: () => ShellInfo[]
}) {
  const history = createMemo(() => {
    const completed = new Set<string>()
    const shells: { partID: string; task: { id: string; type: "shell"; label: string } }[] = []
    const id = input.sessionID()
    const messages = id ? input.messages(id) : []
    const scan = scanSubagentTranscript(messages)

    for (const childID of scan.completed) completed.add(childID)

    for (const message of messages) {
      if (message.type !== "synthetic") continue

      if (message.metadata?.source === "shell") {
        if (Predicate.isString(message.metadata.shellID)) completed.add(message.metadata.shellID)

        if (Predicate.isString(message.metadata.jobID)) completed.add(message.metadata.jobID)
      }
    }

    const subagents = scan.calls.flatMap((call) => {
      if (!call.backgrounded || !call.childID || completed.has(call.childID)) return []

      return [
        {
          id: call.childID,
          type: "subagent" as const,
          label: call.description ?? call.childID,
          agent: call.agent,
        },
      ]
    })

    const assistant = messages.reduce<SessionMessageAssistant | undefined>((latest, message) => {
      if (message.type === "synthetic") return latest

      if (message.type !== "assistant") return latest
      message.content.forEach((part) => {
        if (part.type !== "tool" || part.name !== "shell") return

        if (part.state.status !== "completed" || part.state.metadata?.status !== "running") return

        const shellID = part.state.metadata.shellID
        const command = part.state.input.command
        shells.push({
          partID: part.id,
          task: {
            id: Predicate.isString(shellID) ? shellID : part.id,
            type: "shell",
            label: Predicate.isString(command) ? command : part.id,
          },
        })
      })

      return message.time.completed === undefined ? message : latest
    }, undefined)

    return {
      // Backgrounded calls stay listed until their synthetic completion notice lands (filtered at construction).
      subagents,
      shells: shells.flatMap((item) =>
        !completed.has(item.partID) && !completed.has(item.task.id) ? [item.task] : [],
      ),
      blocking:
        assistant?.content.flatMap((part) => {
          if (part.type !== "tool" || part.state.status !== "running") return []

          if (part.name !== "shell" && part.name !== "subagent") return []
          const value = part.name === "shell" ? part.state.metadata.shellID : part.state.metadata.sessionID
          const label = part.name === "shell" ? part.state.input.command : part.state.input.description

          return [
            {
              // SAFETY: the guard above leaves only "shell" and "subagent" names.
              // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- see SAFETY above
              type: part.name as "shell" | "subagent",
              partID: part.id,
              id: Predicate.isString(value) ? value : undefined,
              label: Predicate.isString(label) ? label : undefined,
            },
          ]
        }) ?? [],
    }
  })

  const blocking = createMemo(() => history().blocking)

  const tasks = createMemo(() => {
    const id = input.sessionID()

    if (!id) return []
    const current = history()

    const active = input.sessions().flatMap((info) => {
      if (info?.parentID !== id) return []

      if (input.status(info.id) === "idle") return []

      if (
        current.blocking.some(
          (item) => item.type === "subagent" && (item.id === info.id || (!!item.label && info.title === item.label)),
        )
      )
        return []

      return [{ id: info.id, type: "subagent" as const, label: info.title ?? info.id }]
    })

    const running = input.shells().flatMap((shell) => {
      if (shell.status !== "running" || shell.metadata.sessionID !== id) return []

      if (
        current.blocking.some(
          (item) => item.type === "shell" && (item.id === shell.id || (!!item.label && shell.command === item.label)),
        )
      )
        return []

      return [{ id: shell.id, type: "shell" as const, label: shell.command }]
    })

    return [
      ...new Map<string, Task>(
        [...current.subagents, ...active, ...current.shells, ...running].map((task) => [task.id, task]),
      ).values(),
    ]
  })

  return { blocking, tasks }
}
