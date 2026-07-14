import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { useData } from "../context/data"
import { pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme, type Theme } from "../context/theme"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { McpServer } from "@opencode-ai/client"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { getScrollAcceleration } from "../util/scroll"
import { useBindings } from "../keymap"

// Sort by how much attention a server needs: auth prompts first, then failures,
// then healthy servers, and intentionally-off servers last.
function statusMeta(status: McpServer["status"], theme: Theme) {
  switch (status.status) {
    case "needs_auth":
      return { rank: 0, icon: "!", label: "Needs authentication", color: theme.warning, error: undefined, bold: false }
    case "needs_client_registration":
      return { rank: 1, icon: "✗", label: "Needs registration", color: theme.error, error: status.error, bold: false }
    case "failed":
      return { rank: 2, icon: "✗", label: "Failed", color: theme.error, error: status.error, bold: false }
    case "connected":
      return { rank: 3, icon: "✓", label: "Connected", color: theme.success, error: undefined, bold: true }
    case "pending":
      return { rank: 4, icon: "◌", label: "Pending", color: theme.textMuted, error: undefined, bold: false }
    default:
      return { rank: 5, icon: "○", label: "Disabled", color: theme.textMuted, error: undefined, bold: false }
  }
}

export function DialogMcp() {
  const data = useData()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [focused, setFocused] = createSignal<string>()
  const [detail, setDetail] = createSignal<McpServer>()

  onMount(() => {
    dialog.setSize("large")
  })

  const servers = createMemo(() =>
    pipe(
      data.location.mcp.server.list() ?? [],
      sortBy(
        (server) => statusMeta(server.status, theme).rank,
        (server) => server.name,
      ),
    ),
  )

  createEffect(() => {
    if (focused()) return
    const first = servers()[0]
    if (first) setFocused(first.name)
  })

  const options = createMemo(() =>
    servers().map((server) => {
      const meta = statusMeta(server.status, theme)
      return {
        value: server.name,
        title: server.name,
        footer: (
          <span style={{ fg: meta.color, attributes: meta.bold ? TextAttributes.BOLD : undefined }}>
            {meta.icon} {meta.label}
          </span>
        ),
      }
    }),
  )

  const focusedError = createMemo(() => {
    const name = focused()
    const server = servers().find((entry) => entry.name === name)
    return server ? statusMeta(server.status, theme).error : undefined
  })

  const open = (name: string | undefined) => {
    const server = servers().find((entry) => entry.name === name)
    if (!server || !statusMeta(server.status, theme).error) return
    setDetail(server)
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
            footer={
              <Show when={focusedError()}>
                <text fg={theme.textMuted}>enter to view error</text>
              </Show>
            }
          />
        }
      >
        {(server) => <DialogMcpError server={server()} onBack={() => setDetail()} />}
      </Show>
    </box>
  )
}

function DialogMcpError(props: { server: McpServer; onBack: () => void }) {
  const dialog = useDialog()
  const clipboard = useClipboard()
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal(false)
  const error = () => statusMeta(props.server.status, theme).error ?? "Unknown MCP connection error"
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

  useBindings(() => ({
    bindings: [{ key: "escape", desc: "Back to MCP servers", group: "Dialog", cmd: props.onBack }],
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
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          MCP server: {props.server.name}
        </text>
        <text fg={theme.textMuted} onMouseUp={props.onBack}>
          esc back
        </text>
      </box>
      <text fg={theme.error}>✗ Failed</text>
      <box backgroundColor={theme.backgroundElement} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <scrollbox
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          height={height()}
          scrollbarOptions={{ visible: false }}
          scrollAcceleration={getScrollAcceleration(config)}
        >
          <text fg={theme.text} wrapMode="word">
            {error()}
          </text>
        </scrollbox>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>↑↓ scroll</text>
        <text fg={theme.textMuted} onMouseUp={copy}>
          {copied() ? "✓ copied" : "c copy details"}
        </text>
      </box>
    </box>
  )
}
