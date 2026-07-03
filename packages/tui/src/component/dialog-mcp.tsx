import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useData } from "../context/data"
import { pipe, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme, type Theme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { McpServer } from "@opencode-ai/sdk/v2"

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
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [focused, setFocused] = createSignal<string>()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()

  onMount(() => {
    dialog.setSize("large")
  })

  const servers = createMemo(() =>
    pipe(
      data.location.mcp.list() ?? [],
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
        details: meta.error && expanded[server.name] ? [meta.error] : undefined,
        detailsColor: theme.error,
        detailsWrap: true,
      }
    }),
  )

  const focusedError = createMemo(() => {
    const name = focused()
    const server = servers().find((entry) => entry.name === name)
    return server ? statusMeta(server.status, theme).error : undefined
  })

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      preserveSelection
      onMove={(option) => setFocused(option.value as string)}
      onSelect={(option) => {
        const name = option.value as string
        const server = servers().find((entry) => entry.name === name)
        if (!server || !statusMeta(server.status, theme).error) return
        setExpanded(name, (open) => !open)
      }}
      footer={
        <Show when={focusedError()}>
          <text fg={theme.textMuted}>enter to {expanded[focused()!] ? "hide" : "view"} error</text>
        </Show>
      }
    />
  )
}
