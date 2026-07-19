import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { McpServer } from "@opencode-ai/client"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { getScrollAcceleration } from "../util/scroll"

function statusError(status: McpServer["status"]) {
  if (status.status === "failed" || status.status === "needs_client_registration") return status.error
  return undefined
}

function Status(props: { enabled: boolean; loading: boolean }) {
  const { themeV2 } = useTheme().contextual("elevated")
  if (props.loading) return <span style={{ fg: themeV2.text.subdued() }}>⋯ Loading</span>
  if (props.enabled) {
    return <span style={{ fg: themeV2.text.feedback.success(), attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: themeV2.text.subdued() }}>○ Disabled</span>
}

export function DialogMcp() {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const { themeV2 } = useTheme().contextual("elevated")
  const [focused, setFocused] = createSignal<string>()
  const [detail, setDetail] = createSignal<McpServer>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const servers = createMemo(() =>
    pipe(
      data.location.mcp.server.list() ?? [],
      sortBy((server) => server.name),
    ),
  )

  createEffect(() => {
    if (focused()) return
    const first = servers()[0]
    if (first) setFocused(first.name)
  })

  const options = createMemo(() => {
    const loadingMcp = loading()
    return servers().map((server) => ({
      value: server.name,
      title: server.name,
      description: server.status.status,
      footer: <Status enabled={server.status.status === "connected"} loading={loadingMcp === server.name} />,
    }))
  })

  const focusedError = createMemo(() => {
    const name = focused()
    const server = servers().find((entry) => entry.name === name)
    return server ? statusError(server.status) : undefined
  })

  const open = (name: string | undefined) => {
    const server = servers().find((entry) => entry.name === name)
    if (!server || !statusError(server.status)) return
    setDetail(server)
  }

  // Connected servers disconnect; everything else (disabled, failed, needs_auth) retries a
  // connection. The mcp.status.changed event refreshes the list, so no manual sync is needed.
  const toggle = (name: string) => {
    if (loading() !== null) return
    const server = servers().find((entry) => entry.name === name)
    if (!server || server.status.status === "pending") return
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
            current={focused()}
            preserveSelection
            onMove={(option) => setFocused(option.value as string)}
            onSelect={(option) => open(option.value as string)}
            actions={[
              {
                title: "toggle",
                command: "dialog.mcp.toggle",
                onTrigger: (option) => {
                  setFocused(option.value as string)
                  toggle(option.value as string)
                },
              },
            ]}
            footer={
              <Show when={focusedError()}>
                <text fg={themeV2.text.subdued()}>enter to view error</text>
              </Show>
            }
          />
        }
      >
        {(server) => (
          <DialogMcpError
            server={server()}
            onBack={() => {
              setDetail()
              dialog.setSize("medium")
            }}
          />
        )}
      </Show>
    </box>
  )
}

function DialogMcpError(props: { server: McpServer; onBack: () => void }) {
  const dialog = useDialog()
  const clipboard = useClipboard()
  const toast = useToast()
  const { themeV2 } = useTheme().contextual("elevated")
  const { themeV2: overlayTheme } = useTheme().contextual("overlay")
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal(false)
  const error = () => statusError(props.server.status) ?? "Unknown MCP connection error"
  const height = createMemo(() => Math.max(3, Math.floor(dimensions().height / 2) - 5))
  let scroll: ScrollBoxRenderable | undefined

  onMount(() => dialog.setSize("large"))

  const copy = () => {
    if (!clipboard.write) return
    void clipboard
      .write(error())
      .then(() => setCopied(true))
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "escape", title: "Back to MCP servers", group: "Dialog", run: props.onBack }],
  }))

  useKeyboard((event) => {
    if (event.name === "c") return copy()
    if (event.name === "up") return scroll?.scrollBy(-1)
    if (event.name === "down") return scroll?.scrollBy(1)
    if (event.name === "pageup") return scroll?.scrollBy(-height())
    if (event.name === "pagedown") return scroll?.scrollBy(height())
    if (event.name === "home") return scroll?.scrollTo(0)
    if (event.name === "end" && scroll) return scroll.scrollTo(scroll.scrollHeight)
  })

  return (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={themeV2.text()}>
          MCP server: {props.server.name}
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={props.onBack}>
          esc back
        </text>
      </box>
      <text fg={themeV2.text.feedback.error()}>✗ Failed</text>
      <box
        backgroundColor={overlayTheme.background()}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <scrollbox
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          height={height()}
          scrollbarOptions={{ visible: false }}
          scrollAcceleration={getScrollAcceleration(config)}
        >
          <text fg={overlayTheme.text()} wrapMode="word">
            {error()}
          </text>
        </scrollbox>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={themeV2.text.subdued()}>↑↓ scroll</text>
        <text fg={themeV2.text.subdued()} onMouseUp={copy}>
          {copied() ? "✓ copied" : "c copy details"}
        </text>
      </box>
    </box>
  )
}
