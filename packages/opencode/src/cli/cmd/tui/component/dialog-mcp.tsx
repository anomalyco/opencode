import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"

function Status(props: { enabled: boolean; loading: boolean; restarting: boolean }) {
  const { theme } = useTheme()
  if (props.restarting) {
    return <span style={{ fg: theme.textMuted }}>⋯ Restarting</span>
  }
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [restarting, setRestarting] = createSignal(false)

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const loadingMcp = loading()
    const isRestarting = restarting()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: (
          <Status
            enabled={local.mcp.isEnabled(name)}
            loading={loadingMcp === name}
            restarting={isRestarting && (status.status === "connected" || status.status === "failed")}
          />
        ),
        category: undefined,
      })),
    )
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        // Prevent toggling while an operation is already in progress
        if (loading() !== null || restarting()) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          // Refresh MCP status from server
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          } else {
            console.error("Failed to refresh MCP status: no data returned")
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("r")[0],
      title: "restart all",
      onTrigger: async () => {
        // Prevent restarting while an operation is already in progress
        if (loading() !== null || restarting()) return

        const mcpData = sync.data.mcp ?? {}
        const serversToRestart = Object.entries(mcpData)
          .filter(([, status]) => status.status === "connected" || status.status === "failed")
          .map(([name]) => name)

        if (serversToRestart.length === 0) return

        setRestarting(true)
        try {
          // Disconnect all servers
          await Promise.all(serversToRestart.map((name) => sdk.client.mcp.disconnect({ name })))
          // Reconnect all servers
          await Promise.all(serversToRestart.map((name) => sdk.client.mcp.connect({ name })))
          // Refresh status
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }
        } catch (error) {
          console.error("Failed to restart MCP servers:", error)
        } finally {
          setRestarting(false)
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      keybind={keybinds()}
      onSelect={() => {
        // Don't close on select, only on escape
      }}
    />
  )
}
