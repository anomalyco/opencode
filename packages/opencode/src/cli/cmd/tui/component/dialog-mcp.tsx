import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { useToast } from "@tui/ui/toast"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"

type LoadingKind = "toggle" | "authenticating"
type LoadingState = { name: string; kind: LoadingKind }

function Status(props: { enabled: boolean; loading: LoadingKind | null }) {
  const { theme } = useTheme()
  if (props.loading === "authenticating") {
    return <span style={{ fg: theme.textMuted }}>⋯ Authenticating (complete in browser)</span>
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
  const toast = useToast()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<LoadingState | null>(null)

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const loadingState = loading()

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
            loading={loadingState?.name === name ? loadingState.kind : null}
          />
        ),
        category: undefined,
      })),
    )
  })

  // Refresh MCP status from server and apply to sync store.
  const refreshStatus = async () => {
    const status = await sdk.client.mcp.status()
    if (status.data) {
      sync.set("mcp", status.data)
    } else {
      console.error("Failed to refresh MCP status: no data returned")
    }
  }

  const actions = createMemo(() => [
    {
      command: "dialog.mcp.toggle",
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        // Prevent toggling while an operation is already in progress
        if (loading() !== null) return

        const name = option.value
        const status = sync.data.mcp[name]

        // For MCPs that need OAuth, run the full authenticate flow instead of
        // re-running connect (which would only re-trigger the same
        // UnauthorizedError loop). The server opens the browser, starts the
        // OAuth callback listener, waits for the redirect, exchanges the
        // code, and rebuilds the transport.
        if (status?.status === "needs_auth") {
          setLoading({ name, kind: "authenticating" })
          try {
            // This call blocks for up to 5 minutes (the callback timeout)
            // while the user completes the OAuth flow in their browser. If
            // the browser fails to open (headless / SSH / no `open`
            // binary), the server publishes a `BrowserOpenFailed` event
            // that surfaces as a toast carrying the URL for manual
            // opening.
            const result = await sdk.client.mcp.auth.authenticate({ name })
            await refreshStatus()
            if (result.data?.status === "failed") {
              toast.show({
                variant: "error",
                title: "Authentication failed",
                message: result.data.error,
                duration: 8000,
              })
            }
          } catch (error) {
            console.error("Failed to authenticate MCP:", error)
            toast.show({
              variant: "error",
              title: "Authentication failed",
              message: error instanceof Error ? error.message : String(error),
              duration: 8000,
            })
          } finally {
            setLoading(null)
          }
          return
        }

        setLoading({ name, kind: "toggle" })
        try {
          await local.mcp.toggle(name)
          await refreshStatus()
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
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
