import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

function Status(props: { enabled: boolean; loading: boolean; status?: string }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.status === "needs_auth") {
    return <span style={{ fg: theme.warning, attributes: TextAttributes.BOLD }}>⚠ Needs Auth</span>
  }
  if (props.status === "needs_client_registration") {
    return <span style={{ fg: theme.error, attributes: TextAttributes.BOLD }}>✗ Needs Registration</span>
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
  const toast = useToast()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [authenticating, setAuthenticating] = createSignal<string | null>(null)

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const loadingMcp = loading()
    const authMcp = authenticating()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? status.error : status.status,
        footer: (
          <Status
            enabled={local.mcp.isEnabled(name)}
            loading={loadingMcp === name || authMcp === name}
            status={status.status}
          />
        ),
        category: undefined,
        // Store status for keybind handler
        _status: status.status,
      })),
    )
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string> & { _status?: string }) => {
        // Prevent toggling while an operation is already in progress
        if (loading() !== null || authenticating() !== null) return

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
      keybind: Keybind.parse("a")[0],
      title: "auth",
      onTrigger: async (option: DialogSelectOption<string> & { _status?: string }) => {
        // Prevent auth while an operation is already in progress
        if (loading() !== null || authenticating() !== null) return

        // Only allow auth for servers that need it
        if (option._status !== "needs_auth") {
          toast.show({
            title: "Auth not needed",
            message: `${option.value} does not need authentication`,
            variant: "info",
          })
          return
        }

        setAuthenticating(option.value)
        toast.show({
          title: "Starting OAuth",
          message: `Opening browser for ${option.value}...`,
          variant: "info",
        })

        try {
          const result = await sdk.client.mcp.auth.authenticate({ name: option.value })
          if (result.error) {
            const errorMsg =
              "data" in result.error && result.error.data && typeof result.error.data === "object"
                ? "message" in result.error.data
                  ? String((result.error.data as { message: string }).message)
                  : "Unknown error"
                : "Unknown error"
            toast.show({
              title: "Auth failed",
              message: errorMsg,
              variant: "error",
            })
          } else if (result.data?.status === "connected") {
            toast.show({
              title: "Auth successful",
              message: `${option.value} is now connected`,
              variant: "success",
            })
          } else if (result.data?.status === "needs_client_registration") {
            toast.show({
              title: "Registration required",
              message: "Server needs pre-registered client ID. Add clientId to config.",
              variant: "warning",
              duration: 8000,
            })
          } else if (result.data?.status === "failed") {
            toast.show({
              title: "Auth failed",
              message: "error" in result.data ? result.data.error : "Unknown error",
              variant: "error",
            })
          }

          // Refresh MCP status
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }
        } catch (error) {
          toast.show({
            title: "Auth error",
            message: error instanceof Error ? error.message : String(error),
            variant: "error",
          })
        } finally {
          setAuthenticating(null)
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
      onSelect={(option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
