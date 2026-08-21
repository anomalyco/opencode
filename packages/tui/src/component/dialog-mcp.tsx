import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { McpServer } from "@opencode-ai/client"
import { useToast } from "../ui/toast"
import { DialogErrorDetails } from "./dialog-error-details"
import { DialogIntegration } from "./dialog-integration"

function statusError(status: McpServer["status"]) {
  if (status.status === "failed") return status.error
  return undefined
}

function Status(props: { status: McpServer["status"]; loading: boolean }) {
  if (props.loading || props.status.status === "pending") {
    return <>Connecting …</>
  }
  if (props.status.status === "connected") {
    return <span style={{ attributes: TextAttributes.BOLD }}>Connected ✓</span>
  }
  if (props.status.status === "failed") {
    return <>Failed !</>
  }
  if (props.status.status === "needs_auth") {
    return <>Sign in required →</>
  }
  return <>Disabled ○</>
}

export function DialogMcp(props: { initialServer?: string; details?: boolean } = {}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const theme = useTheme("elevated")
  const servers = createMemo(() =>
    pipe(
      data.location.mcp.server.list() ?? [],
      sortBy((server) => server.name),
    ),
  )
  const initial = props.initialServer ? servers().find((server) => server.name === props.initialServer) : undefined
  const [focused, setFocused] = createSignal<string | undefined>(props.initialServer)
  const [detail, setDetail] = createSignal<McpServer | undefined>(
    props.details && initial?.status.status === "failed" ? initial : undefined,
  )
  const [loading, setLoading] = createSignal<string | null>(null)

  const statusColor = (status: McpServer["status"]) => {
    if (status.status === "connected") return theme.text.feedback.success.default
    if (status.status === "failed") return theme.text.feedback.error.default
    if (status.status === "needs_auth") return theme.text.feedback.warning.default
    return theme.text.subdued
  }

  createEffect(() => {
    if (focused()) return
    const first = servers()[0]
    if (first) setFocused(first.name)
  })

  const options = createMemo(() => {
    const loadingMcp = loading()
    return servers().map((server) => {
      const pending = loadingMcp === server.name || server.status.status === "pending"
      return {
        value: server.name,
        title: server.name,
        footer: <Status status={server.status} loading={pending} />,
        footerColor: pending ? theme.text.subdued : statusColor(server.status),
      }
    })
  })

  const focusedServer = createMemo(() => servers().find((server) => server.name === focused()))

  const toggleTitle = createMemo(() => {
    const status = focusedServer()?.status.status
    if (status === "connected") return "disconnect"
    if (status === "failed") return "retry"
    if (status === "needs_auth") return "sign in"
    return "connect"
  })

  const focusedError = createMemo(() => {
    const server = focusedServer()
    return server ? statusError(server.status) : undefined
  })

  const select = (name: string | undefined) => {
    const server = servers().find((entry) => entry.name === name)
    if (!server) return
    if (server.status.status === "needs_auth" && server.integrationID) {
      dialog.replace(() => <DialogIntegration integrationID={server.integrationID} autoConnect />)
      return
    }
    if (!statusError(server.status)) return
    setDetail(server)
  }

  // Auth-gated servers enter the integration flow; other inactive states retry the connection.
  // The mcp.status.changed event refreshes the list, so no manual sync is needed.
  const toggle = (name: string) => {
    if (loading() !== null) return
    const server = servers().find((entry) => entry.name === name)
    if (!server || server.status.status === "pending") return
    if (server.status.status === "needs_auth" && server.integrationID) {
      select(name)
      return
    }
    setLoading(name)
    const current = data.location.default()
    const input = { server: name, location: { directory: current.directory, workspace: current.workspaceID } }
    const call = server.status.status === "connected" ? client.api.mcp.disconnect(input) : client.api.mcp.connect(input)
    void call.catch(toast.error).finally(() => setLoading(null))
  }

  return (
    <box>
      <Show
        when={detail()}
        fallback={
          <DialogSelect
            title="MCP servers"
            options={options()}
            preserveSelection
            onMove={(option) => setFocused(option.value as string)}
            onSelect={(option) => select(option.value as string)}
            actions={[
              {
                title: toggleTitle(),
                command: "dialog.mcp.toggle",
                onTrigger: (option) => {
                  setFocused(option.value as string)
                  toggle(option.value as string)
                },
              },
            ]}
            footer={
              <Show when={focusedError()}>
                <text fg={theme.text.subdued}>enter to view error</text>
              </Show>
            }
          />
        }
      >
        {(server) => (
          <DialogErrorDetails
            title={`MCP server: ${server().name}`}
            error={statusError(server().status) ?? "Unknown MCP connection error"}
            onBack={() => {
              setDetail(undefined)
              dialog.setSize("medium")
            }}
          />
        )}
      </Show>
    </box>
  )
}
