import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Show, Switch, Match, onMount, type JSX } from "solid-js"
import { useTheme } from "../../context/theme"
import { useUIExtensions } from "../../context/ui-extensions"
import { PluginComponent } from "../../component/plugin-component"
import { Locale } from "@/util/locale"
import path from "path"
import { promises as fs } from "fs"
import type { AssistantMessage, Session, Todo as SDKTodo } from "@opencode-ai/sdk"
import { RGBA, TextAttributes } from "@opentui/core"
import { ContextUsageBar } from "../../component/context-usage-bar"
import { useLocal } from "../../context/local"
import { resolveThemeColor } from "../../context/theme"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useToast } from "../../ui/toast"
import { useSDK } from "../../context/sdk"
import { useDialog } from "../../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useRoute } from "../../context/route"
import { $ } from "bun"
import { DialogSubagentAdd } from "../../component/dialog-subagent-add"
import { DialogContextAdd } from "../../component/dialog-context-add"
import { DialogContextEdit } from "../../component/dialog-context-edit"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { AgentChipText } from "../../component/agent-chip-text"
import { Todo } from "@/session/todo"
import { Perf } from "@/util/perf"
import { ContextIntelligence } from "@/session/context-intelligence"
import { DialogContextTimeline } from "./dialog-context-timeline"
import { useServerStatus } from "../../context/server-status"
type TabType = "files" | "todos" | "tools" | "subagents"

function parseSubagentTitle(title: string): { agent?: string; description: string } {
  const trimmed = title.trim()
  if (!trimmed) return { description: "" }

  const suffixMatch = /\((@[A-Za-z0-9_-]+)\s+subagent\)\s*$/i.exec(trimmed)
  if (suffixMatch && suffixMatch.index !== undefined) {
    const description = trimmed.slice(0, suffixMatch.index).trim()
    return { agent: suffixMatch[1], description: description || trimmed }
  }

  const prefixMatch = /^([@\[][@\w-]+[\]]?)\s+(.*)$/.exec(trimmed)
  if (prefixMatch) {
    return { agent: prefixMatch[1], description: prefixMatch[2].trim() }
  }

  return { description: trimmed }
}

type ContextItem = {
  id: string
  name: string
  content: string
  tags: string[]
  activeTags: Set<string>
  compact: boolean
  lastUpdated: number
}

type ContextChip = {
  tag: string
  count: number
}

const CONTEXT_STOP_WORDS = new Set([
  "the",
  "this",
  "that",
  "with",
  "from",
  "have",
  "using",
  "into",
  "over",
  "just",
  "then",
  "than",
  "when",
  "where",
  "your",
  "about",
  "which",
  "their",
  "there",
  "after",
  "before",
  "because",
  "while",
  "should",
  "could",
  "would",
])

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const emptyContextSummary = {
  tokens: 0,
  tokenLimit: 0,
  tokensFormatted: "0",
  percentage: 0,
  systemTokens: 0,
  assistantTokens: 0,
  userTokens: 0,
  toolTokens: 0,
  freePercentage: 0,
  promptTokens: 0,
  cachedTokens: 0,
  cachedTokensFormatted: "0",
}

