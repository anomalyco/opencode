import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import type { McpServer } from "@opencode/client/promise"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { McpDialog } from "./mcp-dialog"

function McpDialogStory(props: { server?: string }) {
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
  const open = () =>
    dialog.show(() => (
      <McpDialog
        servers={servers}
        server={props.server}
        pending={false}
        onToggle={(input) => {
          const name = typeof input === "string" ? input : input.name
          const enabled =
            typeof input === "string"
              ? servers.find((server) => server.name === name)?.status.status !== "connected"
              : input.enabled
          setServers((server) => server.name === name, "status", { status: enabled ? "connected" : "disabled" })
        }}
      />
    ))

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
