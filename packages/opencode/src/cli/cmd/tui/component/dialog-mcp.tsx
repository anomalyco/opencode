import { createMemo, createSignal, For } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { pipe, sortBy, unique } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

function DialogMcpError(props: { title: string; error: string; stderr: string[]; onClose: () => void }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const maxHeight = () => Math.floor(dimensions().height * 0.5)

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      props.onClose()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <scrollbox maxHeight={maxHeight()}>
        <box gap={1} flexShrink={0}>
          <text fg={theme.error} wrapMode="word">
            {props.error}
          </text>
          {props.stderr.length > 0 && (
            <box>
              <text fg={theme.textMuted}>--- stderr ---</text>
              <For each={props.stderr}>
                {(line) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    {line}
                  </text>
                )}
              </For>
            </box>
          )}
        </box>
      </scrollbox>
    </box>
  )
}

function showMcpError(dialog: DialogContext, title: string, error: string, stderr: string[]) {
  return new Promise<void>((resolve) => {
    dialog.push(
      () => (
        <DialogMcpError
          title={title}
          error={error}
          stderr={stderr}
          onClose={() => {
            dialog.pop()
            resolve()
          }}
        />
      ),
      () => resolve(),
    )
  })
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const configMcp = sync.data.config?.mcp ?? {}
    const loadingMcp = loading()

    // Get all MCP names from both config and status data
    // This allows showing MCPs immediately from config while status is loading
    const configNames = Object.keys(configMcp)
    const statusNames = Object.keys(mcpData ?? {})
    const allNames = pipe(
      [...configNames, ...statusNames],
      unique(),
      sortBy((name) => name),
    )

    return allNames.map((name) => {
      const status = mcpData?.[name]
      // Determine description based on status
      let description: string
      if (!status) {
        description = "loading"
      } else if (status.status === "failed") {
        description = "failed"
      } else {
        description = status.status
      }

      return {
        value: name,
        title: name,
        description,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name || !status} />,
        category: undefined,
      }
    })
  })

  const getErrorMessage = (name: string) => {
    const status = sync.data.mcp?.[name]
    if (!status) return undefined
    if (status.status === "failed") return status.error
    if (status.status === "needs_client_registration") return status.error
    return undefined
  }

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return

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
      keybind: Keybind.parse("tab")[0],
      title: "show error",
      onTrigger: async (option: DialogSelectOption<string>) => {
        const status = sync.data.mcp?.[option.value]
        if (!status || (status.status !== "failed" && status.status !== "needs_client_registration")) {
          return
        }
        const stderrResult = await sdk.client.mcp.stderr({ name: option.value })
        const stderr = stderrResult.data ?? []
        const errorMsg = getErrorMessage(option.value) ?? "Unknown error"
        await showMcpError(dialog, `${option.value} Error`, errorMsg, stderr)
      },
    },
  ])

  return <DialogSelect ref={setRef} title="MCPs" options={options()} keybind={keybinds()} onSelect={() => {}} />
}