function generateContextTags(content: string): string[] {
  const cleaned = Locale.stripMarkdown(content).toLowerCase()
  const words = cleaned.split(/[^a-z0-9#]+/g).filter(Boolean)
  const counts = new Map<string, number>()
  for (const raw of words) {
    if (raw.length < 3 && !raw.startsWith("#")) continue
    const normalized = raw.startsWith("#") ? raw : raw.replace(/[^a-z0-9]/g, "")
    if (!normalized || CONTEXT_STOP_WORDS.has(normalized)) continue
    const tag = normalized.startsWith("#") ? normalized : `#${normalized}`
    counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag)
}

function createContextItem(id: string, name: string, content: string): ContextItem {
  const tags = generateContextTags(content)
  return {
    id,
    name,
    content,
    tags,
    activeTags: new Set(tags),
    compact: false,
    lastUpdated: Date.now(),
  }
}

function summarizeContent(content: string, limit: number) {
  const text = Locale.stripMarkdown(content).replace(/\s+/g, " ").trim()
  if (!text) return "(no content)"
  return Locale.truncate(text, limit)
}

function formatTimestamp(timestamp: number) {
  return Locale.time(timestamp)
}

export function Sidebar(props: {
  sessionID: string
  onToggle: () => void
  width: number
  minWidth: number
  maxWidth: number
  widthStep: number
  onResize: (delta: number) => void
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const local = useLocal()
  const renderer = useRenderer()
  const toast = useToast()
  const sdk = useSDK()
  const dialog = useDialog()
  const serverStatus = useServerStatus()
  const [activeTab, setActiveTab] = createSignal<TabType>("tools")

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
        description: `Copy ${serverStatus.url()} to clipboard`,
        onSelect: (ctx) => {
          Promise.resolve(serverStatus.copyUrl()).finally(() => ctx.clear())
        },
      },
    ]

    dialog.replace(() => <DialogSelect title="Server Management" options={options} />)
  }
  const [expandedMcpServers, setExpandedMcpServers] = createSignal<Set<string>>(new Set())
  const [mcpTools, setMcpTools] = createSignal<Record<string, Record<string, unknown>>>({})
  const [expandedPlugins, setExpandedPlugins] = createSignal<Set<string>>(new Set())
  const [pluginTools, setPluginTools] = createSignal<Record<string, Array<{ name: string } | string>>>({})
  const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = createSignal("")
  const [isCommitting, setIsCommitting] = createSignal(false)
  const [committedFiles, setCommittedFiles] = createSignal<Set<string>>(new Set())
  const [projectFavorites, setProjectFavorites] = createSignal<Set<string>>(new Set())
  const [globalFavorites, setGlobalFavorites] = createSignal<Set<string>>(new Set())
  const [isAddingTodo, setIsAddingTodo] = createSignal(false)
  const [expandedSections, setExpandedSections] = createSignal<Set<string>>(new Set(["toolsUsed"]))
  const [expandedTodos, setExpandedTodos] = createSignal<Set<string>>(new Set())
  const [optimisticTodos, setOptimisticTodos] = createSignal<
    Array<{ id: string; content: string; status: string; priority: string }>
  >([])
  const [contexts, setContexts] = createSignal<Array<{ id: string; name: string; content: string }>>([])

  const persistContexts = async (items: Array<{ id: string; name: string; content: string }>) => {
    try {
      const projectDir = process.cwd()
      const targetDir = path.join(projectDir, ".opencode", "context")
      await fs.mkdir(targetDir, { recursive: true })
      await fs.writeFile(path.join(targetDir, `${props.sessionID}.json`), JSON.stringify(items, null, 2))
    } catch (error) {
      console.error("Failed to persist contexts", error)
    }
  }
  const [activeContextIds, setActiveContextIds] = createSignal<Set<string>>(new Set())
  const sortedContexts = createMemo(() => {
    return [...contexts()].sort((a, b) => {
      const aIsHighPriority = a.name.startsWith("!")
      const bIsHighPriority = b.name.startsWith("!")
      if (aIsHighPriority && !bIsHighPriority) return -1
      if (!aIsHighPriority && bIsHighPriority) return 1
      const aIsNegative = a.name.startsWith("-")
      const bIsNegative = b.name.startsWith("-")
      if (!aIsNegative && bIsNegative) return -1
      if (aIsNegative && !bIsNegative) return 1
      return 0
    })
  })

  const uiExtensions = useUIExtensions()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const serverTodos = createMemo(() => sync.data.todo[props.sessionID] ?? [])

  // Merge optimistic todos with server todos
  const todo = createMemo(() => {
    const optimistic = optimisticTodos()
    const server = serverTodos()

    // Remove optimistic todos that now exist on server
    const serverContents = new Set(server.map((t) => t.content))
    const validOptimistic = optimistic.filter((t) => !serverContents.has(t.content))

    // Update optimistic list if we removed any
    if (validOptimistic.length !== optimistic.length) {
      setOptimisticTodos(validOptimistic)
    }

    return [...validOptimistic, ...server]
  })
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const messageStats = createMemo(
    Perf.track("sidebar.messageStats", () => {
      const stats: {
        toolCounts: Map<string, number>
        lastAssistant?: AssistantMessage
        lastAssistantTokenLimit: number
        totalCost: number
        savedCost: number
      } = {
        toolCounts: new Map(),
        lastAssistant: undefined,
        lastAssistantTokenLimit: 0,
        totalCost: 0,
        savedCost: 0,
      }
      const providersById = new Map(sync.data.provider.map((provider) => [provider.id, provider]))

      for (const msg of messages()) {
        if (msg.role === "assistant") {
          stats.totalCost += msg.cost
          if ((msg.tokens?.output || 0) > 0) {
            stats.lastAssistant = msg as AssistantMessage
            stats.lastAssistantTokenLimit = providersById.get(msg.providerID)?.models[msg.modelID]?.limit.context || 0
          }

          const model = providersById.get(msg.providerID)?.models[msg.modelID]
          if (model && msg.tokens) {
            const cacheRead = msg.tokens.cache?.read || 0
            const cacheReadCostPer1k = model.cost.cache_read || model.cost.input * 0.1
            stats.savedCost += (cacheRead / 1000) * (model.cost.input - cacheReadCostPer1k)
          }
        }

        const msgParts = sync.data.part[msg.id] || []
        for (const part of msgParts) {
          if (part.type === "tool" && part.state?.status === "completed" && part.tool !== "invalid") {
            const current = stats.toolCounts.get(part.tool) || 0
            stats.toolCounts.set(part.tool, current + 1)
          }
        }
      }

      return stats
    }),
  )

  // Deduplicate plugins by name to avoid showing duplicates
  const uniquePlugins = createMemo(() => {
    const seen = new Map()
    for (const plugin of sync.data.plugin) {
      if (!seen.has(plugin.name)) {
        seen.set(plugin.name, plugin)
      }
    }
    return Array.from(seen.values())
  })
  const canShrink = () => props.width > props.minWidth
  const canGrow = () => props.width < props.maxWidth

  // Context management functions

  const createContext = () => {
    dialog.replace(() => (
      <DialogContextAdd
        onConfirm={async (name: string, content: string) => {
          const id = `ctx_${Date.now()}`
          setContexts((prev) => {
            const next = [...prev, { id, name, content }]
            void persistContexts(next)
            return next
          })

          // Start background analysis
          if (content.trim().length > 0) {
            try {
              // Fetch URL content if present
              const enrichedContent = await ContextIntelligence.fetchContextContent(content)
              if (enrichedContent !== content) {
                setContexts((prev) => prev.map((c) => (c.id === id ? { ...c, content: enrichedContent } : c)))
              }

              // Analyze in background without blocking UI
              ContextIntelligence.processContextBackground({
                id,
                name,
                content: enrichedContent,
              })
                .then((analysis) => {
                  toast.show({
                    variant: "info",
                    message: `Context "${name}" analyzed - Priority: ${analysis.traffic_light_prediction.priority}`,
                    duration: 2000,
                  })
                })
                .catch((error) => {
                  console.warn("Context analysis failed:", error)
                })
            } catch (error) {
              console.warn("Context processing failed:", error)
            }
          }
        }}
      />
    ))
  }

  const editContextContent = (contextId: string) => {
    const ctx = contexts().find((c) => c.id === contextId)
    if (!ctx) return

    dialog.replace(() => (
      <DialogContextEdit
        name={ctx.name}
        content={ctx.content}
        onConfirm={(content: string) => {
          setContexts((prev) => prev.map((c) => (c.id === contextId ? { ...c, content } : c)))
        }}
      />
    ))
  }

  const deleteContext = (contextId: string) => {
    const ctx = contexts().find((c) => c.id === contextId)
    if (!ctx) return

    setContexts((prev) => prev.filter((c) => c.id !== contextId))
    setActiveContextIds((prev) => {
      const newSet = new Set(prev)
      newSet.delete(contextId)
      return newSet
    })
    toast.show({ variant: "success", message: `Deleted context: ${ctx.name}` })
  }

  const toggleContext = (contextId: string) => {
    setActiveContextIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(contextId)) {
        newSet.delete(contextId)
      } else {
        newSet.add(contextId)
      }
      return newSet
    })
  }

  // Get child sessions reactively from sync.data (SSE-based, no polling)
  const childSessions = createMemo(() =>
    sync.data.session.filter((x) => x.parentID === props.sessionID).toSorted((a, b) => b.id.localeCompare(a.id)),
  )

  // Track expanded state per agent group in Subagents section
  const [expandedAgentGroups, setExpandedAgentGroups] = createSignal<Set<string>>(new Set())

  // Group child sessions by parsed agent name (e.g. "@GENERAL")
  const subagentGroups = createMemo(() => {
    const groups = new Map<string, Session[]>()
    for (const child of childSessions()) {
      const parsed = parseSubagentTitle(child.title)
      const name = parsed.agent || "@GENERAL"
      const arr = groups.get(name)
      if (arr) arr.push(child)
      else groups.set(name, [child])
    }
    return Array.from(groups.entries()).map(([agent, items]) => ({ agent, items }))
  })

  // Load favorite tools from config (one-time load, no polling)
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

  // Load favorites once on mount (no polling needed)
  onMount(() => {
    loadFavorites()
  })

  // Get favorite level for a tool
  const getFavoriteLevel = (toolId: string): "none" | "project" | "global" => {
    if (globalFavorites().has(toolId)) return "global"
    if (projectFavorites().has(toolId)) return "project"
    return "none"
  }

  // Cycle through favorite states: none → project → global → none
  const cycleFavorite = async (toolId: string) => {
    try {
      const response = await fetch(`${sdk.url}/favorite-tools/cycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId }),
      })

      const responseText = await response.text()

      let result: { toolId: string; level: "none" | "project" | "global" }
      try {
        result = JSON.parse(responseText)
      } catch (e) {
        console.error("[Sidebar] Failed to parse response:", e)
        throw new Error(`Invalid JSON response: ${responseText}`)
      }

      if (response.ok) {
        const level = result.level

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

  // Debounced git status check - only check after tab is open for 500ms
  let gitCheckTimeout: NodeJS.Timeout | undefined
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)

    // Clear any pending git check
    if (gitCheckTimeout) {
      clearTimeout(gitCheckTimeout)
      gitCheckTimeout = undefined
    }

    // Debounce git status check when switching to files tab
    if (tab === "files") {
      gitCheckTimeout = setTimeout(() => {
        checkCommittedFiles()
      }, 500)
    }
  }

  const uncommittedFiles = createMemo(() => {
    return diff().filter((d) => !committedFiles().has(d.file))
  })

  // Add keyboard shortcuts for tab switching (ctrl+1/2/3)
  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "1") handleTabChange("tools")
    if (evt.ctrl && evt.name === "2") handleTabChange("todos")
    if (evt.ctrl && evt.name === "3") handleTabChange("files")
  })

  // Track tools used in this session
  const toolsUsed = createMemo(
    Perf.track("sidebar.toolsUsed", () => {
      return Array.from(messageStats().toolCounts.entries())
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
    }),
  )

  // Favorite indicator circle based on level
  const getStarIcon = (toolId: string): { icon: string; color: string } => {
    const level = getFavoriteLevel(toolId)
    if (level === "global") return { icon: "●", color: "#FFFFFF" }
    if (level === "project") return { icon: "●", color: "#B3B3B3" }
    return { icon: "○", color: theme.textMuted }
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

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      // If clicking the already-open section, collapse it
      if (prev.has(sectionId)) {
        return new Set<string>()
      }
      // Otherwise, open only this section (mutually exclusive)
      return new Set<string>([sectionId])
    })
  }

  function toggleTodo(todoId: string) {
    setExpandedTodos((prev) => {
      const next = new Set(prev)
      if (next.has(todoId)) {
        next.delete(todoId)
      } else {
        next.add(todoId)
      }
      return next
    })
  }

  async function togglePlugin(pluginName: string) {
    const expanded = expandedPlugins()
    const newExpanded = new Set(expanded)

    if (expanded.has(pluginName)) {
      newExpanded.delete(pluginName)
    } else {
      newExpanded.add(pluginName)
      // Load plugin tools/functions if not already loaded
      if (!pluginTools()[pluginName]) {
        try {
          // Fetch available tools from the tool registry
          const response = await fetch(`${sdk.url}/tools`)
          if (response.ok) {
            const allTools = await response.json()
            // For now, show all tools as we don't have plugin-specific tool mapping
            // In the future, plugins could register their tools with metadata
            setPluginTools((prev) => ({ ...prev, [pluginName]: allTools || [] }))
          }
        } catch (error) {
          console.error(`Failed to load tools for ${pluginName}:`, error)
          setPluginTools((prev) => ({ ...prev, [pluginName]: [] }))
        }
      }
    }

    setExpandedPlugins(newExpanded)
  }

  async function handleAddTodo() {
    dialog.replace(() => (
      <DialogPrompt
        title="Add Todo"
        value=""
        onConfirm={async (content: string) => {
          if (!content.trim()) {
            toast.show({ variant: "error", message: "Todo cannot be empty" })
            return
          }

          // Immediately add optimistic todo
          const optimisticTodo = {
            id: `optimistic-${Date.now()}`,
            content: content.trim(),
            status: "pending",
            priority: "medium",
          }
          setOptimisticTodos((prev) => [optimisticTodo, ...prev])

          // Show immediate feedback
          toast.show({ variant: "success", message: "Todo added" })
          dialog.clear()

          // Silently notify agent in background (no await to prevent UI blocking)
          sdk.client.session
            .prompt({
              path: { id: props.sessionID },
              body: {
                parts: [
                  {
                    type: "text",
                    text: `Add this todo: ${content.trim()}`,
                  },
                ],
              },
            })
            .catch((error) => {
              console.error("Failed to notify agent about todo:", error)
              // Don't show error to user - they already see the todo
            })
        }}
        onCancel={() => {
          dialog.clear()
        }}
      />
    ))
  }

  function handleAddSubagent() {
    dialog.replace(() => <DialogSubagentAdd sessionID={props.sessionID} />)
  }

  // Debug: Log UI extensions data (commented out to reduce logging)
  // createMemo(() => {
  //   const extensions = uiExtensions.extensions()
  //   console.log("[Sidebar] UI Extensions:", extensions)
  //   console.log("[Sidebar] Widgets:", extensions?.widgets)
  //   console.log("[Sidebar] Panels:", extensions?.panels)
  // })

  const cost = createMemo(() => {
    const stats = messageStats()
    return {
      spent: currencyFormatter.format(stats.totalCost),
      saved: currencyFormatter.format(stats.savedCost),
    }
  })

  const context = createMemo(() => {
    const stats = messageStats()
    const last = stats.lastAssistant
    if (!last || !last.tokens) return emptyContextSummary

    const inputTokens = last.tokens.input || 0
    const cacheReadTokens = last.tokens.cache?.read || 0
    const cacheWriteTokens = last.tokens.cache?.write || 0

    const assistantTokens = (last.tokens.output || 0) + (last.tokens.reasoning || 0)

    let systemTokens = 0
    let userTokens = inputTokens
    let cachedTokens = cacheReadTokens

    if (cacheReadTokens > 0) {
      systemTokens = cacheReadTokens
    } else if (cacheWriteTokens > 0) {
      systemTokens = Math.min(cacheWriteTokens, inputTokens)
      userTokens = Math.max(0, inputTokens - systemTokens)
      cachedTokens = 0
    }

    const toolTokens = 0

    const total = systemTokens + assistantTokens + userTokens + toolTokens
    const tokenLimit = stats.lastAssistantTokenLimit

    const promptTokens = systemTokens + userTokens
    const freePercentage = promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 100) : 0

    return {
      tokens: total,
      tokenLimit,
      tokensFormatted: total.toLocaleString(),
      percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
      freePercentage,
      systemTokens,
      assistantTokens,
      userTokens,
      toolTokens,
      promptTokens,
      cachedTokens,
      cachedTokensFormatted: cachedTokens.toLocaleString(),
    }
  })

  return (
    <Show when={session()}>
      <box flexShrink={0} gap={1} width={props.width}>
        <box flexDirection="row" justifyContent="space-between" paddingRight={1} alignItems="center">
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            CODESURF
          </text>
          <box flexDirection="row" gap={1} alignItems="center">
            <box flexDirection="row" gap={0} alignItems="center">
              <text
                fg={canShrink() ? theme.textMuted : theme.border}
                wrapMode="none"
                onMouseUp={(evt) => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  if (!canShrink()) return
                  props.onResize(-props.widthStep)
                  evt.stopPropagation?.()
                }}
              >
                -
              </text>
              <text fg={theme.textMuted} wrapMode="none">
                {props.width}c
              </text>
              <text
                fg={canGrow() ? theme.textMuted : theme.border}
                wrapMode="none"
                onMouseUp={(evt) => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  if (!canGrow()) return
                  props.onResize(props.widthStep)
                  evt.stopPropagation?.()
                }}
              >
                +
              </text>
            </box>
            <text
              fg={theme.textMuted}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                props.onToggle()
              }}
            >
              ◀
            </text>
          </box>
        </box>

        <box>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              showServerDialog()
            }}
          >
            server:{serverStatus.port()}
          </text>
        </box>

        <box>
          <box flexDirection="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
            <box flexGrow={1}>
              <text fg={theme.text} wrapMode="word" attributes={TextAttributes.BOLD}>
                {session().title}
              </text>
            </box>
            <text
              fg={theme.accent}
              flexShrink={0}
              attributes={TextAttributes.UNDERLINE}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                dialog.replace(() => <DialogSessionRename session={props.sessionID} />)
              }}
            >
              Rename
            </text>
          </box>
          <Show when={session().share?.url}>
            <text fg={theme.textMuted}>{session().share!.url}</text>
          </Show>
        </box>
        <box>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Context
          </text>
          {(() => {
            const agentColor = createMemo<RGBA>(() => {
              const color = local.agent.color("assistant")
              if (color instanceof RGBA) return color
              if (typeof color === "string") {
                return color.startsWith("#") ? RGBA.fromHex(color) : RGBA.fromHex(`#${color}`)
              }
              return resolveThemeColor(theme.accent)
            })

            return (
              <ContextUsageBar
                currentTokens={context().tokens}
                tokenLimit={context().tokenLimit}
                systemTokens={context().systemTokens}
                assistantTokens={context().assistantTokens}
                userTokens={context().userTokens}
                toolTokens={context().toolTokens}
                agentColor={agentColor()}
                systemColor={resolveThemeColor(theme.textMuted)}
                assistantColor={resolveThemeColor(theme.accent)}
                toolColor={resolveThemeColor(theme.warning)}
                userColor={resolveThemeColor(theme.secondary)}
                backgroundColor={resolveThemeColor(theme.backgroundPanel)}
                width={props.width}
              />
            )
          })()}

          <text fg={theme.textMuted}>
            {context().tokensFormatted} tokens ({context().freePercentage}% prompt cached)
          </text>
          <text fg={theme.textMuted}>
            {cost().spent} spent (saved {cost().saved})
          </text>
          <text fg={theme.textMuted} wrapMode="word"></text>
        </box>

        <box flexDirection="row" gap={0} width={props.width}>
          <text
            style={{
              fg: activeTab() === "tools" ? theme.text : theme.textMuted,
              bg: theme.backgroundPanel,
              attributes: activeTab() === "tools" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => handleTabChange("tools")}
          >
            {activeTab() === "tools" ? "● " : "○ "}Tools(
            {toolsUsed().length + Object.keys(sync.data.mcp).length + sync.data.lsp.length + uniquePlugins().length}
            ){" "}
          </text>

          <text
            style={{
              fg: activeTab() === "todos" ? theme.text : theme.textMuted,
              bg: theme.backgroundPanel,
              attributes: activeTab() === "todos" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => handleTabChange("todos")}
          >
            {activeTab() === "todos" ? "●" : "○"} Todos({todo().length}){" "}
          </text>
          <text
            style={{
              fg: activeTab() === "files" ? theme.text : theme.textMuted,
              bg: theme.backgroundPanel,
              attributes: activeTab() === "files" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => handleTabChange("files")}
          >
            {activeTab() === "files" ? "●" : "○"} Files({diff().length}){" "}
          </text>
        </box>

        {/* Tab Content */}
        <Show when={activeTab() === "tools"}>
          <Show when={toolsUsed().length > 0}>
            <box marginTop={0}>
              <text
                attributes={TextAttributes.BOLD}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  toggleSection("toolsUsed")
                }}
              >
                {expandedSections().has("toolsUsed") ? "▼" : "▶"} Tools Used {`(${toolsUsed().length})`}
              </text>
              <Show when={expandedSections().has("toolsUsed")}>
                <For each={toolsUsed()}>
                  {([toolName, count]) => {
                    const isClaudeCode = toolName.startsWith("cc_")
                    const star = createMemo(() => getStarIcon(toolName))
                    return (
                      <box flexDirection="row" gap={1} justifyContent="space-between">
                        <box flexDirection="row" gap={1}>
                          <text
                            fg={star().color}
                            onMouseUp={() => {
                              if (renderer.getSelection()?.getSelectedText()) return
                              cycleFavorite(toolName)
                            }}
                          >
                            {star().icon}
                          </text>
                          <text
                            fg={isClaudeCode ? theme.accent : theme.text}
                            onMouseUp={() => {
                              if (renderer.getSelection()?.getSelectedText()) return
                              cycleFavorite(toolName)
                            }}
                          >
                            {toolName}
                          </text>
                        </box>
                        <text fg={theme.textMuted}>×{count}</text>
                      </box>
                    )
                  }}
                </For>
              </Show>
            </box>
          </Show>
          <Show when={toolsUsed().length === 0}>
            <box marginTop={0}>
              <text fg={theme.textMuted}>
                <i>No tools used yet. Favorites will appear here when used.</i>
              </text>
            </box>
          </Show>
          <Show when={sync.data.lsp.length > 0}>
            <box marginTop={0}>
              <text
                attributes={TextAttributes.BOLD}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  toggleSection("lsp")
                }}
              >
                {expandedSections().has("lsp") ? "▼" : "▶"} LSP {`(${sync.data.lsp.length})`}
              </text>
              <Show when={expandedSections().has("lsp")}>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Show>
          <Show when={Object.keys(sync.data.mcp).length > 0}>
            <box marginTop={0}>
              <text
                attributes={TextAttributes.BOLD}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  toggleSection("mcp")
                }}
              >
                {expandedSections().has("mcp") ? "▼" : "▶"} MCP {`(${Object.keys(sync.data.mcp).length})`}
              </text>
              <Show when={expandedSections().has("mcp")}>
                <For each={Object.entries(sync.data.mcp)}>
                  {([key, item]) => (
                    <box flexDirection="column">
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: {
                              connected: theme.success,
                              failed: theme.error,
                              disabled: theme.textMuted,
                            }[item.status],
                          }}
                        >
                          •
                        </text>
                        <text
                          wrapMode="word"
                          fg={theme.accent}
                          attributes={TextAttributes.BOLD}
                          onMouseUp={() => {
                            if (renderer.getSelection()?.getSelectedText()) return
                            toggleMcpServer(key)
                          }}
                        >
                          {expandedMcpServers().has(key) ? "▼" : "▶"} {key}
                        </text>
                        <text fg={theme.textMuted}>
                          <Switch>
                            <Match when={item.status === "connected"}>Connected</Match>
                            <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                            <Match when={item.status === "disabled"}>Disabled</Match>
                          </Switch>
                        </text>
                      </box>
                      <Show when={expandedMcpServers().has(key) && mcpTools()[key]}>
                        <box marginLeft={3} flexDirection="column">
                          <For each={Object.entries(mcpTools()[key] || {})}>
                            {([toolName]) => {
                              const star = createMemo(() => getStarIcon(toolName))
                              return (
                                <box flexDirection="row" gap={1}>
                                  <text
                                    fg={star().color}
                                    onMouseUp={() => {
                                      if (renderer.getSelection()?.getSelectedText()) return
                                      cycleFavorite(toolName)
                                    }}
                                  >
                                    {star().icon}
                                  </text>

                                  <text
                                    fg={theme.textMuted}
                                    onMouseUp={() => {
                                      if (renderer.getSelection()?.getSelectedText()) return
                                      cycleFavorite(toolName)
                                    }}
                                  >
                                    {toolName}
                                  </text>
                                </box>
                              )
                            }}
                          </For>
                        </box>
                      </Show>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Show>
          <Show when={uniquePlugins().length > 0}>
            <box marginTop={0}>
              <text
                attributes={TextAttributes.BOLD}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  toggleSection("plugins")
                }}
              >
                {expandedSections().has("plugins") ? "▼" : "▶"} Plugins {`(${uniquePlugins().length})`}
              </text>
              <Show when={expandedSections().has("plugins")}>
                <For each={uniquePlugins()}>
                  {(plugin) => (
                    <box flexDirection="column">
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} fg={theme.success}>
                          ●
                        </text>
                        <text
                          fg={theme.text}
                          attributes={TextAttributes.BOLD}
                          onMouseUp={() => {
                            if (renderer.getSelection()?.getSelectedText()) return
                            togglePlugin(plugin.name)
                          }}
                        >
                          {expandedPlugins().has(plugin.name) ? "▼" : "▶"} {plugin.name}
                        </text>
                      </box>
                      <Show when={expandedPlugins().has(plugin.name) && pluginTools()[plugin.name]}>
                        <box marginLeft={3} flexDirection="column">
                          <Show when={pluginTools()[plugin.name]?.length > 0}>
                            <text fg={theme.textMuted}>Tools/Functions:</text>
                            <For each={pluginTools()[plugin.name] || []}>
                              {(tool) => (
                                <text fg={theme.textMuted}>• {typeof tool === "string" ? tool : tool.name}</text>
                              )}
                            </For>
                          </Show>
                          <Show when={!pluginTools()[plugin.name] || pluginTools()[plugin.name]?.length === 0}>
                            <text fg={theme.textMuted}>
                              <i>No tools registered</i>
                            </text>
                          </Show>
                        </box>
                      </Show>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Show>
        </Show>

        <Show when={activeTab() === "todos"}>
          <box marginTop={0}>
            <box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
              <text attributes={TextAttributes.BOLD}>Todo</text>
              <text
                fg={theme.accent}
                attributes={TextAttributes.BOLD}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  handleAddTodo()
                }}
              >
                + Add
              </text>
            </box>
            <Show when={todo().length > 0}>
              {(() => {
                const renderTodo = (task: SDKTodo, depth: number = 0): JSX.Element => {
                  const allTodos = todo()
                  const hasKids = Todo.hasChildren(allTodos, task.id)
                  const children = Todo.getChildren(allTodos, task.id)
                  const color =
                    task.status === "in_progress"
                      ? theme.success
                      : task.status === "completed"
                        ? theme.textMuted
                        : hasKids
                          ? theme.text
                          : theme.textMuted
                  const prefix = hasKids
                    ? expandedTodos().has(task.id)
                      ? "▼"
                      : "▶"
                    : task.status === "completed"
                      ? "☒"
                      : "☐"

                  return (
                    <>
                      <box
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          if (hasKids) toggleTodo(task.id)
                        }}
                      >
                        <text fg={color} wrapMode="word">
                          {`${"  ".repeat(depth)}${prefix} ${task.content}`}
                        </text>
                      </box>
                      <Show when={hasKids && expandedTodos().has(task.id)}>
                        <For each={children}>{(child) => renderTodo(child, depth + 1)}</For>
                      </Show>
                    </>
                  )
                }

                return <For each={Todo.getRootTasks(todo())}>{(task) => renderTodo(task, 0)}</For>
              })()}
            </Show>
          </box>
        </Show>

        <Show when={activeTab() === "files"}>
          <Show when={diff().length > 0}>
            <box marginTop={0} flexDirection="column">
              <text attributes={TextAttributes.BOLD}>Modified Files</text>
              <For each={diff()}>
                {(item) => {
                  const file = createMemo(() => {
                    const splits = item.file.split(path.sep).filter(Boolean)
                    const last = splits.at(-1)!
                    const rest = splits.slice(0, -1).join(path.sep)
                    return Locale.truncateMiddle(rest, 30 - last.length) + "/" + last
                  })
                  const isCommitted = createMemo(() => committedFiles().has(item.file))
                  return (
                    <box flexDirection="row" gap={1} justifyContent="space-between">
                      <text fg={theme.textMuted}>{file()}</text>
                      <box flexDirection="row" gap={1} flexShrink={0}>
                        <Show when={item.additions}>
                          <text fg={theme.diffAdded}>+{item.additions}</text>
                        </Show>
                        <Show when={item.deletions}>
                          <text fg={theme.diffRemoved}>-{item.deletions}</text>
                        </Show>
                      </box>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>
        </Show>

        {/* Context Section - Always visible below tabs */}
        <box marginTop={0} flexDirection="column">
          <box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
            <text
              attributes={TextAttributes.BOLD}
              fg={theme.accent}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                toggleSection("context")
              }}
            >
              {expandedSections().has("context") ? "▼" : "▶"} Context ({contexts().length})
            </text>
            <text
              fg={theme.accent}
              attributes={TextAttributes.BOLD}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                createContext()
              }}
            >
              + Configure
            </text>
          </box>
          <Show when={expandedSections().has("context")}>
            <box flexDirection="column" gap={1}>
              <Show when={contexts().length > 0}>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <For each={sortedContexts()}>
                    {(ctx) => {
                      const isActive = createMemo(() => activeContextIds().has(ctx.id))
                      const hasContent = createMemo(() => ctx.content.trim().length > 0)
                      const isHighPriority = createMemo(() => ctx.name.startsWith("!"))
                      const isNegative = createMemo(() => ctx.name.startsWith("-"))

                      const getBackgroundColor = () => {
                        if (isActive()) {
                          if (isNegative()) return theme.error
                          if (isHighPriority()) return theme.warning
                          return theme.accent
                        }
                        if (isNegative()) return "#8B0000" // dark red
                        if (isHighPriority()) return "#B8860B" // dark orange/gold
                        return "#444444"
                      }

                      const getTextColor = () => {
                        if (isActive()) return theme.background
                        if (isNegative()) return "#FFFFFF" // white text on red
                        if (isHighPriority()) return "#FFFFFF" // white text on orange
                        return "#000000"
                      }

                      return (
                        <text
                          fg={getTextColor()}
                          bg={getBackgroundColor()}
                          paddingLeft={1}
                          paddingRight={1}
                          attributes={isActive() ? TextAttributes.BOLD : undefined}
                          onMouseUp={() => {
                            if (renderer.getSelection()?.getSelectedText()) return
                            toggleContext(ctx.id)
                          }}
                        >
                          {ctx.name.toUpperCase()}
                          {hasContent() ? "*" : ""}
                        </text>
                      )
                    }}
                  </For>
                </box>
              </Show>
              <Show when={contexts().length === 0}>
                <text fg={theme.textMuted}>No contexts created yet</text>
              </Show>
            </box>
          </Show>
        </box>

        {/* Subagents Section - Always visible below tabs */}
        {/* Subagents Section - Always visible */}
        <box marginTop={0} flexDirection="column">
          <box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
            <text
              attributes={TextAttributes.BOLD}
              fg={theme.accent}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                toggleSection("subagents")
              }}
            >
              {expandedSections().has("subagents") ? "▼" : "▶"} Subagents ({childSessions().length})
            </text>
            <text
              fg={theme.accent}
              attributes={TextAttributes.BOLD}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                handleAddSubagent()
              }}
            >
              + Add
            </text>
          </box>
          <Show when={expandedSections().has("subagents")}>
            <box flexDirection="column">
              <For each={subagentGroups()}>
                {(group) => (
                  <box flexDirection="column" gap={0}>
                    <box
                      flexDirection="row"
                      alignItems="center"
                      gap={1}
                      paddingLeft={1}
                      onMouseUp={() => {
                        if (renderer.getSelection()?.getSelectedText()) return
                        setExpandedAgentGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(group.agent)) next.delete(group.agent)
                          else next.add(group.agent)
                          return next
                        })
                      }}
                    >
                      <text>{expandedAgentGroups().has(group.agent) ? "▼" : "▶"}</text>
                      <AgentChipText text={group.agent} />
                    </box>
                    <Show when={expandedAgentGroups().has(group.agent)}>
                      <For each={group.items}>
                        {(child) => {
                          const status = child.orchestration?.status ?? "unknown"
                          const statusColor =
                            status === "active"
                              ? theme.success
                              : status === "completed"
                                ? theme.textMuted
                                : status === "paused"
                                  ? theme.warning
                                  : theme.error

                          const parsed = parseSubagentTitle(child.title)
                          const description = parsed.description || child.title
                          const summary = description.length > 35 ? description.substring(0, 32) + "..." : description

                          return (
                            <box
                              flexDirection="row"
                              gap={1}
                              paddingLeft={3}
                              onMouseUp={() => {
                                if (renderer.getSelection()?.getSelectedText()) return
                                navigate({
                                  type: "session",
                                  sessionID: child.id,
                                })
                              }}
                            >
                              <text flexShrink={0} fg={statusColor}>
                                •
                              </text>
                              <text fg={theme.text}>{summary}</text>
                            </box>
                          )
                        }}
                      </For>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  )
}
