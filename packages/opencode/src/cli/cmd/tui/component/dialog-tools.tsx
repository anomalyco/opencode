import { createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useSDK } from "../context/sdk"
import { createColors, createFrames } from "@tui/ui/spinner"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import "opentui-spinner/solid"

export type DialogToolsProps = {}

export function DialogTools() {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [updating, setUpdating] = createSignal<string | null>(null)
  const [optimisticStates, setOptimisticStates] = createStore<Record<string, boolean>>({})

  const spinnerDef = createMemo(() => {
    const color = theme.text
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
      }),
    }
  })

  const mcpServers = createMemo(() => {
    const config = sync.data.config.mcp ?? {}
    const status = sync.data.mcp
    return Object.keys(config).map((key) => ({
      name: key,
      config: config[key],
      status: status[key],
    }))
  })

  const toggleServer = async (name: string, currentEnabled: boolean) => {
    const newEnabled = !currentEnabled
    setUpdating(name)
    // Optimistic update
    setOptimisticStates(name, newEnabled)

    try {
      const currentConfig = sync.data.config
      const newConfig = {
        ...currentConfig,
        mcp: {
          ...currentConfig.mcp,
          [name]: {
            ...currentConfig.mcp?.[name],
            enabled: newEnabled,
          },
        },
      }
      await sdk.client.config.update(newConfig as any)

      // Targeted refresh: only update MCP status instead of full bootstrap
      const mcpStatus = await sdk.client.mcp.status()
      ;(sync as any).set?.("mcp", mcpStatus.data!)
    } catch (error) {
      console.error("Failed to update MCP server:", error)
      // Revert optimistic update on error
      setOptimisticStates(name, undefined!)
    } finally {
      setUpdating(null)
    }
  }

  const options = createMemo(() => {
    const serverOptions = mcpServers().map((server) => {
      const isUpdating = () => updating() === server.name
      const optimisticEnabled = optimisticStates[server.name]
      const isEnabled = () => (optimisticEnabled !== undefined ? optimisticEnabled : server.config.enabled !== false)

      let description = ""
      if (isUpdating()) {
        description = isEnabled() ? "Disconnecting..." : "Connecting..."
      } else if (server.status?.status === "connected") {
        description = "Connected"
      } else if (server.status?.status === "failed") {
        description = (server.status as any).error || "Failed"
      } else if (server.status?.status === "disabled") {
        description = "Disabled"
      } else if (!isEnabled()) {
        description = "Disabled in configuration"
      }

      return {
        title: server.name,
        value: server.name,
        description: (
          <box flexDirection="row" gap={1}>
            <text>{description}</text>
            <Show when={isUpdating()}>
              <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
            </Show>
          </box>
        ) as any,
        footer: server.config.type,
        onSelect: () => {
          toggleServer(server.name, isEnabled())
        },
      }
    })

    // Add "Add MCP Server" option
    serverOptions.push({
      title: "Add MCP Server",
      value: "__add__",
      description: "Configure a new MCP server",
      footer: "action" as any,
      onSelect: () => {
        dialog.replace(() => (
          <box padding={2}>
            <text>To add an MCP server, use the CLI command:</text>
            <text fg={theme.primary}>opencode mcp add</text>
            <text>Press any key to continue...</text>
          </box>
        ))
      },
    })

    return serverOptions
  })

  return <DialogSelect ref={setRef} title="MCP Tools" options={options()} />
}
