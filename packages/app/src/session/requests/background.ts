import type { SessionInfo, SessionMessageInfo, ShellInfo } from "@opencode/client/promise"
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

    for (const message of messages) {
      if (message.type !== "assistant") continue

      for (const part of message.content) {
        if (part.type !== "tool" || part.name !== "shell") continue

        if (part.state.status !== "completed" || part.state.metadata?.status !== "running") continue

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
      }
    }

    // Live foreground calls, from the shared scan so the header and the panel
    // agree on what counts as live. Legacy task parts surface as subagents.
    const blocking = [
      ...scan.calls.flatMap((call) => {
        if (!call.live || call.status !== "running") return []

        return [
          {
            type: "subagent" as const,
            partID: call.partID,
            id: call.childID,
            label: call.description,
          },
        ]
      }),
      ...(scan.live?.content.flatMap((part) => {
        if (part.type !== "tool" || part.name !== "shell" || part.state.status !== "running") return []

        const shellID = part.state.metadata.shellID
        const command = part.state.input.command

        return [
          {
            type: "shell" as const,
            partID: part.id,
            id: Predicate.isString(shellID) ? shellID : undefined,
            label: Predicate.isString(command) ? command : undefined,
          },
        ]
      }) ?? []),
    ]

    return {
      // Backgrounded calls stay listed until their synthetic completion notice lands (filtered at construction).
      subagents,
      shells: shells.flatMap((item) =>
        !completed.has(item.partID) && !completed.has(item.task.id) ? [item.task] : [],
      ),
      blocking,
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
