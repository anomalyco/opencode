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

function Status(props: { enabled: boolean; loading: boolean; authenticating: boolean }) {
  const { theme } = useTheme()
  if (props.authenticating) {
    return <span style={{ fg: theme.warning }}>⋯ Authenticating</span>
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
  const [loading, setLoading] = createSignal<string | null>(null)
  const [authenticating, setAuthenticating] = createSignal<string | null>(null)

  const options = createMemo(() => {
    const mcpData = sync.data.mcp
    const loadingMcp = loading()
    const authingMcp = authenticating()

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
            authenticating={authingMcp === name}
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
        if (loading() !== null || authenticating() !== null) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
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
      disabled: !Object.values(sync.data.mcp ?? {}).some(
        (s) => s.status === "needs_auth" || s.status === ("needs_auth" as string),
      ),
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null || authenticating() !== null) return
        const status = sync.data.mcp[option.value]
        if (status?.status !== "needs_auth") return

        setAuthenticating(option.value)
        try {
          const result = await sdk.client.mcp.auth.authenticate({ name: option.value })
          if (result.data && "status" in result.data && result.data.status === "connected") {
            toast.show({ variant: "success", message: `${option.value} authenticated` })
          } else {
            toast.show({ variant: "error", message: `${option.value} authentication failed` })
          }
          const refreshed = await sdk.client.mcp.status()
          if (refreshed.data) {
            sync.set("mcp", refreshed.data)
          }
        } catch (error) {
          toast.show({
            variant: "error",
            message: `Failed to authenticate ${option.value}`,
          })
        } finally {
          setAuthenticating(null)
        }
      },
    },
  ])

  return <DialogSelect ref={setRef} title="MCPs" options={options()} keybind={keybinds()} onSelect={(option) => {}} />
}
