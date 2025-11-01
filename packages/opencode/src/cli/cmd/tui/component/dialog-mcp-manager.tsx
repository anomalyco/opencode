import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { TextAttributes } from "@opentui/core"
import { Keybind } from "@/util/keybind"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"

type MCPServerConfig = {
  type: "local" | "remote"
  command?: string[]
  url?: string
  enabled?: boolean
  environment?: Record<string, string>
  headers?: Record<string, string>
  timeout?: number
}

export function DialogMCPManager() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const toast = useToast()
  const sdk = useSDK()

  const [selectedServer, setSelectedServer] = createSignal<string>()
  const [view, setView] = createSignal<"list" | "tools" | "add">("list")
  const [serverTools, setServerTools] = createSignal<Record<string, any>>({})

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

  async function reconnectServer(serverName: string) {
    try {
      toast.show({
        message: `Reconnecting ${serverName}...`,
        variant: "info",
      })

      // Force a full refresh by reloading the sync data
      const currentSession = sync.data.session[0]
      if (currentSession) {
        await sync.session.sync(currentSession.id)
      }

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

  async function refreshServers() {
    const currentSession = sync.data.session[0]
    if (currentSession) {
      await sync.session.sync(currentSession.id)
    }
    toast.show({
      message: "MCP servers refreshed",
      variant: "success",
    })
  }

  async function toggleServerEnabled(serverName: string) {
    toast.show({
      message: `Toggle functionality requires config file editing`,
      variant: "info",
    })
    // TODO: Implement config file editing
  }

  async function listServerTools(serverName: string) {
    try {
      toast.show({
        message: `Loading tools for ${serverName}...`,
        variant: "info",
      })

      // This would need an SDK endpoint to get tools for a specific server
      // For now, show a message
      setView("tools")
      setSelectedServer(serverName)

      toast.show({
        message: `Showing ${serverName} tools (integration pending)`,
        variant: "info",
      })
    } catch (error) {
      toast.show({
        message: `Failed to load tools: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
    }
  }

  async function showServerDetails(serverName: string) {
    const server = sync.data.mcp[serverName]
    if (!server) return

    const details = `
${serverName}

Status: ${server.status}
${"error" in server && server.error ? `Error: ${server.error}` : ""}

Press 't' to list available tools
Press 'r' to reconnect
Press 'e' to edit configuration
    `.trim()

    toast.show({
      message: details,
      variant: "info",
    })
  }

  async function addNewServer() {
    dialog.replace(() => (
      <DialogPrompt
        title="Add MCP Server - Enter server name"
        onConfirm={(name: string) => {
          if (!name || !name.trim()) {
            toast.show({
              message: "Server name cannot be empty",
              variant: "error",
            })
            return
          }

          toast.show({
            message: `Add MCP server functionality requires config file editing.\n\nAdd to opencode.json:\n\n"mcp": {\n  "${name}": {\n    "type": "local",\n    "command": ["npx", "-y", "@modelcontextprotocol/server-example"]\n  }\n}`,
            variant: "info",
          })
          dialog.replace(() => <DialogMCPManager />)
        }}
        onCancel={() => {
          dialog.replace(() => <DialogMCPManager />)
        }}
      />
    ))
  }

  async function editServerConfig(serverName: string) {
    toast.show({
      message: `Edit MCP server in opencode.json:\n\n"mcp": {\n  "${serverName}": {\n    ...\n  }\n}\n\nThen press 'f' to refresh`,
      variant: "info",
    })
  }

  async function removeServer(serverName: string) {
    toast.show({
      message: `To remove ${serverName}, delete it from opencode.json and press 'f' to refresh`,
      variant: "info",
    })
  }

  if (mcpServers().length === 0) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD}>MCP Manager</text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box gap={1} flexDirection="column">
          <text>No MCP servers configured</text>
          <text fg={theme.textMuted}>Add MCP servers in your opencode.json configuration file</text>
          <box marginTop={1} flexDirection="column">
            <text attributes={TextAttributes.BOLD}>Example (Local Server):</text>
            <text fg={theme.textMuted}>{`{`}</text>
            <text fg={theme.textMuted}> "mcp": {`{`}</text>
            <text fg={theme.textMuted}> "filesystem": {`{`}</text>
            <text fg={theme.textMuted}> "type": "local",</text>
            <text fg={theme.textMuted}>
              {" "}
              "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
            </text>
            <text fg={theme.textMuted}> "enabled": true</text>
            <text fg={theme.textMuted}> {`}`}</text>
            <text fg={theme.textMuted}> {`}`}</text>
            <text fg={theme.textMuted}>{`}`}</text>
          </box>
          <box marginTop={1} flexDirection="column">
            <text attributes={TextAttributes.BOLD}>Example (Remote Server):</text>
            <text fg={theme.textMuted}>{`{`}</text>
            <text fg={theme.textMuted}> "mcp": {`{`}</text>
            <text fg={theme.textMuted}> "remote-api": {`{`}</text>
            <text fg={theme.textMuted}> "type": "remote",</text>
            <text fg={theme.textMuted}> "url": "http://localhost:3000/mcp",</text>
            <text fg={theme.textMuted}>
              {" "}
              "headers": {`{`} "Authorization": "Bearer token" {`}`}
            </text>
            <text fg={theme.textMuted}> {`}`}</text>
            <text fg={theme.textMuted}> {`}`}</text>
            <text fg={theme.textMuted}>{`}`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.textMuted}>Press 'a' to get add server template</text>
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
        showServerDetails(option.value)
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
            await showServerDetails(option.value)
          },
        },
        {
          keybind: Keybind.parse("t")[0],
          title: "tools",
          onTrigger: async (option) => {
            await listServerTools(option.value)
          },
        },
        {
          keybind: Keybind.parse("e")[0],
          title: "edit",
          onTrigger: async (option) => {
            await editServerConfig(option.value)
          },
        },
        {
          keybind: Keybind.parse("a")[0],
          title: "add",
          onTrigger: async () => {
            await addNewServer()
          },
        },
        {
          keybind: Keybind.parse("d")[0],
          title: "delete",
          onTrigger: async (option) => {
            await removeServer(option.value)
          },
        },
        {
          keybind: Keybind.parse("s")[0],
          title: "status",
          onTrigger: async (option) => {
            const server = sync.data.mcp[option.value]
            if (!server) return

            const statusInfo = `
Server: ${option.value}
Status: ${server.status}
${"error" in server && server.error ? `Error: ${server.error}\n` : ""}
Type: MCP Server
Tools: Press 't' to list
            `.trim()

            toast.show({
              message: statusInfo,
              variant: "info",
            })
          },
        },
      ]}
    />
  )
}
