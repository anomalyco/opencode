import { connectClientMcp, type ClientMcpConnection } from "@opencode/client/mcp"
import { createEffect, onCleanup, untrack } from "solid-js"
import { useClientMcpExperiment } from "../config"
import { useClient } from "./client"
import { useData } from "./data"
import { useLocation } from "./location"
import { useRoute } from "./route"
import { useSessionTabs } from "./session-tabs"
import { useSessionTerminals } from "./session-terminals"

// Serves TUI tools to the server as the client MCP server "tui", so the model sees them as `tui_<tool>`.
export function ClientMcp() {
  const client = useClient()
  const enabled = useClientMcpExperiment()
  const data = useData()
  const location = useLocation()
  const route = useRoute()
  const tabs = useSessionTabs()
  const terminals = useSessionTerminals()
  const state: { key?: string; connection?: ClientMcpConnection } = {}

  const openTerminal = async (calledBy: string | undefined) => {
    const result = await terminalFor(calledBy)
    if (typeof result !== "string") return result
    return { content: [{ type: "text" as const, text: `Opened terminal ${result}` }] }
  }

  const writeTerminal = async (calledBy: string | undefined, text: unknown) => {
    if (typeof text !== "string") return failure("text must be a string")
    const result = await terminalFor(calledBy)
    if (typeof result !== "string") return result
    terminals.write(result, new TextEncoder().encode(text))
    return { content: [{ type: "text" as const, text: `Wrote to terminal ${result}` }] }
  }

  // Resolves the terminal open_terminal shows (selected, else newest, else a new one), or a tool failure.
  const terminalFor = async (calledBy: string | undefined) => {
    if (!calledBy) return failure("Unknown session")
    if (!data.session.get(calledBy)) await data.session.sync(calledBy).catch(() => undefined)
    if (!data.session.get(calledBy)) return failure("Unknown session")
    await terminals.checked()
    if (!terminals.available()) return failure("This server does not support terminals")
    const root = data.session.root(calledBy)
    const routed = route.data.type === "session" ? route.data.sessionID : undefined
    // Terminal panes render for the routed session; tabs hold root sessions, which become routed when selected.
    const target =
      routed && data.session.root(routed) === root
        ? routed
        : tabs.enabled() && tabs.tabs().some((tab) => tab.sessionID === root)
          ? root
          : undefined
    if (!target) return failure("session not open in this TUI")
    if (!data.session.get(target)) await data.session.sync(target).catch(() => undefined)
    await terminals.refresh(target)
    // The agent opened it, so don't move the user's keyboard focus into a live shell.
    const current = terminals.get(target)
    const existing = current.selectedTerminalID ?? current.terminals.at(-1)?.id
    if (existing && existing !== current.selectedTerminalID)
      await terminals.selectTerminal(target, existing, { focus: false })
    return existing ?? (await terminals.newTerminal(target, { focus: false })).id
  }

  // Reconnects when the flag flips, the viewed location changes, or the server endpoint changes after a service reconnect.
  // Server MCP is Location-scoped, so only sessions in the viewed location's directory see the tool.
  const sync = () => {
    const url = client.url
    const directory = location.ref?.directory ?? data.location.default().directory
    const key = enabled() && url ? JSON.stringify([url, client.headers, directory]) : undefined
    if (key === state.key) return
    void state.connection?.close()
    state.key = key
    state.connection =
      key && url
        ? untrack(() =>
            connectClientMcp({
              url,
              name: "tui",
              directory,
              headers: client.headers,
              tools: [
                {
                  name: "open_terminal",
                  description:
                    "Open a terminal for the current session in the user's TUI, without taking keyboard focus.",
                  inputSchema: { type: "object" },
                  handler: (_args, ctx) => openTerminal(ctx.sessionID),
                },
                {
                  name: "write_terminal",
                  description:
                    "Type text into the current session's terminal in the user's TUI, opening one first if needed. Text is sent as-is; include a trailing newline to run a command.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      text: { type: "string", description: "Text to send to the terminal, e.g. \"ls\\n\" to run ls." },
                    },
                    required: ["text"],
                  },
                  handler: (args, ctx) => writeTerminal(ctx.sessionID, args.text),
                },
              ],
            }),
          )
        : undefined
  }

  createEffect(sync)
  onCleanup(client.event.on("server.connected", sync))
  onCleanup(() => {
    state.key = undefined
    void state.connection?.close()
  })

  return null
}

function failure(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true }
}
