import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"

function Status(props: { enabled: boolean; loading: boolean; needsAuth: boolean; needsApproval: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.needsApproval) {
    return (
      <span style={{ fg: theme.warning, attributes: TextAttributes.BOLD }}>
        ⚠ Approval required (opencode mcp approve)
      </span>
    )
  }
  if (props.needsAuth) {
    return (
      <span style={{ fg: theme.warning, attributes: TextAttributes.BOLD }}>⚠ Auth required (authenticate)</span>
    )
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

  const refreshStatus = async () => {
    // Refresh MCP status from server
    const status = await sdk.client.mcp.status()
    if (status.data) {
      sync.set("mcp", status.data)
    } else {
      console.error("Failed to refresh MCP status: no data returned")
    }
  }

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const loadingMcp = loading()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description:
          status.status === "needs_approval"
            ? "approval required"
            : status.status === "needs_auth"
              ? "authentication required"
              : status.status === "failed"
                ? "failed"
                : status.status,
        footer: (
          <Status
            enabled={local.mcp.isEnabled(name)}
            loading={loadingMcp === name}
            needsAuth={status.status === "needs_auth"}
            needsApproval={status.status === "needs_approval"}
          />
        ),
        category: undefined,
      })),
    )
  })

  const actions = createMemo(() => [
    {
      command: "dialog.mcp.toggle",
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        // Prevent toggling while an operation is already in progress
        if (loading() !== null) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          await refreshStatus()
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      command: "dialog.mcp.authenticate",
      title: "authenticate",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return

        setLoading(option.value)
        toast.show({
          variant: "info",
          message: `Opening your browser to authorize ${option.value}...`,
          duration: 10000,
        })
        try {
          await local.mcp.authenticate(option.value)
          await refreshStatus()
          toast.show({ variant: "success", message: `${option.value} authenticated` })
        } catch (error) {
          console.error("Failed to authenticate MCP:", error)
          toast.show({
            variant: "error",
            message: `Authentication failed for ${option.value}: ${error instanceof Error ? error.message : String(error)}`,
            duration: 10000,
          })
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      actions={actions()}
      onSelect={(_option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
