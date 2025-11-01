import { createMemo, createSignal, onMount, For, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { TextAttributes } from "@opentui/core"
import { Keybind } from "@/util/keybind"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "../context/sdk"

export function DialogMCPManager() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const toast = useToast()
  const sdk = useSDK()

  const [selectedServer, setSelectedServer] = createSignal<string>()

  onMount(() => {
    dialog.setSize("large")
  })

  const mcpServers = createMemo(() => {
    return Object.entries(sync.data.mcp)
  })

  const options = createMemo(() => {
    if (mcpServers().length === 0) {
      return []
    }

    return mcpServers().map(([name, server]) => {
      const statusEmoji = {
        connected: "🟢",
        failed: "🔴",
        disabled: "⚫",
      }[server.status]

      const statusText = {
        connected: "Connected",
        failed: "error" in server ? server.error || "Failed" : "Failed",
        disabled: "Disabled",
      }[server.status]

      return {
        value: name,
        title: `${statusEmoji} ${name}`,
        footer: statusText,
        category: server.status === "connected" ? "Active" : "Inactive",
      }
    })
  })

  const reconnectServer = async (serverName: string) => {
    try {
      toast.show({
        message: `Reconnecting ${serverName}...`,
        variant: "info",
      })

      // TODO: Implement actual reconnect via SDK
      // await sdk.client.mcp.reconnect({ path: { name: serverName } })

      toast.show({
        message: `${serverName} reconnected`,
        variant: "success",
      })
    } catch (error) {
      toast.show({
        message: `Failed to reconnect: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
    }
  }

  const refreshServers = async () => {
    // Force sync refresh
    await sync.session.sync(sync.data.session[0]?.id || "")
    toast.show({
      message: "MCP servers refreshed",
      variant: "success",
    })
  }

  if (mcpServers().length === 0) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD}>MCP Manager</text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box gap={1}>
          <text>No MCP servers configured</text>
          <text fg={theme.textMuted}>Add MCP servers in your opencode.json configuration file</text>
          <box marginTop={1}>
            <text attributes={TextAttributes.BOLD}>Example:</text>
            <text fg={theme.textMuted}>{`{`}</text>
            <text fg={theme.textMuted}> "mcp": {`{`}</text>
            <text fg={theme.textMuted}> "filesystem": {`{`}</text>
            <text fg={theme.textMuted}> "command": "npx",</text>
            <text fg={theme.textMuted}>
              {" "}
              "args": ["-y", "@modelcontextprotocol/server-filesystem"]
            </text>
            <text fg={theme.textMuted}> {`}`}</text>
            <text fg={theme.textMuted}> {`}`}</text>
            <text fg={theme.textMuted}>{`}`}</text>
          </box>
        </box>
      </box>
    )
  }

  return (
    <DialogSelect
      title={`MCP Manager (${mcpServers().length} servers)`}
      options={options()}
      limit={50}
      onSelect={(option) => {
        setSelectedServer(option.value)
        const server = sync.data.mcp[option.value]
        toast.show({
          message: `${option.value}: ${server.status}`,
          variant: "info",
        })
      }}
      keybind={[
        {
          keybind: Keybind.parse("r")[0],
          title: "reconnect",
          onTrigger: async (option) => {
            await reconnectServer(option.value)
          },
        },
        {
          keybind: Keybind.parse("f")[0],
          title: "refresh",
          onTrigger: async () => {
            await refreshServers()
          },
        },
        {
          keybind: Keybind.parse("i")[0],
          title: "info",
          onTrigger: async (option) => {
            const server = sync.data.mcp[option.value]
            const info = `Status: ${server.status}${"error" in server && server.error ? `\nError: ${server.error}` : ""}`
            toast.show({
              message: info,
              variant: "info",
            })
          },
        },
      ]}
    />
  )
}
