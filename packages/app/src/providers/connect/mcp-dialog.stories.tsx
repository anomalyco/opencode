import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import type { McpServer } from "@opencode/client/promise"
import { createSignal, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { McpController } from "./mcp"
import { McpDialog } from "./mcp-dialog"
import { createMcpState, type McpEvent, transitionMcp } from "./mcp-machine"

function McpDialogStory(props: { server?: string; empty?: boolean; signingIn?: boolean }) {
  const dialog = useDialog()

  const [servers, setServers] = createStore<McpServer[]>([
    { name: "figma-remote", integrationID: "figma-oauth", status: { status: "needs_auth", error: "Sign in required" } },
    { name: "local-files", status: { status: "disabled" } },
    { name: "paper", status: { status: "connected" } },
    { name: "search-index", status: { status: "pending" } },
    {
      name: "unreachable-server",
      status: {
        status: "failed",
        error: "Streamable HTTP error: Error POSTing to endpoint: 404 Not Found\nCheck the server URL and try again.",
      },
    },
  ])

  // Start the busy preset after the sign-in was requested. Other rows still complete their fixture toggles.
  const mounted = transitionMcp(createMcpState(), { type: "mounted" }).state

  const [mcpState, setMcpState] = createSignal(
    props.signingIn
      ? transitionMcp(mounted, { type: "toggle.requested", name: "figma-remote", enabled: true, status: "needs_auth" })
          .state
      : mounted,
  )

  const listeners = new Set<Parameters<McpController["onFocus"]>[0]>()

  const mcp: Pick<McpController, "state" | "dispatch" | "onFocus"> = {
    state: mcpState,
    dispatch: (event: McpEvent) => {
      const step = transitionMcp(untrack(mcpState), event)
      setMcpState(step.state)
      step.effects.forEach((effect) => {
        if (effect.type === "focus-detail" || effect.type === "focus-list")
          return listeners.forEach((listener) => listener(effect))

        if (effect.type !== "run-toggle") return
        setServers((server) => server.name === effect.name, "status", {
          status: effect.enabled ? "connected" : "disabled",
        })
        mcp.dispatch({ type: "toggle.succeeded", name: effect.name, attempt: effect.attempt })
      })
    },
    onFocus: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }

  const open = () =>
    dialog.show(() => <McpDialog servers={props.empty ? [] : servers} server={props.server} mcp={mcp} />)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open MCP dialog
    </Button>
  )
}

export default {
  title: "App/Dialogs/MCP",
  id: "app-dialog-mcp",
}

export const Default = {
  render: () => <McpDialogStory />,
}

export const ConnectionError = {
  render: () => <McpDialogStory server="unreachable-server" />,
}

export const NoServers = { render: () => <McpDialogStory empty /> }

export const SigningIn = { render: () => <McpDialogStory signingIn /> }
