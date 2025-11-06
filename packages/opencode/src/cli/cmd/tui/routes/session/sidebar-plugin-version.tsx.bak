import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Show, Switch, Match, onMount, onCleanup } from "solid-js"
import { useTheme } from "../../context/theme"
import { useUIExtensions } from "../../context/ui-extensions"
import { PluginComponent } from "../../component/plugin-component"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk"
import { TextAttributes } from "@opentui/core"
import { ContextUsageBar } from "../../component/context-usage-bar"
import { useLocal } from "../../context/local"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useToast } from "../../ui/toast"
import { useSDK } from "../../context/sdk"
import { useDialog } from "../../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useRoute } from "../../context/route"
import { $ } from "bun"
type TabType = "files" | "todos" | "tools"

export function Sidebar(props: { sessionID: string; onToggle: () => void }) {
  const sync = useSync()
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const local = useLocal()
  const renderer = useRenderer()
  const toast = useToast()
  const sdk = useSDK()
  const dialog = useDialog()
  const [activeTab, setActiveTab] = createSignal<TabType>("tools")
  const [serverStatus, setServerStatus] = createSignal<"connected" | "disconnected">("connected")

  // Extract port from URL
  const port = sdk.url.split(":").pop() || "unknown"

  // Ping server periodically
  let pingInterval: NodeJS.Timeout
  onMount(() => {
    pingInterval = setInterval(async () => {
      try {
        const response = await fetch(`${sdk.url}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(1000),
        })
        setServerStatus(response.ok ? "connected" : "disconnected")
      } catch {
        setServerStatus("disconnected")
      }
    }, 5000)
  })

  onCleanup(() => {
    if (pingInterval) clearInterval(pingInterval)
  })

  const showServerDialog = () => {
    const options: DialogSelectOption<string>[] = [
      {
        title: "Restart Server",
        value: "restart",
        description: "Restart the OpenCode server",
        onSelect: async (ctx) => {
          ctx.clear()
          try {
            await fetch(`${sdk.url}/server/restart`, { method: "POST" })
          } catch (error) {
            console.error("Failed to restart server:", error)
          }
        },
      },
      {
        title: "Copy Server URL",
        value: "copy",
        description: `Copy ${sdk.url} to clipboard`,
        onSelect: (ctx) => {
          console.log("Server URL:", sdk.url)
          ctx.clear()
        },
      },
    ]

    dialog.replace(() => <DialogSelect title="Server Management" options={options} />)
  }
  const [expandedMcpServers, setExpandedMcpServers] = createSignal<Set<string>>(new Set())
  const [mcpTools, setMcpTools] = createSignal<Record<string, Record<string, any>>>({})
  const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = createSignal("")
  const [isCommitting, setIsCommitting] = createSignal(false)
  const [committedFiles, setCommittedFiles] = createSignal<Set<string>>(new Set())
  const [projectFavorites, setProjectFavorites] = createSignal<Set<string>>(new Set())
  const [globalFavorites, setGlobalFavorites] = createSignal<Set<string>>(new Set())
  const uiExtensions = useUIExtensions()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  // Load favorite tools from config
  const loadFavorites = async () => {
    try {
      const response = await fetch(`${sdk.url}/favorite-tools`)
      if (response.ok) {
        const favorites: { project: string[]; global: string[] } = await response.json()
        setProjectFavorites(new Set(favorites.project || []))
        setGlobalFavorites(new Set(favorites.global || []))
      }
    } catch (error) {
      console.error("Failed to load favorite tools", error)
    }
  }

  // Load favorites on mount
  loadFavorites()

  // Get favorite level for a tool
  const getFavoriteLevel = (toolId: string): "none" | "project" | "global" => {
    if (globalFavorites().has(toolId)) return "global"
    if (projectFavorites().has(toolId)) return "project"
    return "none"
  }

  // Cycle through favorite states: none → project → global → none
  const cycleFavorite = async (toolId: string) => {
    console.log("[Sidebar] Cycling favorite for tool:", toolId)
    const requestBody = { toolId }
    console.log("[Sidebar] Request body:", JSON.stringify(requestBody))
    try {
      const response = await fetch(`${sdk.url}/favorite-tools/cycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })
      console.log("[Sidebar] Cycle response status:", response.status, "ok:", response.ok)

      const responseText = await response.text()
      console.log("[Sidebar] Response text:", responseText)

      let result: { toolId: string; level: "none" | "project" | "global" }
      try {
        result = JSON.parse(responseText)
        console.log("[Sidebar] Parsed response:", result)
      } catch (e) {
        console.error("[Sidebar] Failed to parse response:", e)
        throw new Error(`Invalid JSON response: ${responseText}`)
      }

      if (response.ok) {
        const level = result.level
        console.log("[Sidebar] New favorite level:", level)

        // Update local state
        setProjectFavorites((prev) => {
          const newSet = new Set(prev)
          if (level === "project") {
            newSet.add(toolId)
          } else {
            newSet.delete(toolId)
          }
          return newSet
        })

        setGlobalFavorites((prev) => {
          const newSet = new Set(prev)
          if (level === "global") {
            newSet.add(toolId)
          } else {
            newSet.delete(toolId)
          }
          return newSet
        })

        // Show toast notification
        const messages: Record<"none" | "project" | "global", string> = {
          none: "Removed from favorites",
          project: "Added to project favorites",
          global: "Added to global favorites",
        }
        toast.show({ variant: "info", message: messages[level] })
      } else {
        console.error("[Sidebar] Cycle request failed with status:", response.status)
        toast.show({
          variant: "error",
          message: `Failed to update favorite (status ${response.status})`,
        })
      }
    } catch (error) {
      console.error("[Sidebar] Failed to cycle favorite", error)
      toast.show({ variant: "error", message: "Failed to update favorite" })
    }
  }

  // Check which files are committed
  const checkCommittedFiles = async () => {
    try {
      const diffs = session().summary?.diffs || []
      if (diffs.length === 0) return

      const { $ } = await import("bun")
      const result = await $`git status --short`.text().catch(() => "")
      const uncommittedSet = new Set(
        result
          .split("\n")
          .filter(Boolean)
          .map((line) => line.substring(3).trim()),
      )

      const committed = new Set<string>()
      for (const diff of diffs) {
        if (!uncommittedSet.has(diff.file)) {
          committed.add(diff.file)
        }
      }
      setCommittedFiles(committed)
    } catch (error) {
      console.error("Failed to check git status", error)
    }
  }

  // Check committed files when tab switches to files
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    if (tab === "files") {
      checkCommittedFiles()
    }
  }

  const uncommittedFiles = createMemo(() => {
    const diffs = session().summary?.diffs || []
    return diffs.filter((d) => !committedFiles().has(d.file))
  })

  // Add keyboard shortcuts for tab switching (ctrl+1/2/3)
  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "1") handleTabChange("tools")
    if (evt.ctrl && evt.name === "2") handleTabChange("todos")
    if (evt.ctrl && evt.name === "3") handleTabChange("files")
  })

  // Track tools used in this session
  const toolsUsed = createMemo(() => {
    const toolCounts: Record<string, number> = {}

    // Get all parts for messages in this session
    messages().forEach((msg) => {
      const parts = sync.data.part[msg.id] || []
      parts.forEach((part) => {
        if (part.type === "tool" && part.state?.status === "completed") {
          const toolName = part.tool
          // Skip the invalid tool - it's an internal error handler
          if (toolName === "invalid") return
          toolCounts[toolName] = (toolCounts[toolName] || 0) + 1
        }
      })
    })

    // Convert to array and sort by favorites first, then usage
    return Object.entries(toolCounts)
      .sort((a, b) => {
        const aLevel = getFavoriteLevel(a[0])
        const bLevel = getFavoriteLevel(b[0])

        // Sort by favorite level first (global > project > none)
        const levelOrder = { global: 0, project: 1, none: 2 }
        const levelDiff = levelOrder[aLevel] - levelOrder[bLevel]
        if (levelDiff !== 0) return levelDiff

        // Then by usage count
        return b[1] - a[1]
      })
      .slice(0, 10) // Top 10
  })

  // Get star icon based on favorite level
  const getStarIcon = (toolId: string): string => {
    return "⭑" // Same star for all levels, color distinguishes them
  }

  async function handleCommit() {
    if (selectedFiles().size === 0 || !commitMessage() || isCommitting()) return
    setIsCommitting(true)
    try {
      const files = Array.from(selectedFiles())
      const gitAdd = files.map((f) => `git add "${f}"`).join(" && ")
      const gitCommit = `git commit -m "${commitMessage().replace(/"/g, '\\"')}"`
      const command = `${gitAdd} && ${gitCommit}`

      const response = await fetch(`${sdk.url}/bash/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, description: "Commit changes" }),
      })

      if (response.ok) {
        setSelectedFiles(new Set<string>())
        setCommitMessage("")
      }
    } catch (error) {
      console.error("Commit failed:", error)
    } finally {
      setIsCommitting(false)
    }
  }

  async function toggleMcpServer(serverName: string) {
    const expanded = expandedMcpServers()
    const newExpanded = new Set(expanded)

    if (expanded.has(serverName)) {
      newExpanded.delete(serverName)
    } else {
      newExpanded.add(serverName)
      // Load tools if not already loaded
      if (!mcpTools()[serverName]) {
        try {
          const response = await fetch(`${sdk.url}/mcp/${encodeURIComponent(serverName)}/tools`)
          if (response.ok) {
            const tools = await response.json()
            setMcpTools((prev) => ({ ...prev, [serverName]: tools }))
          }
        } catch (error) {
          console.error(`Failed to load tools for ${serverName}:`, error)
          setMcpTools((prev) => ({ ...prev, [serverName]: {} }))
        }
      }
    }

    setExpandedMcpServers(newExpanded)
  }

  // Debug: Log UI extensions data
  createMemo(() => {
    const extensions = uiExtensions.extensions()
    console.log("[Sidebar] UI Extensions:", extensions)
    console.log("[Sidebar] Widgets:", extensions?.widgets)
    console.log("[Sidebar] Panels:", extensions?.panels)
  })

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast(
      (x) => x.role === "assistant" && x.tokens?.output > 0,
    ) as AssistantMessage
    if (!last || !last.tokens)
      return {
        tokens: 0,
        tokenLimit: 0,
        tokensFormatted: "0",
        percentage: 0,
        systemTokens: 0,
        assistantTokens: 0,
        userTokens: 0,
        toolTokens: 0,
      }

    // System prompt (cache write tokens - this is the initial system context)
    const systemTokens = last.tokens.cache?.write || 0

    // Assistant tokens (output from model)
    const assistantTokens = (last.tokens.output || 0) + (last.tokens.reasoning || 0)

    // User tokens (input excluding cache, since cache is system)
    const userTokens = Math.max(0, (last.tokens.input || 0) - (last.tokens.cache?.read || 0))

    // Tool tokens (cache read - these are tool definitions/results)
    const toolTokens = last.tokens.cache?.read || 0

    const total = systemTokens + assistantTokens + userTokens + toolTokens
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    const tokenLimit = model?.limit.context || 0

    return {
      tokens: total,
      tokenLimit,
      tokensFormatted: total.toLocaleString(),
      percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
      systemTokens,
      assistantTokens,
      userTokens,
      toolTokens,
    }
  })

  return (
    <Show when={session()}>
      <box flexShrink={0} gap={1} width={40}>
        <box flexDirection="row" justifyContent="space-between" paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            CODESURF
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              props.onToggle()
            }}
          >
            ▶
          </text>
        </box>
        <box>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              showServerDialog()
            }}
          >
            server:{port}
          </text>
        </box>
        <box>
          <text fg={theme.text} wrapMode="word" attributes={TextAttributes.BOLD}>
            {session().title}
          </text>
          <Show when={session().share?.url}>
            <text fg={theme.textMuted}>{session().share!.url}</text>
          </Show>
        </box>
        <box>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Context
          </text>
          <PluginComponent
            componentId="context-panel"
            context={{ sessionID: props.sessionID, messages, sync: sync.data }}
          />
        </box>

        {/* Tabs - Plugin UI */}
        <PluginComponent
          componentId="sidebar-tabs"
          context={{
            sessionID: props.sessionID,
            theme,
            renderer,
            sdk,
            toast,
            dialog,
            navigate,
            sync: sync.data,
            session,
            todo,
            toolsUsed,
            projectFavorites,
            globalFavorites,
            setProjectFavorites,
            setGlobalFavorites,
            uiExtensions,
          }}
        />

        {/* Subagents Plugin */}
        <PluginComponent
          componentId="subagents-panel"
          context={{
            sessionID: props.sessionID,
            theme,
            renderer,
            sdk,
            navigate,
          }}
        />
      </box>
    </Show>
  )
}
