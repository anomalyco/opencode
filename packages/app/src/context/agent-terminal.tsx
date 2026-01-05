import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "./sync"
import { useTerminal } from "./terminal"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2/client"

export type BashCommand = {
  id: string
  messageID: string
  command: string
  description: string
  output: string
  status: "pending" | "running" | "completed" | "error"
  time: { start?: number; end?: number }
  exitCode?: number
}

function isBashToolPart(part: Part): part is ToolPart {
  return part.type === "tool" && part.tool === "bash"
}

function extractBashCommand(part: ToolPart): BashCommand {
  const state = part.state
  const input = state.input as { command?: string; description?: string }

  const base = {
    id: part.id,
    messageID: part.messageID,
    command: input.command ?? "",
    description: input.description ?? "",
  }

  switch (state.status) {
    case "pending":
      return { ...base, output: "", status: "pending", time: {} }
    case "running":
      return {
        ...base,
        output: (state.metadata?.output as string) ?? "",
        status: "running",
        time: { start: state.time.start },
      }
    case "completed":
      return {
        ...base,
        output: (state.metadata?.output as string) ?? state.output ?? "",
        status: "completed",
        time: { start: state.time.start, end: state.time.end },
        exitCode: state.metadata?.exit as number | undefined,
      }
    case "error":
      return {
        ...base,
        output: state.error ?? "",
        status: "error",
        time: { start: state.time.start, end: state.time.end },
      }
  }
}

export const { use: useAgentTerminal, provider: AgentTerminalProvider } = createSimpleContext({
  name: "AgentTerminal",
  init: () => {
    const sync = useSync()
    const terminal = useTerminal()
    const params = useParams()

    const [store, setStore] = createStore<{
      cleared: boolean
      previousActiveCount: number
    }>({
      cleared: false,
      previousActiveCount: 0,
    })

    const sessionID = createMemo(() => params.id)

    const messages = createMemo(() => {
      const id = sessionID()
      if (!id) return []
      return sync.data.message[id] ?? []
    })

    const bashCommands = createMemo(() => {
      if (store.cleared) return []
      const msgs = messages()
      const allParts = sync.data.part
      const commands: BashCommand[] = []

      for (const msg of msgs) {
        const parts = allParts[msg.id] ?? []
        for (const part of parts) {
          if (isBashToolPart(part)) {
            commands.push(extractBashCommand(part))
          }
        }
      }

      return commands
    })

    const hasActiveCommand = createMemo(() =>
      bashCommands().some((c) => c.status === "running" || c.status === "pending"),
    )

    // Auto-focus to agent tab when a new command starts (if user hasn't interacted with PTY terminals)
    createEffect(() => {
      const activeCount = bashCommands().filter((c) => c.status === "running" || c.status === "pending").length
      const previousCount = store.previousActiveCount

      // A new command started
      if (activeCount > previousCount && activeCount > 0) {
        // Only auto-focus if user hasn't interacted with PTY terminals
        if (!terminal.hasUserInteracted()) {
          terminal.open("agent")
        }
      }

      setStore("previousActiveCount", activeCount)
    })

    return {
      commands: bashCommands,
      hasActiveCommand,
      clear() {
        setStore("cleared", true)
        // Reset after a tick so new commands can come in
        setTimeout(() => setStore("cleared", false), 0)
      },
    }
  },
})
