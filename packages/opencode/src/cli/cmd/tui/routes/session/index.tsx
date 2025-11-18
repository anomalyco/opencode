import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
  useContext,
  untrack,
  type Component,
} from "solid-js"

import { Dynamic } from "solid-js/web"
import path from "path"
import { tmpdir } from "os"
import { fileURLToPath } from "url"
import open from "open"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import { BoxRenderable, ScrollBoxRenderable, RGBA, addDefaultParsers, TextAttributes } from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type {
  AssistantMessage,
  FilePart,
  Part,
  ToolPart,
  UserMessage,
  TextPart,
  ReasoningPart,
  Session as SessionType,
} from "@opencode-ai/sdk"

import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { PatchTool } from "@/tool/patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import type { AddTaskTool } from "@/tool/add-task"
import { useKeyboard, useRenderer, useTerminalDimensions, type BoxProps, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"

import { useCommandDialog } from "@tui/component/dialog-command"
import { Shimmer } from "@tui/ui/shimmer"
import { useKeybind } from "@tui/context/keybind"
import { Header } from "./header"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { iife } from "@/util/iife"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogTimeline } from "./dialog-timeline"
import { Sidebar } from "./sidebar"
import { LeftSidebar } from "./left-sidebar"
import SidebarWorker from "../../sidebar-worker.tsx"
import LeftSidebarWorker from "../../left-sidebar-worker.tsx"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { useContextManager } from "../../context/context"
import { pickMessageContentParts, messageText } from "@/session/message-content"
import { MessageWidgets } from "@/ui/message-widgets"
import { PluginComponent } from "../../component/plugin-component"
import stripAnsi from "strip-ansi"
import { Perf } from "@/util/perf"
import { FileBrowser } from "@tui/component/file-browser"
import { CodeEditor } from "@tui/component/code-editor"
import { FileViewer } from "@tui/component/file-viewer"

addDefaultParsers(parsers.parsers)

const SIDEBAR_WIDTH_STEP = 2
const LEFT_SIDEBAR_WIDTH_DEFAULT = 45
const LEFT_SIDEBAR_WIDTH_MIN = 30
const LEFT_SIDEBAR_WIDTH_MAX = 60
const RIGHT_SIDEBAR_WIDTH_DEFAULT = 40
const RIGHT_SIDEBAR_WIDTH_MIN = 30
const RIGHT_SIDEBAR_WIDTH_MAX = 60
const MAX_TOOL_CHIPS = 30

const context = createContext<{
  width: number
  conceal: () => boolean
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

function SessionTabs(props: {
  sessions: SessionType[]
  currentSessionID: string
  onSelect: (sessionID: string) => void
  onClose: (sessionID: string) => void
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()

  const truncateTitle = (title: string, maxLength: number = 12) => {
    if (title.length <= maxLength) return title
    return title.slice(0, maxLength - 3) + "..."
  }

  return (
    <box
      flexDirection="row"
      gap={0}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingTop={0}
      paddingBottom={0}
      flexShrink={0}
      style={{ zIndex: 1000 }}
      renderBefore={function () {
        const el = this as any
        el.enableMouse?.()
        el.style = el.style || {}
        el.style.zIndex = 1000
      }}
    >
      <For each={props.sessions}>
        {(session) => {
          const isActive = () => session.id === props.currentSessionID
          const [hover, setHover] = createSignal(false)

          const title = truncateTitle(session.title || "Session")
          const xChar = hover() || isActive() ? " ×" : ""
          const fullWidth = title.length + xChar.length
          const topBar = "▄".repeat(fullWidth)
          const bottomBar = "▀".repeat(fullWidth)
          const textColor = isActive() ? theme.text : theme.textMuted
          const borderColor = theme.background
          const tabBgColor = isActive() ? theme.background : theme.backgroundPanel

          return (
            <box
              flexDirection="column"
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={tabBgColor}
              renderBefore={function () {
                const el = this as BoxRenderable
                el.on("mouseenter", () => setHover(true))
                el.on("mouseleave", () => setHover(false))
              }}
              onMouseUp={(evt) => {
                if (renderer.getSelection()?.getSelectedText()) return
                const target = (evt as any).target
                if (target?.textContent?.includes("×")) {
                  props.onClose(session.id)
                } else {
                  props.onSelect(session.id)
                }
              }}
            >
              <text style={{ fg: borderColor, bg: tabBgColor }}>{topBar}</text>
              <box flexDirection="row" backgroundColor={tabBgColor}>
                <text fg={textColor}>{isActive() ? <b>{title}</b> : title}</text>
                <Show when={hover() || isActive()}>
                  <text fg={theme.textMuted}> ×</text>
                </Show>
              </box>
              <text style={{ fg: borderColor, bg: tabBgColor }}>{bottomBar}</text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

type ToolChip = {
  id: string
  tool: string
  status: ToolPart["state"]["status"]
  label: string
  message: AssistantMessage
  part: ToolPart
  title?: string
}

function getTaskStateTitle(state: unknown): string {
  if (state && typeof state === "object") {
    const record = state as Record<string, unknown>
    const title = record["title"]
    if (typeof title === "string") return title
  }
  return ""
}

function getToolChipLabel(part: ToolPart): string {
  const { tool } = part
  const { status } = part.state
  if (status === "error") {
    const error = part.state.error
    return error?.trim() ? Locale.truncate(error.trim(), 60) : `${tool} error`
  }
  if (status === "completed") {
    const title = typeof part.state.title === "string" ? part.state.title : undefined
    if (title?.trim()) return Locale.truncate(title.trim(), 60)
    const metadataTitle = typeof part.state.metadata?.title === "string" ? part.state.metadata?.title : undefined
    if (metadataTitle?.trim()) return Locale.truncate(metadataTitle.trim(), 60)
    const output = part.state.output
    if (output?.trim()) return Locale.truncate(output.trim(), 60)
  }
  if (status === "pending") {
    const description = part.state.input?.description
    if (typeof description === "string" && description.trim()) {
      return Locale.truncate(description.trim(), 60)
    }
  }
  return `${Locale.titlecase(tool)} (${status})`
}

function getToolChipStatusColors(theme: ReturnType<typeof useTheme>["theme"], status: ToolPart["state"]["status"]) {
  if (status === "error") return { fg: theme.background, bg: theme.error }
  if (status === "completed") return { fg: theme.background, bg: theme.success }
  if (status === "pending") return { fg: theme.background, bg: theme.accent }
  return { fg: theme.text, bg: theme.border }
}

function ToolChipBar(props: { chips: ToolChip[]; selected?: string; onSelect: (chipID: string) => void }) {
  const { theme } = useTheme()
  const renderer = useRenderer()

  return (
    <box flexDirection="column" gap={1} paddingBottom={1} paddingLeft={1} paddingRight={1} flexShrink={0}>
      <text fg={theme.textMuted}>Tool calls</text>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        <For each={props.chips}>
          {(chip) => {
            const active = () => props.selected === chip.id
            const statusColors = getToolChipStatusColors(theme, chip.status)
            return (
              <box
                border={["left"]}
                customBorderChars={SplitBorder.customBorderChars}
                borderColor={statusColors.bg}
                backgroundColor={active() ? theme.backgroundElement : theme.backgroundPanel}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={0}
                paddingBottom={0}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  props.onSelect(chip.id)
                }}
              >
                <text fg={statusColors.bg}>●</text>
                <text fg={theme.text} marginLeft={1} marginRight={1}>
                  {Locale.titlecase(chip.tool)}
                </text>
                <text fg={theme.textMuted}>{chip.label}</text>
                <Show when={active()}>
                  <text fg={theme.textMuted}> (selected)</text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}

function ToolChipDetails(props: { chip?: ToolChip }) {
  const { theme } = useTheme()

  return (
    <Show when={props.chip} fallback={<></>}>
      {(chip) => (
        <box
          marginBottom={1}
          marginLeft={1}
          marginRight={1}
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.border}
          backgroundColor={theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <box flexDirection="row" gap={1} marginBottom={1}>
            <text fg={theme.text}>
              <b>{Locale.titlecase(chip().tool)}</b>
            </text>
            <text fg={theme.textMuted}>{chip().label}</text>
          </box>
          <ToolPart part={chip().part} message={chip().message} indent={0} showPriorityControls={false} />
        </box>
      )}
    </Show>
  )
}

export function Session() {
  const route = useRouteData("session")
  const router = useRoute()
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(route.sessionID)!)

  // Track open session tabs
  const [openTabs, setOpenTabs] = createSignal<string[]>(kv.get("openTabs", []))

  // Add current session to open tabs ONLY if it has messages (is active)
  createEffect(() => {
    const currentID = route.sessionID
    const hasMessages = sync.data.message[currentID]?.length > 0

    if (hasMessages && !openTabs().includes(currentID)) {
      const newTabs = [...openTabs(), currentID]
      setOpenTabs(newTabs)
      kv.set("openTabs", newTabs)
    }
  })

  // Keep previous messages while loading to prevent flashing
  const [cachedMessages, setCachedMessages] = createSignal<(typeof sync.data.message)[string]>(
    sync.data.message[route.sessionID] ?? [],
  )
  const [lastSessionID, setLastSessionID] = createSignal(route.sessionID)

  // Update cache when session or messages change
  createEffect(() => {
    const currentSessionID = route.sessionID
    const current = sync.data.message[currentSessionID]

    // Session switched - update immediately
    if (lastSessionID() !== currentSessionID) {
      batch(() => {
        setLastSessionID(currentSessionID)
        setCachedMessages(current ?? [])
      })
      return
    }

    // Messages updated - update cache
    if (current && current.length > 0) {
      setCachedMessages(current)
    }
  })

  // Message windowing for performance - only render recent messages
  const [messageWindowSize, setMessageWindowSize] = createSignal(30)

  const allMessages = createMemo(() => {
    const currentSessionID = route.sessionID
    const current = sync.data.message[currentSessionID]

    // Return current messages if available, otherwise cached
    return current && current.length > 0 ? current : cachedMessages()
  })

  const messages = createMemo(() => {
    const all = allMessages()
    const windowSize = messageWindowSize()

    // Always show all messages if under window size
    if (all.length <= windowSize) return all

    // Show last N messages (most recent)
    return all.slice(-windowSize)
  })

  const hasMoreMessages = createMemo(() => allMessages().length > messageWindowSize())

  const loadMoreMessages = () => {
    setMessageWindowSize((prev) => Math.min(prev + 20, allMessages().length))
  }

  const permissions = createMemo(() => sync.data.permission[route.sessionID] ?? [])

  const pending = createMemo<string | undefined>((prev) => {
    const current = messages().findLast((x) => x.role === "assistant" && !x.time?.completed)?.id
    // Keep previous value if current is undefined to prevent flickering
    return current !== undefined ? current : prev
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("sidebar", "auto"))
  const [leftSidebar, setLeftSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("leftSidebar", "auto"))
  const [rightSidebar, setRightSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("rightSidebar", "auto"))
  const [conceal, setConceal] = createSignal(true)
  const [showSimpleMessageList, setShowSimpleMessageList] = createSignal(Boolean(kv.get("showSimpleMessageList", true)))

  const clampWidth = (value: number, min: number, max: number) => {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  const readWidth = (key: string, fallback: number, min: number, max: number) => {
    const stored = kv.get(key)
    if (typeof stored !== "number") return fallback
    return clampWidth(Math.round(stored), min, max)
  }

  const [leftSidebarWidth, setLeftSidebarWidth] = createSignal(
    readWidth("leftSidebarWidth", LEFT_SIDEBAR_WIDTH_DEFAULT, LEFT_SIDEBAR_WIDTH_MIN, LEFT_SIDEBAR_WIDTH_MAX),
  )
  const [rightSidebarWidth, setRightSidebarWidth] = createSignal(
    readWidth("rightSidebarWidth", RIGHT_SIDEBAR_WIDTH_DEFAULT, RIGHT_SIDEBAR_WIDTH_MIN, RIGHT_SIDEBAR_WIDTH_MAX),
  )

  const updateLeftSidebarWidth = (value: number) => {
    const next = clampWidth(value, LEFT_SIDEBAR_WIDTH_MIN, LEFT_SIDEBAR_WIDTH_MAX)
    if (next === leftSidebarWidth()) return
    setLeftSidebarWidth(next)
    kv.set("leftSidebarWidth", next)
  }

  const updateRightSidebarWidth = (value: number) => {
    const next = clampWidth(value, RIGHT_SIDEBAR_WIDTH_MIN, RIGHT_SIDEBAR_WIDTH_MAX)
    if (next === rightSidebarWidth()) return
    setRightSidebarWidth(next)
    kv.set("rightSidebarWidth", next)
  }

  const adjustLeftSidebarWidth = (delta: number) => {
    updateLeftSidebarWidth(leftSidebarWidth() + delta)
  }

  const adjustRightSidebarWidth = (delta: number) => {
    updateRightSidebarWidth(rightSidebarWidth() + delta)
  }

  // File browser, editor, and viewer state
  const [showFileBrowser, setShowFileBrowser] = createSignal(false)
  const [showCodeEditor, setShowCodeEditor] = createSignal(false)
  const [showFileViewer, setShowFileViewer] = createSignal(false)
  const [selectedFile, setSelectedFile] = createSignal<string | undefined>()
  const initialSelectedToolChip = kv.get("selectedToolChip")
  const [selectedToolChip, setSelectedToolChip] = createSignal<string | undefined>(
    typeof initialSelectedToolChip === "string" ? initialSelectedToolChip : undefined,
  )

  const toolChips = createMemo(() => {
    if (!showSimpleMessageList()) return [] as ToolChip[]
    const list = messages()
    const chips: ToolChip[] = []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const message = list[i]
      if (message.role !== "assistant") continue
      const parts = (sync.data.part[message.id] ?? []) as Part[]
      for (let j = parts.length - 1; j >= 0; j -= 1) {
        const part = parts[j]
        if (part.type !== "tool") continue
        const toolPart = part as ToolPart
        chips.push({
          id: `${message.id}:${toolPart.id}`,
          tool: toolPart.tool,
          status: toolPart.state.status,
          label: getToolChipLabel(toolPart),
          message: message as AssistantMessage,
          part: toolPart,
        })
        if (chips.length >= MAX_TOOL_CHIPS) break
      }
      if (chips.length >= MAX_TOOL_CHIPS) break
    }
    return chips.reverse()
  })

  const selectedToolChipData = createMemo(() => {
    const selected = selectedToolChip()
    if (!selected) return
    return toolChips().find((chip) => chip.id === selected)
  })

  createEffect(() => {
    const simple = showSimpleMessageList()
    const selected = selectedToolChip()
    if (!simple && selected) {
      kv.set("selectedToolChip", null)
      setSelectedToolChip(undefined)
      return
    }
    if (simple && selected) {
      const exists = toolChips().some((chip) => chip.id === selected)
      if (!exists) {
        kv.set("selectedToolChip", null)
        setSelectedToolChip(undefined)
      }
    }
  })

  const handleToolChipSelect = (chipID: string) => {
    setSelectedToolChip((prev) => {
      const next = prev === chipID ? undefined : chipID
      kv.set("selectedToolChip", next ?? null)
      return next
    })
  }

  // Detect if messages are currently streaming to disable sticky scroll

  const isStreaming = createMemo(() => {
    const msgs = messages()
    const lastMsg = msgs[msgs.length - 1]
    return lastMsg?.role === "assistant" && !lastMsg.time?.completed
  })

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => sidebar() === "show" || (sidebar() === "auto" && wide()))

  const leftSidebarVisible = createMemo(() => leftSidebar() === "show" || (leftSidebar() === "auto" && wide()))
  const rightSidebarVisible = createMemo(() => rightSidebar() === "show" || (rightSidebar() === "auto" && wide()))

  const bothSidebarsCollapsed = createMemo(() => !leftSidebarVisible() && !rightSidebarVisible())

  const toggleLeftSidebar = () => {
    setLeftSidebar((prev) => {
      const next = prev === "auto" ? (leftSidebarVisible() ? "hide" : "show") : prev === "show" ? "hide" : "show"
      if (next === "show") kv.set("leftSidebar", "auto")
      if (next === "hide") kv.set("leftSidebar", "hide")
      return next
    })
  }

  const toggleRightSidebar = () => {
    setRightSidebar((prev) => {
      const next = prev === "auto" ? (rightSidebarVisible() ? "hide" : "show") : prev === "show" ? "hide" : "show"
      if (next === "show") kv.set("rightSidebar", "auto")
      if (next === "hide") kv.set("rightSidebar", "hide")
      return next
    })
  }

  const toggleBothSidebars = () => {
    const bothVisible = leftSidebarVisible() && rightSidebarVisible()
    setLeftSidebar(bothVisible ? "hide" : "show")
    setRightSidebar(bothVisible ? "hide" : "show")
    if (!bothVisible) {
      kv.set("leftSidebar", "auto")
      kv.set("rightSidebar", "auto")
    } else {
      kv.set("leftSidebar", "hide")
      kv.set("rightSidebar", "hide")
    }
  }

  const selectSession = (sessionID: string) => {
    if (sessionID === route.sessionID) return
    router.navigate({
      type: "session",
      sessionID,
    })
  }

  const handleNewSession = () => {
    router.navigate({
      type: "home",
    })
  }

  const handleDeleteSession = () => {
    import("@tui/component/dialog-session-list").then((m) => {
      dialog.replace(() => <m.DialogSessionList />)
    })
  }

  const handleCloseSession = async (sessionID: string) => {
    const tabs = openTabs()

    if (tabs.length === 1) {
      // Last tab, create new session
      handleNewSession()
      // Remove from tabs
      setOpenTabs([])
      kv.set("openTabs", [])
      return
    }

    // Switch to a different tab if closing current session (BEFORE removing from tabs)
    if (sessionID === route.sessionID) {
      const currentIndex = tabs.findIndex((id) => id === sessionID)
      const nextTab = tabs[currentIndex + 1] || tabs[currentIndex - 1]
      if (nextTab) {
        selectSession(nextTab)
      }
    }

    // Remove from open tabs
    const newTabs = tabs.filter((id) => id !== sessionID)
    setOpenTabs(newTabs)
    kv.set("openTabs", newTabs)

    // Delete the session
    await sdk.client.session.delete({
      path: {
        id: sessionID,
      },
    })
  }

  const activeSessions = createMemo(() => {
    const tabs = openTabs()
    return sync.data.session
      .filter((x) => tabs.includes(x.id))
      .sort((a, b) => {
        // Sort by tab order (order they were opened)
        return tabs.indexOf(a.id) - tabs.indexOf(b.id)
      })
  })

  const contentWidth = createMemo(() => {
    const leftWidth = leftSidebarVisible() ? leftSidebarWidth() : 0
    const rightWidth = rightSidebarVisible() ? rightSidebarWidth() : 0
    return dimensions().width - leftWidth - rightWidth - 4
  })

  const toast = useToast()

  const sdk = useSDK()

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()

  // Sync session data when session changes
  createEffect(
    on(
      () => route.sessionID,
      async (sessionID) => {
        await sync.session.sync(sessionID).catch(() => {
          toast.show({
            message: `Session not found: ${sessionID}`,
            variant: "error",
          })
          return navigate({ type: "home" })
        })
      },
    ),
  )

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    // Sidebar toggle shortcuts
    if (evt.ctrl || evt.meta) {
      if (evt.name === "[") {
        toggleLeftSidebar()
        return
      }
      if (evt.name === "]") {
        toggleRightSidebar()
        return
      }
      if (evt.name === "b") {
        toggleBothSidebars()
        return
      }
    }

    const first = permissions()[0]
    if (first) {
      const response = iife(() => {
        if (evt.name === "return") return "once"
        if (evt.name === "a") return "always"
        if (evt.name === "d") return "reject"
        if (evt.name === "escape") return "reject"
        return
      })
      if (response) {
        sdk.client.postSessionIdPermissionsPermissionId({
          path: {
            permissionID: first.id,
            id: route.sessionID,
          },
          body: {
            response: response,
          },
        })
      }
    }
  })

  function toBottom() {
    if (!scroll) return

    // IMPORTANT: Scroll in chunks to force viewport recalculation.
    // Jumping directly with scrollBy(100000) breaks the scrollbox's virtual rendering,
    // causing messages to appear blank. Chunked scrolling mimics manual scrolling and
    // keeps the viewport rendering correctly.
    const scrollInChunks = (remaining: number) => {
      if (!scroll || remaining <= 0) return

      const chunkSize = 50
      scroll.scrollBy(chunkSize)

      if (remaining > chunkSize) {
        setTimeout(() => scrollInChunks(remaining - chunkSize), 10)
      }
    }

    const target = scroll.scrollHeight - scroll.y
    scrollInChunks(target)
  }

  // Auto-scroll to bottom when session changes
  createEffect(
    on(
      () => route.sessionID,
      () => {
        setTimeout(() => {
          if (scroll) toBottom()
        }, 200)
      },
    ),
  )

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  // Auto-scroll during streaming when new content arrives
  // Use throttled approach to avoid 60 FPS flickering
  let scrollTimeout: NodeJS.Timeout | null = null
  createEffect(() => {
    const msgs = messages()
    const lastMsg = msgs[msgs.length - 1]
    if (lastMsg && lastMsg.role === "assistant" && !lastMsg.time.completed) {
      // Throttle to max once per 200ms to avoid flickering
      if (!scrollTimeout) {
        scrollTimeout = setTimeout(() => {
          if (scroll) toBottom()
          scrollTimeout = null
        }, 200)
      }
    }
  })

  const local = useLocal()

  function moveChild(direction: number) {
    const parentID = session()?.parentID ?? session()?.id
    let children = sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((b, a) => a.id.localeCompare(b.id))
    if (children.length === 1) return
    let next = children.findIndex((x) => x.id === session()?.id) + direction
    if (next >= children.length) next = 0
    if (next < 0) next = children.length - 1
    if (children[next]) {
      navigate({
        type: "session",
        sessionID: children[next].id,
      })
    }
  }

  const command = useCommandDialog()
  command.register(() => [
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      onSelect: (dialog) => {
        const currentModel = local.model.current()
        if (!currentModel) return
        sdk.client.session.summarize({
          path: {
            id: route.sessionID,
          },
          body: {
            modelID: currentModel.modelID,
            providerID: currentModel.providerID,
          },
        })
        dialog.clear()
      },
    },
    {
      title: "Share session",
      value: "session.share",
      keybind: "session_share",
      disabled: !!session()?.share?.url,
      category: "Session",
      onSelect: async (dialog) => {
        await sdk.client.session
          .share({
            path: {
              id: route.sessionID,
            },
          })
          .then((res) =>
            Clipboard.copy(res.data!.share!.url).catch(() =>
              toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }),
            ),
          )
          .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to share session", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      disabled: !session()?.share?.url,
      category: "Session",
      onSelect: (dialog) => {
        sdk.client.session.unshare({
          path: {
            id: route.sessionID,
          },
        })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      onSelect: (dialog) => {
        const revert = session().revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session.revert({
          path: {
            id: route.sessionID,
          },
          body: {
            messageID: message.id,
          },
        })
        const parts = sync.data.part[message.id]
        prompt.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      disabled: !session()?.revert?.messageID,
      category: "Session",
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session().revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            path: {
              id: route.sessionID,
            },
          })
          prompt.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          path: {
            id: route.sessionID,
          },
          body: {
            messageID: message.id,
          },
        })
      },
    },
    {
      title: showSimpleMessageList() ? "Hide simple messagelist" : "Show simple messagelist",
      value: "session.message.simple",
      category: "Session",
      onSelect: (dialog) => {
        const next = !showSimpleMessageList()
        setShowSimpleMessageList(next)
        kv.set("showSimpleMessageList", next)
        dialog.clear()
      },
    },
    {
      title: "Toggle left sidebar",
      value: "session.sidebar.left.toggle",
      keybind: "sidebar_left_toggle" as any,
      category: "Session",
      onSelect: (dialog) => {
        toggleLeftSidebar()
        dialog.clear()
      },
    },
    {
      title: "Toggle right sidebar",
      value: "session.sidebar.right.toggle",
      keybind: "sidebar_right_toggle" as any,
      category: "Session",
      onSelect: (dialog) => {
        toggleRightSidebar()
        dialog.clear()
      },
    },
    {
      title: "Toggle both sidebars",
      value: "session.sidebar.both.toggle",
      keybind: "sidebar_both_toggle" as any,
      category: "Session",
      onSelect: (dialog) => {
        toggleBothSidebars()
        dialog.clear()
      },
    },
    {
      title: "Narrow left sidebar",
      value: "session.sidebar.left.narrow",
      keybind: "sidebar_left_narrow" as any,
      category: "Session",
      onSelect: (dialog) => {
        adjustLeftSidebarWidth(-SIDEBAR_WIDTH_STEP)
        dialog.clear()
      },
    },
    {
      title: "Widen left sidebar",
      value: "session.sidebar.left.widen",
      keybind: "sidebar_left_widen" as any,
      category: "Session",
      onSelect: (dialog) => {
        adjustLeftSidebarWidth(SIDEBAR_WIDTH_STEP)
        dialog.clear()
      },
    },
    {
      title: "Narrow right sidebar",
      value: "session.sidebar.right.narrow",
      keybind: "sidebar_right_narrow" as any,
      category: "Session",
      onSelect: (dialog) => {
        adjustRightSidebarWidth(-SIDEBAR_WIDTH_STEP)
        dialog.clear()
      },
    },
    {
      title: "Widen right sidebar",
      value: "session.sidebar.right.widen",
      keybind: "sidebar_right_widen" as any,
      category: "Session",
      onSelect: (dialog) => {
        adjustRightSidebarWidth(SIDEBAR_WIDTH_STEP)
        dialog.clear()
      },
    },
    {
      title: "Toggle legacy sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setSidebar((prev) => {
          if (prev === "auto") return sidebarVisible() ? "hide" : "show"
          if (prev === "show") return "hide"
          return "show"
        })
        if (sidebar() === "show") kv.set("sidebar", "auto")
        if (sidebar() === "hide") kv.set("sidebar", "hide")
        dialog.clear()
      },
    },
    {
      title: "Toggle code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog) => {
        const lastAssistantMessage = messages().findLast((msg) => msg.role === "assistant")
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        console.log(text)
        const base64 = Buffer.from(text).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        /* @ts-expect-error */
        renderer.writeOut(finalOsc52)
        Clipboard.copy(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },

    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      onSelect: (dialog) => {
        moveChild(1)
        dialog.clear()
      },
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      onSelect: (dialog) => {
        moveChild(-1)
        dialog.clear()
      },
    },
  ])

  const revert = createMemo(() => {
    const s = session()
    if (!s) return
    const messageID = s.revert?.messageID
    if (!messageID) return
    const reverted = allMessages().filter((x) => x.id > messageID && x.role === "user")

    const diffFiles = (() => {
      const diffText = s.revert?.diff || ""
      if (!diffText) return []

      try {
        const patches = parsePatch(diffText)
        return patches.map((patch) => {
          const filename = patch.newFileName || patch.oldFileName || "unknown"
          const cleanFilename = filename.replace(/^[ab]\//, "")
          return {
            filename: cleanFilename,
            additions: patch.hunks.reduce(
              (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
              0,
            ),
            deletions: patch.hunks.reduce(
              (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
              0,
            ),
          }
        })
      } catch (error) {
        return []
      }
    })()

    return {
      messageID,
      reverted,
      diff: s.revert!.diff,
      diffFiles,
    }
  })

  const dialog = useDialog()
  const renderer = useRenderer()

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        conceal,
      }}
    >
      <box flexDirection="row" paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={2}>
        {/* Left Sidebar */}
        <Show when={leftSidebarVisible()}>
          <LeftSidebarWorker
            sessionID={route.sessionID}
            onToggle={toggleLeftSidebar}
            onSelect={selectSession}
            onNewSession={handleNewSession}
            openTabs={openTabs()}
            onClose={handleCloseSession}
            width={leftSidebarWidth()}
            minWidth={LEFT_SIDEBAR_WIDTH_MIN}
            maxWidth={LEFT_SIDEBAR_WIDTH_MAX}
            widthStep={SIDEBAR_WIDTH_STEP}
            onResize={adjustLeftSidebarWidth}
          />
        </Show>

        {/* Main Content */}
        <box
          flexGrow={1}
          gap={1}
          justifyContent={bothSidebarsCollapsed() ? "center" : "flex-start"}
          maxWidth={bothSidebarsCollapsed() ? 120 : undefined}
        >
          <Show when={session()}>
            <Show when={session().parentID}>
              <box
                backgroundColor={theme.backgroundPanel}
                justifyContent="space-between"
                flexDirection="row"
                paddingTop={1}
                paddingBottom={1}
                flexShrink={0}
                paddingLeft={2}
                paddingRight={2}
              >
                <box flexDirection="row" gap={3}>
                  <text
                    fg={theme.accent}
                    attributes={1}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      navigate({
                        type: "session",
                        sessionID: session().parentID!,
                      })
                    }}
                  >
                    ← Back
                  </text>
                  <text
                    fg={theme.accent}
                    attributes={1}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      moveChild(-1)
                    }}
                  >
                    ← Previous{" "}
                    <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
                  </text>
                </box>
                <text fg={theme.text}>
                  <b>Subagent Session</b>
                </text>
                <text
                  fg={theme.accent}
                  attributes={1}
                  onMouseUp={() => {
                    if (renderer.getSelection()?.getSelectedText()) return
                    moveChild(1)
                  }}
                >
                  <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span> Next →
                </text>
              </box>
            </Show>
            <Show when={!sidebarVisible() && !leftSidebarVisible()}>
              <Header />
            </Show>
            <box flexGrow={1} flexShrink={1}>
              <Show when={hasMoreMessages()}>
                <box
                  paddingTop={1}
                  paddingBottom={1}
                  paddingLeft={2}
                  marginBottom={1}
                  onMouseUp={loadMoreMessages}
                  flexShrink={0}
                >
                  <text fg={theme.textMuted}>
                    ↑ {allMessages().length - messageWindowSize()} older messages hidden (click to load more)
                  </text>
                </box>
              </Show>
              <scrollbox
                ref={(r) => (scroll = r)}
                scrollbarOptions={{
                  // Keep feed width fixed so completed messages don't re-wrap mid-stream
                  visible: false,
                }}
                stickyScroll={!isStreaming()}
                stickyStart="bottom"
                height="100%"
              >
                <For each={messages()} fallback={<box />}>
                  {(message, index) => {
                    // Memoize parts to prevent re-rendering completed messages
                    // Only update parts while message is streaming (not completed)
                    const messageParts = createMemo(() => {
                      // If message is completed, cache the parts and don't re-fetch
                      if ("completed" in message.time && message.time.completed) {
                        return untrack(() => sync.data.part[message.id] ?? [])
                      }
                      // If streaming, keep updating
                      return sync.data.part[message.id] ?? []
                    })

                    // Check if this user message should be hidden (followed by only add_task calls)
                    const shouldHideUserMessage = createMemo(() => {
                      if (message.role !== "user") return false

                      // Find the next assistant message
                      const nextMessage = messages()[index() + 1]
                      if (!nextMessage || nextMessage.role !== "assistant") return false

                      // Get parts for next message
                      const nextParts = sync.data.part[nextMessage.id] ?? []
                      const toolParts = nextParts.filter((p) => p.type === "tool") as ToolPart[]

                      // Hide if message only triggers add_task tools (and has at least one)
                      return toolParts.length > 0 && toolParts.every((p) => p.tool === "add_task")
                    })

                    return (
                      <Switch>
                        <Match when={message.id === revert()?.messageID}>
                          {(function () {
                            const command = useCommandDialog()
                            const [hover, setHover] = createSignal(false)
                            const dialog = useDialog()

                            const handleUnrevert = async () => {
                              const confirmed = await DialogConfirm.show(
                                dialog,
                                "Confirm Redo",
                                "Are you sure you want to restore the reverted messages?",
                              )
                              if (confirmed) {
                                command.trigger("session.redo")
                              }
                            }

                            return (
                              <box
                                onMouseOver={() => setHover(true)}
                                onMouseOut={() => setHover(false)}
                                onMouseUp={handleUnrevert}
                                marginTop={1}
                                flexShrink={0}
                                border={["left"]}
                                customBorderChars={SplitBorder.customBorderChars}
                                borderColor={theme.backgroundPanel}
                              >
                                <box
                                  paddingTop={1}
                                  paddingBottom={1}
                                  paddingLeft={2}
                                  backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                                >
                                  <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                                  <text fg={theme.textMuted}>
                                    <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to
                                    restore
                                  </text>
                                  <Show when={revert()!.diffFiles?.length}>
                                    <box marginTop={1}>
                                      <For each={revert()!.diffFiles}>
                                        {(file) => (
                                          <text>
                                            {file.filename}
                                            <Show when={file.additions > 0}>
                                              <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                            </Show>
                                            <Show when={file.deletions > 0}>
                                              <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                            </Show>
                                          </text>
                                        )}
                                      </For>
                                    </box>
                                  </Show>
                                </box>
                              </box>
                            )
                          })()}
                        </Match>
                        <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                          <></>
                        </Match>
                        <Match when={message.role === "user" && !shouldHideUserMessage()}>
                          <UserMessage
                            index={index()}
                            onMouseUp={() => {
                              if (renderer.getSelection()?.getSelectedText()) return
                              dialog.replace(() => <DialogMessage messageID={message.id} sessionID={route.sessionID} />)
                            }}
                            message={message as UserMessage}
                            parts={messageParts()}
                            pending={pending()}
                          />
                        </Match>
                        <Match when={message.role === "user" && shouldHideUserMessage()}>
                          <></>
                        </Match>
                        <Match when={message.role === "assistant"}>
                          <AssistantMessage
                            last={index() === messages().length - 1}
                            message={message as AssistantMessage}
                            parts={messageParts()}
                          />
                        </Match>
                      </Switch>
                    )
                  }}
                </For>
              </scrollbox>
            </box>
            <box flexShrink={0}>
              <Prompt
                ref={(r) => (prompt = r)}
                disabled={permissions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                onScrollToBottom={toBottom}
                sessionID={route.sessionID}
              />
            </box>
          </Show>
          <Toast />
        </box>

        {/* Right Sidebar */}
        <Show when={rightSidebarVisible()}>
          <SidebarWorker
            sessionID={route.sessionID}
            width={rightSidebarWidth()}
            onToggle={toggleRightSidebar}
            onResize={adjustRightSidebarWidth}
          />
        </Show>
      </box>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/csv": "csv",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/html": "html",
  "text/plain": "txt",
  "application/x-directory": "dir",
}

const ATTACHMENT_EXTENSION_HINTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
  "application/zip": "zip",
}
const ATTACHMENT_TMP_PREFIX = "opencode-attachment"

function sanitizeAttachmentFilename(name: string) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")
}

function getExtensionFromMime(mime: string) {
  if (!mime) return "bin"
  const hint = ATTACHMENT_EXTENSION_HINTS[mime]
  if (hint) return hint
  const parts = mime.split("/")
  if (parts.length > 1 && parts[1]) return parts[1]
  return "bin"
}

function deriveAttachmentName(file: FilePart, mime: string) {
  const base = file.filename ? sanitizeAttachmentFilename(file.filename) : ""
  if (!base) return `attachment.${getExtensionFromMime(mime)}`
  if (path.extname(base)) return base
  return `${base}.${getExtensionFromMime(mime)}`
}

async function persistAttachmentBuffer(buffer: Uint8Array | Buffer, file: FilePart, mime: string) {
  const effectiveMime = mime || file.mime || "application/octet-stream"
  const attachmentName = deriveAttachmentName(file, effectiveMime)
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const targetPath = path.join(tmpdir(), `${ATTACHMENT_TMP_PREFIX}-${uniqueSuffix}-${attachmentName}`)
  await Bun.write(targetPath, buffer)
  return targetPath
}

async function saveDataUrlAttachment(file: FilePart) {
  const url = file.url
  const commaIndex = url.indexOf(",")
  if (commaIndex === -1) throw new Error("Invalid data URL")
  const meta = url.slice("data:".length, commaIndex)
  const payload = url.slice(commaIndex + 1)
  const mime = meta.split(";")[0] || file.mime || "application/octet-stream"
  if (/;base64/i.test(meta)) {
    const buffer = Buffer.from(payload, "base64")
    return persistAttachmentBuffer(buffer, file, mime)
  }
  let normalized = payload
  try {
    normalized = decodeURIComponent(payload.replace(/\+/g, "%20"))
  } catch {}
  const buffer = Buffer.from(normalized, "utf8")
  return persistAttachmentBuffer(buffer, file, mime)
}

async function resolveAttachmentTarget(file: FilePart) {
  const url = file.url
  if (!url) throw new Error("Missing attachment URL")
  if (url.startsWith("data:")) return saveDataUrlAttachment(file)
  if (url.startsWith("file://")) return fileURLToPath(url)
  return url
}

function PriorityCircles(props: {
  sessionID: string
  messageID: string
  priority?: "red" | "amber" | "green" | "none"
  compact?: boolean
}) {
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const sync = useSync()
  const contextManager = useContextManager(true)

  const buildMessageContext = () => {
    const messageList = sync.data.message[props.sessionID] ?? []
    const message = messageList.find((m) => m.id === props.messageID)
    const partList = sync.data.part[props.messageID] ?? []
    const main = messageText(pickMessageContentParts(partList)).trim()
    if (main) return main

    const fallback: string[] = []
    for (const part of partList as any[]) {
      if (!part || typeof part !== "object") continue
      if (part.type === "file") {
        const label = part.filename || part.source?.file?.path || part.url || part.id
        fallback.push(`File: ${label}`)
        continue
      }
      if (part.type === "tool") {
        const state = part.state
        if (state?.status === "completed") {
          fallback.push(`Tool ${part.tool}: ${Locale.truncate(state.output ?? "", 400)}`)
        } else if (state?.status === "error") {
          fallback.push(`Tool ${part.tool} error: ${state.error}`)
        }
        continue
      }
      if (part.type === "input" && typeof part.text === "string") {
        fallback.push(part.text)
      }
    }
    if (message?.summary && typeof message.summary === "object") {
      if (message.summary.body) fallback.push(message.summary.body)
      else if (message.summary.title) fallback.push(message.summary.title)
    }
    const derived = fallback
      .map((text) => text?.toString().trim())
      .filter(Boolean)
      .join("\n\n")
    return derived || "(no content)"
  }

  const updateLocalPriority = (priority: "red" | "amber" | "green" | "none") => {
    const messages = sync.data.message[props.sessionID]
    if (!messages) return
    const index = messages.findIndex((m) => m.id === props.messageID)
    if (index === -1) return
    sync.set("message", props.sessionID, index, "priority", priority)
  }

  const setPriority = async (e: any, priority: "red" | "amber" | "green" | "none") => {
    e.stopPropagation()
    try {
      await sdk.client.session.setMessagePriority({
        path: {
          id: props.sessionID,
          messageID: props.messageID,
        },
        body: {
          priority,
        },
      })
      updateLocalPriority(priority)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update priority"
      toast.show({ message, variant: "error" })
      return
    }
    const priorityLabels = {
      green: "Always include",
      amber: "Include when relevant",
      red: "Exclude from context",
      none: "No priority",
    }
    toast.show({ message: `Message marked as ${priorityLabels[priority]}`, variant: "success" })
    if (contextManager) {
      if (priority === "green" || priority === "amber") {
        const messageList = sync.data.message[props.sessionID] ?? []
        const message = messageList.find((m) => m.id === props.messageID)
        const text = buildMessageContext()
        const snippet = text.replace(/\s+/g, " ").trim()
        const labelSource = snippet ? Locale.truncate(snippet, 24) : (message?.role ?? "message")
        const name = labelSource.toUpperCase()
        contextManager.upsertMessageContext({
          sessionID: props.sessionID,
          messageID: props.messageID,
          name,
          content: text,
          mode: priority === "green" ? "always" : "conditional",
          active: true,
        })
      } else if (priority === "red") {
        contextManager.setMessageContextActive({
          sessionID: props.sessionID,
          messageID: props.messageID,
          active: false,
        })
      } else if (priority === "none") {
        contextManager.removeMessageContext({ sessionID: props.sessionID, messageID: props.messageID })
      }
    }
  }

  // Render from least to most restrictive priority: green -> amber -> red
  const items: ReadonlyArray<{ key: "red" | "amber" | "green"; color: RGBA }> = [
    { key: "green", color: theme.success },
    { key: "amber", color: theme.accent },
    { key: "red", color: theme.error },
  ]

  return (
    <box
      flexDirection="row"
      justifyContent={props.compact ? undefined : "flex-end"}
      alignItems="center"
      paddingRight={props.compact ? 0 : 1}
      gap={props.compact ? 0 : 1}
    >
      <For each={items}>
        {(item, index) => (
          <box flexDirection="row" alignItems="center">
            <text onMouseUp={(e) => setPriority(e, props.priority === item.key ? "none" : item.key)}>
              <span
                style={{
                  fg: props.priority === item.key ? item.color : theme.textMuted,
                  bold: true,
                }}
              >
                {props.priority === item.key ? "●" : "○"}
              </span>
            </text>
            <Show when={index() < items.length - 1}>
              <text> </text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

function MessageControls(props: {
  sessionID: string
  messageID: string
  priority?: "red" | "amber" | "green" | "none"
  inline?: boolean
}) {
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const sync = useSync()
  const contextManager = useContextManager(true)
  const inline = props.inline ?? false

  const buildMessageContext = () => {
    const messageList = sync.data.message[props.sessionID] ?? []
    const message = messageList.find((m) => m.id === props.messageID)
    const partList = sync.data.part[props.messageID] ?? []
    const main = messageText(pickMessageContentParts(partList)).trim()
    if (main) return main

    const fallback: string[] = []
    for (const part of partList as any[]) {
      if (!part || typeof part !== "object") continue
      if (part.type === "file") {
        const label = part.filename || part.source?.file?.path || part.url || part.id
        fallback.push(`File: ${label}`)
        continue
      }
      if (part.type === "tool") {
        const state = part.state
        if (state?.status === "completed") {
          fallback.push(`Tool ${part.tool}: ${Locale.truncate(state.output ?? "", 400)}`)
        } else if (state?.status === "error") {
          fallback.push(`Tool ${part.tool} error: ${state.error}`)
        }
        continue
      }
      if (part.type === "input" && typeof part.text === "string") {
        fallback.push(part.text)
      }
    }
    if (message?.summary && typeof message.summary === "object") {
      if (message.summary.body) fallback.push(message.summary.body)
      else if (message.summary.title) fallback.push(message.summary.title)
    }
    const derived = fallback
      .map((text) => text?.toString().trim())
      .filter(Boolean)
      .join("\n\n")
    return derived || "(no content)"
  }

  const updateLocalPriority = (priority: "red" | "amber" | "green" | "none") => {
    const messages = sync.data.message[props.sessionID]
    if (!messages) return
    const index = messages.findIndex((m) => m.id === props.messageID)
    if (index === -1) return
    sync.set("message", props.sessionID, index, "priority", priority)
  }

  const setPriority = async (event: any, priority: "red" | "amber" | "green" | "none") => {
    event.stopPropagation?.()
    try {
      await sdk.client.session.setMessagePriority({
        path: {
          id: props.sessionID,
          messageID: props.messageID,
        },
        body: {
          priority,
        },
      })
      updateLocalPriority(priority)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update priority"
      toast.show({ message, variant: "error" })
      return
    }
    const priorityLabels = {
      green: "Always include",
      amber: "Include when relevant",
      red: "Exclude from context",
      none: "No priority",
    }
    toast.show({ message: `Message marked as ${priorityLabels[priority]}`, variant: "success" })
    if (contextManager) {
      if (priority === "green" || priority === "amber") {
        const messageList = sync.data.message[props.sessionID] ?? []
        const message = messageList.find((m) => m.id === props.messageID)
        const text = buildMessageContext()
        const snippet = text.replace(/\s+/g, " ").trim()
        const labelSource = snippet ? Locale.truncate(snippet, 24) : (message?.role ?? "message")
        const name = labelSource.toUpperCase()
        contextManager.upsertMessageContext({
          sessionID: props.sessionID,
          messageID: props.messageID,
          name,
          content: text,
          mode: priority === "green" ? "always" : "conditional",
          active: true,
        })
      } else if (priority === "red") {
        contextManager.setMessageContextActive({
          sessionID: props.sessionID,
          messageID: props.messageID,
          active: false,
        })
      } else if (priority === "none") {
        contextManager.removeMessageContext({ sessionID: props.sessionID, messageID: props.messageID })
      }
    }
  }

  const order: Array<"none" | "green" | "amber" | "red"> = ["none", "green", "amber", "red"]
  const nextPriority = (): "red" | "amber" | "green" | "none" => {
    const current = props.priority ?? "none"
    const index = order.indexOf(current)
    return order[(index + 1) % order.length]
  }

  const colors: Record<"none" | "green" | "amber" | "red", string> = {
    none: theme.textMuted,
    green: theme.success,
    amber: theme.accent,
    red: theme.error,
  }

  return (
    <box
      flexDirection="row"
      justifyContent={inline ? undefined : "flex-end"}
      alignItems="center"
      gap={inline ? 1 : 0}
      onMouseUp={(event) => {
        const next = nextPriority()
        setPriority(event, next)
      }}
      style={{ cursor: "pointer" }}
    >
      <text
        fg={colors[props.priority ?? "none"]}
        attributes={1}
        paddingTop={1}
        paddingRight={1}
        style={{ fontSize: 18, lineHeight: 1 }}
      >
        {props.priority === "none" ? "☆" : "★"}
      </text>
    </box>
  )
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.filter((part): part is FilePart => part.type === "file"))
  const hasFiles = createMemo(() => files().length > 0)
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.info : theme.secondary))
  const displayName = createMemo(() => sync.data.config.username ?? "You")

  const openAttachment = async (event: any, file: FilePart) => {
    event.stopPropagation()
    if (renderer.getSelection()?.getSelectedText()) return
    try {
      const target = await resolveAttachmentTarget(file)
      await open(target, { wait: false })
    } catch (error) {
      console.error("attachment open failed", error)
      const label = file.filename ?? file.mime
      toast.show({ message: `Failed to open ${label}`, variant: "error" })
    }
  }

  return (
    <Show when={text() || hasFiles()}>
      <box
        id={props.message.id}
        onMouseOver={() => {
          setHover(true)
        }}
        onMouseOut={() => {
          setHover(false)
        }}
        onMouseUp={props.onMouseUp}
        border={["left"]}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        marginTop={props.index === 0 ? 0 : 1}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={color()}
        flexShrink={0}
      >
        <box flexDirection="column" gap={hasFiles() ? 1 : 0} justifyContent="center">
          <box flexDirection="row" justifyContent="flex-end" marginTop={-1} marginRight={2}>
            <MessageControls
              sessionID={props.message.sessionID}
              messageID={props.message.id}
              priority={props.message.priority}
              inline
            />
          </box>
          <box flexDirection="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
            <box flexDirection="column" flexGrow={1} gap={hasFiles() ? 1 : 0}>
              <Show when={!hasFiles()}>
                <text fg={theme.text}>{text()?.text}</text>
              </Show>
              <Show when={hasFiles()}>
                <box flexDirection="column" gap={0}>
                  <For each={files()}>
                    {(file) => (
                      <text fg={theme.text} onMouseUp={(event) => void openAttachment(event, file)}>
                        <span style={{ fg: theme.text, bold: true }}>{MIME_BADGE[file.mime] ?? file.mime}</span>{" "}
                        <span style={{ fg: theme.textMuted }}>{file.filename ?? "attachment"}</span>
                      </text>
                    )}
                  </For>
                </box>
              </Show>
            </box>
          </box>
          <Switch>
            <Match when={queued()}>
              <text fg={theme.accent} marginTop={hasFiles() ? 0 : 1}>
                <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}> QUEUED </span>{" "}
                {displayName()}
              </text>
            </Match>
            <Match when={!queued()}>
              <text fg={theme.text} marginTop={hasFiles() ? 0 : 1} style={{ justifyContent: "space-between" }}>
                <span>{displayName()}</span>
                <span style={{ fg: theme.textMuted }}>({Locale.time(props.message.time.created)})</span>
              </text>
            </Match>
          </Switch>
        </box>
      </box>
    </Show>
  )
}

function GroupedToolParts(props: { parts: ToolPart[]; message: AssistantMessage }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const sync = useSync()
  const [collapsed, setCollapsed] = createSignal(true)

  // Track permissions for auto-expand behavior
  const [hadPermission, setHadPermission] = createSignal(false)

  // Count tools by type and track first appearance order
  const toolCounts = createMemo(() => {
    const counts = new Map<string, number>()
    const firstAppearance = new Map<string, number>()

    for (let i = 0; i < props.parts.length; i++) {
      const name = props.parts[i].tool.toUpperCase()
      counts.set(name, (counts.get(name) || 0) + 1)
      if (!firstAppearance.has(name)) {
        firstAppearance.set(name, i)
      }
    }

    // Sort by first appearance
    return new Map(
      Array.from(counts.entries()).sort((a, b) => {
        return (firstAppearance.get(a[0]) ?? 0) - (firstAppearance.get(b[0]) ?? 0)
      }),
    )
  })

  // Get the last tool's description
  const lastDescription = createMemo(() => {
    const lastTool = props.parts[props.parts.length - 1]
    return lastTool?.state.input?.description || ""
  })

  // Check if any tool in the group has a pending permission
  const hasPermission = createMemo(() => {
    const permissions = sync.data.permission[props.message.sessionID] ?? []
    return props.parts.some((part) => permissions.some((p) => p.callID === part.callID))
  })

  // Auto-expand when any permission appears, auto-collapse when all resolved
  createEffect(() => {
    const currentHasPermission = hasPermission()

    if (currentHasPermission) {
      // At least one permission exists - expand to show approval forms
      setCollapsed(false)
      setHadPermission(true)
    } else if (hadPermission()) {
      // Permissions were there but now all gone (approved/denied) - collapse back
      setCollapsed(true)
    }
  })

  return (
    <box paddingLeft={3} marginTop={1}>
      <box
        flexDirection="row"
        gap={1}
        onMouseUp={() => {
          if (renderer.getSelection()?.getSelectedText()) return
          setCollapsed(!collapsed())
        }}
      >
        <text>{collapsed() ? "▶" : "▼"}</text>
        <For each={Array.from(toolCounts().entries())}>
          {([name, count]) => (
            <text>
              <span style={{ bg: theme.textMuted, fg: theme.background, bold: true }}>
                {" "}
                {name}
                {count > 1 ? `(${count})` : ""}{" "}
              </span>
            </text>
          )}
        </For>
        <text fg={theme.textMuted}>{lastDescription()}</text>
      </box>

      <Show when={!collapsed()}>
        <box paddingLeft={2} marginTop={1} gap={1}>
          <For each={props.parts}>{(part) => <ToolPart part={part} message={props.message} indent={0} />}</For>
        </box>
      </Show>
    </box>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()

  // Group consecutive identical tools
  const partGroups = createMemo(() => {
    const groups: Array<{ type: "single"; part: Part } | { type: "group"; parts: ToolPart[] }> = []
    let i = 0

    while (i < props.parts.length) {
      const part = props.parts[i]

      // If it's a tool, look ahead for consecutive identical tools
      if (part.type === "tool") {
        const toolPart = part as ToolPart
        const consecutiveTools: ToolPart[] = [toolPart]
        let j = i + 1

        // Collect consecutive tools of the same type
        while (j < props.parts.length) {
          const nextPart = props.parts[j]
          if (nextPart.type === "tool" && (nextPart as ToolPart).tool === toolPart.tool) {
            consecutiveTools.push(nextPart as ToolPart)
            j++
          } else {
            break
          }
        }

        // If we found 2+ consecutive identical tools, group them
        if (consecutiveTools.length > 1) {
          groups.push({ type: "group", parts: consecutiveTools })
          i = j
        } else {
          groups.push({ type: "single", part })
          i++
        }
      } else {
        groups.push({ type: "single", part })
        i++
      }
    }

    return groups
  })

  return (
    <>
      <box paddingLeft={2} marginTop={0} flexDirection="row" justifyContent="flex-end" marginRight={2}>
        <MessageControls
          sessionID={props.message.sessionID}
          messageID={props.message.id}
          priority={props.message.priority}
          inline
        />
      </box>
      <For each={partGroups()}>
        {(group) => (
          <Switch>
            <Match when={group.type === "group"}>
              {(() => {
                const g = group as { type: "group"; parts: ToolPart[] }
                return <GroupedToolParts parts={g.parts} message={props.message} />
              })()}
            </Match>
            <Match when={group.type === "single"}>
              {(() => {
                const g = group as { type: "single"; part: Part }
                const component = createMemo(() => PART_MAPPING[g.part.type as keyof typeof PART_MAPPING])
                return (
                  <Show when={component()}>
                    <Dynamic component={component()} part={g.part as any} message={props.message} />
                  </Show>
                )
              })()}
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Show
        when={
          props.last &&
          (!props.message.time.completed ||
            props.parts.some((item) => item.type === "step-finish" && item.reason === "tool-calls"))
        }
      >
        <box
          paddingLeft={2}
          marginTop={1}
          flexDirection="row"
          gap={1}
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.backgroundElement}
        >
          <text fg={local.agent.color(props.message.mode)}>{Locale.titlecase(props.message.mode)}</text>
          <Shimmer text={`${props.message.modelID}`} color={theme.text} />
        </box>
      </Show>
      <Show
        when={
          props.message.time.completed &&
          props.parts.some((item) => item.type === "step-finish" && item.reason !== "tool-calls")
        }
      >
        <box paddingLeft={3}>
          <text marginTop={1}>
            <span style={{ fg: local.agent.color(props.message.mode) }}>{Locale.titlecase(props.message.mode)}</span>{" "}
            <span style={{ fg: theme.textMuted }}>{props.message.modelID}</span>
          </text>
        </box>
      </Show>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { part: ReasoningPart; message: AssistantMessage; trailing?: JSX.Element }) {
  const { theme, syntax } = useTheme()
  const text = createMemo(() => props.part.text.trim())
  const previousIsReasoning = createMemo(() => {
    const parts = ((props.message as any).parts as Part[] | undefined) ?? []
    const index = parts.findIndex((part) => part.id === props.part.id)
    if (index <= 0) return false
    return parts[index - 1]?.type === "reasoning"
  })
  const summary = createMemo(() => {
    const firstLine = text()
      .split("\n")
      .find((line) => line.trim())
      ?.trim()
    if (!firstLine) return "Thinking through next step"
    return firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine
  })
  const body = createMemo(() => {
    const value = text()
    if (!value) return ""
    const lines = value.split("\n")
    const firstIndex = lines.findIndex((line) => line.trim())
    if (firstIndex === -1) return ""
    return lines
      .slice(firstIndex + 1)
      .join("\n")
      .trim()
  })
  const borderColor = createMemo(() => theme.border)
  const highlight = createMemo(() => theme.warning ?? theme.accent)
  const showBody = createMemo(() => body().length > 0)
  return (
    <Show when={text()}>
      <box id={"reasoning-" + props.part.id} marginTop={previousIsReasoning() ? 0 : 1} flexShrink={0}>
        <box
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={borderColor()}
          paddingLeft={2}
          flexDirection="column"
          gap={showBody() ? 1 : 0}
        >
          <box flexDirection="row" justifyContent="space-between" alignItems="baseline" gap={1}>
            <text wrapMode="word" fg={highlight()}>
              <span style={{ italic: true }}>Thinking:</span> <span style={{ bold: true }}>{summary()}</span>
            </text>
            <Show when={props.trailing}>
              <box flexShrink={0} width={8} justifyContent="flex-end">
                {props.trailing}
              </box>
            </Show>
          </box>
          <Show when={body()}>
            <code filetype="markdown" drawUnstyledText={false} syntaxStyle={syntax()} content={body()} />
          </Show>
        </box>
      </box>
    </Show>
  )
}

// Cache for parsed widget segments - prevents re-parsing identical content
const widgetParseCache = new Map<string, Awaited<ReturnType<typeof MessageWidgets.splitText>>>()

function TextPart(props: { part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { syntax, theme } = useTheme()
  const sdk = useSDK()
  const [segments, setSegments] = createSignal<Awaited<ReturnType<typeof MessageWidgets.splitText>>>([])
  const [processed, setProcessed] = createSignal(false)

  // Generate a stable ID based on content hash
  const partId = createMemo(() => {
    const text = props.part.text
    return `text-${text.substring(0, 50).replace(/\s/g, "")}-${text.length}`
  })

  // Memoize completion status to avoid unnecessary effect triggers
  const isCompleted = createMemo(() => props.message.time.completed)
  const isStreaming = createMemo(() => !isCompleted())

  // Memoize trimmed text to reduce string operations
  const trimmedText = createMemo(() => String(props.part.text || "").trim())

  // Use memo for streaming text to avoid rapid re-renders
  const streamingText = createMemo(() => {
    if (isStreaming()) {
      return trimmedText()
    }
    return ""
  })

  // Generate content hash for cache lookup
  const contentHash = createMemo(() => {
    const text = trimmedText()
    // Simple hash using length + first/last chars for quick lookup
    return `${text.length}-${text.charCodeAt(0) || 0}-${text.charCodeAt(text.length - 1) || 0}`
  })

  // Only trigger parsing when message completes (not during streaming)
  createEffect(
    on(
      () => [isCompleted(), trimmedText(), contentHash()] as const,
      ([completed, text, hash]) => {
        // Skip all processing during streaming - just show raw text
        if (!completed) {
          if (segments().length === 0) {
            setSegments([{ type: "text", content: text }])
          }
          return
        }

        // Already processed this exact content
        if (processed()) {
          return
        }

        // Check cache first
        const cached = widgetParseCache.get(hash)
        if (cached) {
          setSegments(cached)
          setProcessed(true)
          return
        }

        // WIDGET TEST: If text contains "widget_test", inject a sidebar widget for testing
        if (text.includes("widget_test")) {
          const testSegments = [
            { type: "text", content: "Testing sidebar widget in message stream:\n\n" },
            {
              type: "widget",
              widgetId: "context-panel",
              config: {},
              match: [] as any,
              streaming: false,
            },
            { type: "text", content: "\n\nIf you see the context panel above, message widgets work!" },
          ] as Awaited<ReturnType<typeof MessageWidgets.splitText>>

          widgetParseCache.set(hash, testSegments)
          setSegments(testSegments)
          setProcessed(true)
          return
        }

        // Parse widgets only once when message completes
        const trackedSplitText = Perf.track("MessageWidgets.splitText", MessageWidgets.splitText)
        trackedSplitText(text, { allowIncomplete: false }).then((result) => {
          const widgetCount = result.filter((s) => s.type === "widget").length
          const hasTag = text.includes("<steering-question")
          if (hasTag || widgetCount > 0) {
            Bun.write(
              Bun.file("/tmp/opencode-widget-debug.log"),
              `[${new Date().toISOString()}] TextPart segments: ${result.length}, widgets: ${widgetCount}, has tag: ${hasTag}, text length: ${text.length}\n`,
            )
          }

          // Cache the result
          widgetParseCache.set(hash, result)
          setSegments(result)
          setProcessed(true)
        })
      },
    ),
  )

  return (
    <Show when={props.part.text.trim()}>
      <box id={partId()} paddingLeft={3} marginTop={0} flexShrink={0} flexDirection="column">
        <For each={segments()}>
          {(segment) => (
            <Switch>
              <Match when={segment.type === "text"}>
                <code
                  filetype="markdown"
                  drawUnstyledText={false}
                  streaming={isStreaming()}
                  syntaxStyle={untrack(syntax)}
                  content={isStreaming() ? streamingText() : (segment as any).content}
                  conceal={ctx.conceal()}
                />
              </Match>
              <Match when={segment.type === "widget"}>
                <PluginComponent
                  componentId={(segment as any).widgetId}
                  context={{
                    config: (segment as any).config,
                    theme: theme,
                    sessionID: props.message.sessionID,
                    onSubmit: (data: any) => {
                      // Handle both steering questions and forms
                      let answerText = ""

                      if ((segment as any).widgetId === "steering-question") {
                        // Steering question format: array of { questionId, answer }
                        answerText = data
                          .map((a: any) => {
                            const answer = Array.isArray(a.answer) ? a.answer.join(", ") : a.answer
                            return `**${a.questionId}**: ${answer}`
                          })
                          .join("\n")
                        answerText = `Steering question answers:\n\n${answerText}`
                      } else if ((segment as any).widgetId === "form") {
                        // Form format: array of { fieldId, value }
                        answerText = data
                          .map((f: any) => {
                            const value = Array.isArray(f.value)
                              ? f.value.join(", ")
                              : typeof f.value === "boolean"
                                ? f.value
                                  ? "Yes"
                                  : "No"
                                : f.value
                            return `**${f.fieldId}**: ${value}`
                          })
                          .join("\n")
                        answerText = `Form submission:\n\n${answerText}`
                      } else {
                        // Generic widget - just stringify
                        answerText = JSON.stringify(data, null, 2)
                      }

                      // Send data back to the session as a user message
                      sdk.client.session.prompt({
                        path: { id: props.message.sessionID },
                        body: {
                          parts: [
                            {
                              type: "text",
                              text: answerText,
                            },
                          ],
                        },
                      })
                    },
                  }}
                />
              </Match>
            </Switch>
          )}
        </For>
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

const BLOCK_CONTAINER_MIN_HEIGHT = 3
const BLOCK_CONTAINER_PADDING = 1

function ToolPart(props: {
  part: ToolPart
  message: AssistantMessage
  indent?: number
  showPriorityControls?: boolean
}) {
  const { theme } = useTheme()
  const sync = useSync()
  const renderer = useRenderer()
  const [margin, setMargin] = createSignal(0)
  const isTaskTool = props.part.tool === "task"
  const inlineIndent = props.indent ?? 0

  const render = toolRegistry.render(props.part.tool) ?? GenericTool

  const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
  const input = props.part.state.input ?? {}
  const container = toolRegistry.container(props.part.tool)
  const priorityControls =
    props.showPriorityControls === false ? undefined : (
      <MessageControls
        sessionID={props.message.sessionID}
        messageID={props.message.id}
        priority={props.message.priority}
        inline
      />
    )

  // Make permissions reactive
  const permissions = createMemo(() => sync.data.permission[props.message.sessionID] ?? [])
  const permissionIndex = createMemo(() => permissions().findIndex((x) => x.callID === props.part.callID))
  const permission = createMemo(() => permissions()[permissionIndex()])

  // Start collapsed by default
  const [collapsed, setCollapsed] = createSignal(true)

  // Track if we've seen a permission (to detect when it's resolved)
  const [hadPermission, setHadPermission] = createSignal(false)

  // Auto-expand when permission appears, auto-collapse when it's resolved
  createEffect(() => {
    const currentPermission = permission()

    if (currentPermission) {
      // Permission exists - expand to show approval form
      setCollapsed(false)
      setHadPermission(true)
    } else if (hadPermission()) {
      // Permission was there but now gone (approved/denied) - collapse back
      setCollapsed(true)
    }
  })

  const style = createMemo(() => {
    const collapsedState = collapsed()
    if (container === "block" || permission()) {
      const basePaddingLeft = 0
      const paddingLeft = isTaskTool ? 0 : basePaddingLeft
      return {
        border: permissionIndex() === 0 ? (["left", "right"] as const) : (["left"] as const),
        paddingTop: BLOCK_CONTAINER_PADDING,
        paddingBottom: BLOCK_CONTAINER_PADDING,
        paddingLeft,
        gap: collapsedState ? 0 : 1,
        minHeight: BLOCK_CONTAINER_MIN_HEIGHT,
        backgroundColor: theme.backgroundPanel,
        customBorderChars: SplitBorder.customBorderChars,
        borderColor: permissionIndex() === 0 ? theme.warning : theme.background,
      } as BoxProps
    }
    return {
      border: ["left"] as const,
      customBorderChars: SplitBorder.customBorderChars,
      borderColor: theme.background,
      paddingLeft: inlineIndent,
      paddingTop: BLOCK_CONTAINER_PADDING,
      paddingBottom: BLOCK_CONTAINER_PADDING,
      minHeight: BLOCK_CONTAINER_MIN_HEIGHT,
      gap: collapsedState ? 0 : 1,
      backgroundColor: theme.backgroundPanel,
    } as BoxProps
  })

  return (
    <box
      marginTop={margin()}
      width="100%"
      {...style()}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(0)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        setMargin(1)
      }}
    >
      {createMemo(() => {
        const RenderComponent = render
        const isCollapsed = collapsed()

        return (
          <RenderComponent
            input={input}
            tool={props.part.tool}
            metadata={metadata}
            permission={permission()?.metadata ?? {}}
            output={props.part.state.status === "completed" ? props.part.state.output : undefined}
            collapsed={isCollapsed}
            priorityControls={priorityControls}
            onToggle={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              setCollapsed(!collapsed())
            }}
          />
        )
      })()}
      {props.part.state.status === "error" && (
        <box paddingLeft={2}>
          <text fg={theme.error}>{props.part.state.error.replace("Error: ", "")}</text>
        </box>
      )}
      {permission() && (
        <box gap={1}>
          <text fg={theme.text}>Permission required to run this tool:</text>
          <box flexDirection="row" gap={2}>
            <text>
              <b>enter</b>
              <span style={{ fg: theme.textMuted }}> accept</span>
            </text>
            <text>
              <b>a</b>
              <span style={{ fg: theme.textMuted }}> accept always</span>
            </text>
            <text>
              <b>d</b>
              <span style={{ fg: theme.textMuted }}> deny</span>
            </text>
          </box>
        </box>
      )}
    </box>
  )
}

type ToolComponent<T extends Tool.Info = any> = Component<ToolProps<T>>

type ToolRegistration<T extends Tool.Info = any> = {
  name: string
  container?: "block" | "inline"
  render: ToolComponent<T>
}

type ToolComponentRegistry = {
  register<T extends Tool.Info>(tool: ToolRegistration<T>): void
  render(name: string): ToolComponent<any> | undefined
  container(name: string): "block" | "inline"
}

const toolRegistry: ToolComponentRegistry = (() => {
  const renderers = new Map<string, ToolComponent<any>>()
  const containers = new Map<string, "block" | "inline">()

  return {
    register(tool) {
      renderers.set(tool.name, tool.render as ToolComponent<any>)
      containers.set(tool.name, tool.container ?? "inline")
    },
    render(name) {
      return renderers.get(name)
    },
    container(name) {
      return containers.get(name) ?? "block"
    },
  }
})()

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  collapsed?: boolean
  onToggle?: () => void
  priorityControls?: JSX.Element
}

function GenericTool(props: ToolProps<any>) {
  const { theme } = useTheme()
  const arrow = createMemo(() => (props.tool.toLowerCase().includes("read") ? "→" : "←"))
  return (
    <ToolTitle
      fallback="Working..."
      when={true}
      onToggle={props.onToggle}
      collapsed={props.collapsed}
      toolName={props.tool}
      input={props.input}
      output={props.output}
      trailing={props.priorityControls}
    >
      <text fg={theme.textMuted}>
        {props.tool.toLowerCase().includes("read") ? "→" : "←"} {props.tool} {input(props.input)}
      </text>
    </ToolTitle>
  )
}

type ToolTitleProps = {
  fallback: string
  when: any
  collapsed?: boolean
  onToggle?: () => void
  toolName: string
  input: Record<string, unknown>
  output?: string
  trailing?: JSX.Element
  children: JSX.Element
}

type ToolMouseEvent = {
  stopPropagation?: () => void
}

function ToolTitle(props: ToolTitleProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const toast = useToast()

  const isCollapsed = createMemo(() => Boolean(props.collapsed))

  const serializedInput = createMemo(() => {
    const entries = Object.entries(props.input ?? {})
    if (entries.length === 0) return ""
    try {
      return JSON.stringify(props.input, null, 2)
    } catch {
      return ""
    }
  })
  const serializedOutput = createMemo(() => (props.output ?? "").trim())

  const copy = (label: string, value: string) => {
    if (!value) return
    Clipboard.copy(value)
      .then(() => toast.show({ message: `${label} copied to clipboard`, variant: "success" }))
      .catch(() => toast.show({ message: `Failed to copy ${label.toLowerCase()}`, variant: "error" }))
  }

  const showMenu = (event: ToolMouseEvent) => {
    event.stopPropagation?.()
    if (renderer.getSelection()?.getSelectedText()) return

    const options: DialogSelectOption<string>[] = []
    if (props.onToggle) {
      options.push({
        title: isCollapsed() ? "Expand output" : "Collapse output",
        value: "toggle",
        onSelect: (ctx) => {
          props.onToggle?.()
          ctx.clear()
        },
      })
    }
    const inputText = serializedInput()
    if (inputText) {
      options.push({
        title: "Copy tool input",
        value: "copy-input",
        onSelect: (ctx) => {
          copy(`${props.toolName} input`, inputText)
          ctx.clear()
        },
      })
    }
    const outputText = serializedOutput()
    if (outputText) {
      options.push({
        title: "Copy tool output",
        value: "copy-output",
        onSelect: (ctx) => {
          copy(`${props.toolName} output`, outputText)
          ctx.clear()
        },
      })
    }
    if (options.length === 0) return
    dialog.replace(() => <DialogSelect title={`${props.toolName} Actions`} options={options} />)
  }

  const handleToggle = (event: ToolMouseEvent) => {
    if (!props.onToggle) return
    if (renderer.getSelection()?.getSelectedText()) return
    event.stopPropagation?.()
    props.onToggle()
  }

  return (
    <box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      gap={1}
      width="100%"
      backgroundColor={theme.backgroundPanel}
    >
      <box flexDirection="row" alignItems="center" gap={1} flexGrow={1} onMouseUp={(event) => handleToggle(event)}>
        <Show fallback={<text fg={theme.textMuted}>~ {props.fallback}</text>} when={props.when}>
          <box flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
            {props.children}
          </box>
        </Show>
      </box>
      <Show when={props.trailing}>
        <box flexDirection="row" alignItems="center" gap={0} flexShrink={0}>
          <box alignItems="center">{props.trailing}</box>
        </box>
      </Show>
    </box>
  )
}

function ToolBadge(props: { children: JSX.Element | string }) {
  const { theme } = useTheme()
  const label = createMemo(() => {
    if (typeof props.children === "string") return props.children.toUpperCase()
    return String(props.children ?? "").toUpperCase()
  })
  return (
    <text fg={theme.accent} bg={theme.background}>
      {` ${label()} `}
    </text>
  )
}

toolRegistry.register<typeof BashTool>({
  name: "bash",
  container: "block",
  render(props) {
    const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle
          fallback="Writing command..."
          when={props.input.command}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Bash"
          input={props.input}
          output={output()}
          trailing={props.priorityControls}
        >
          <ToolBadge>Bash</ToolBadge>
          <text fg={theme.text}>{props.input.description || "Shell"}</text>
        </ToolTitle>
        <Show when={!props.collapsed}>
          <Show when={props.input.command}>
            <text fg={theme.text}>$ {props.input.command}</text>
          </Show>
          <Show when={output()}>
            <box>
              <text fg={theme.text}>{output()}</text>
            </box>
          </Show>
        </Show>
      </>
    )
  },
})

toolRegistry.register<typeof ReadTool>({
  name: "read",
  container: "block",
  render(props) {
    const { theme, syntax } = useTheme()
    const ft = createMemo(() => filetype(props.input.filePath!))
    return (
      <>
        <ToolTitle
          fallback="Reading file..."
          when={props.input.filePath}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Read"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>Read</ToolBadge>
          <text fg={theme.text}>
            {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
          </text>
        </ToolTitle>
        <Show when={!props.collapsed && props.output}>
          <box paddingTop={1}>
            <code filetype={ft()} syntaxStyle={syntax()} content={props.output ?? ""} />
          </box>
        </Show>
      </>
    )
  },
})

toolRegistry.register<typeof WriteTool>({
  name: "write",
  container: "block",
  render(props) {
    const { theme, syntax } = useTheme()
    const lines = createMemo(() => {
      return props.input.content?.split("\n") ?? []
    })
    const code = createMemo(() => {
      if (!props.input.content) return ""
      const text = props.input.content
      return text
    })

    const numbers = createMemo(() => {
      const pad = lines().length.toString().length
      return lines()
        .map((_, index) => index + 1)
        .map((x) => x.toString().padStart(pad, " "))
    })

    return (
      <>
        <ToolTitle
          fallback="Preparing write..."
          when={props.input.filePath}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Write"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>Write</ToolBadge>
          <text fg={theme.text}>{props.input.filePath}</text>
        </ToolTitle>

        <Show when={!props.collapsed}>
          <box flexDirection="row">
            <box flexShrink={0}>
              <For each={numbers()}>{(value) => <text style={{ fg: theme.textMuted }}>{value}</text>}</For>
            </box>
            <box paddingLeft={1} flexGrow={1}>
              <code filetype={filetype(props.input.filePath!)} syntaxStyle={syntax()} content={code()} />
            </box>
          </box>
        </Show>
      </>
    )
  },
})

toolRegistry.register<typeof GlobTool>({
  name: "glob",
  container: "inline",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle
          fallback="Finding files..."
          when={props.input.pattern}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Glob"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>Glob</ToolBadge>
          <text fg={theme.text}>"{props.input.pattern}"</text>
          <Show when={props.input.path}>
            <text fg={theme.textMuted}>in {normalizePath(props.input.path)}</text>
          </Show>
          <Show when={props.metadata.count}>
            <text fg={theme.textMuted}>({props.metadata.count} matches)</text>
          </Show>
        </ToolTitle>
      </>
    )
  },
})

toolRegistry.register<typeof GrepTool>({
  name: "grep",
  container: "inline",
  render(props) {
    const { theme } = useTheme()
    return (
      <ToolTitle
        fallback="Searching content..."
        when={props.input.pattern}
        onToggle={props.onToggle}
        collapsed={props.collapsed}
        toolName="Grep"
        input={props.input}
        output={props.output}
        trailing={props.priorityControls}
      >
        <ToolBadge>Grep</ToolBadge>
        <text fg={theme.text}>"{props.input.pattern}"</text>
        <Show when={props.input.path}>
          <text fg={theme.textMuted}>in {normalizePath(props.input.path)}</text>
        </Show>
        <Show when={props.metadata.matches}>
          <text fg={theme.textMuted}>({props.metadata.matches} matches)</text>
        </Show>
      </ToolTitle>
    )
  },
})

toolRegistry.register<typeof ListTool>({
  name: "list",
  container: "inline",
  render(props) {
    const { theme } = useTheme()
    const dir = createMemo(() => {
      if (props.input.path) {
        return normalizePath(props.input.path)
      }
      return ""
    })
    return (
      <>
        <ToolTitle
          fallback="Listing directory..."
          when={props.input.path !== undefined}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="List"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>List</ToolBadge>
          <text fg={theme.text}>{dir()}</text>
        </ToolTitle>
      </>
    )
  },
})

toolRegistry.register<typeof TaskTool>({
  name: "task",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const keybind = useKeybind()
    const { navigate } = useRoute()
    const renderer = useRenderer()
    let scrollboxRef: ScrollBoxRenderable | undefined

    const summarySignature = createMemo(() => {
      const items = props.metadata.summary ?? []
      return items
        .map((task) => {
          const title = "title" in task.state ? (task.state.title ?? "") : ""
          return `${task.tool}:${task.state.status}:${title}`
        })
        .join("|")
    })

    createEffect(() => {
      summarySignature()
      props.metadata.sessionId
      if (!scrollboxRef || props.collapsed) return
      setTimeout(() => {
        if (!scrollboxRef) return
        scrollboxRef.scrollTo({ x: scrollboxRef.scrollLeft ?? 0, y: scrollboxRef.scrollHeight })
      }, 50)
    })

    return (
      <>
        <ToolTitle
          fallback="Delegating..."
          when={props.input.subagent_type ?? props.input.description}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Task"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>Task</ToolBadge>
          <text fg={theme.text}>
            [{props.input.subagent_type ?? "unknown"}] {props.input.description}
          </text>
        </ToolTitle>
        <Show when={!props.collapsed}>
          <scrollbox
            height={15}
            ref={(node) => {
              scrollboxRef = node ?? undefined
            }}
            scrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column" gap={1} paddingLeft={1}>
              <Show when={props.metadata.summary?.length}>
                <box>
                  <For each={props.metadata.summary ?? []}>
                    {(task) => {
                      const title = "title" in task.state ? (task.state.title ?? "") : ""
                      return (
                        <text style={{ fg: theme.textMuted }}>
                          ∟ {task.tool} {task.state.status === "completed" ? title : ""}
                        </text>
                      )
                    }}
                  </For>
                </box>
              </Show>
              <Show when={props.metadata.sessionId}>
                {(sessionId) => (
                  <text
                    fg={theme.accent}
                    attributes={1}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      navigate({
                        type: "session",
                        sessionID: sessionId(),
                      })
                    }}
                  >
                    → Click to view subagent session
                  </text>
                )}
              </Show>
              <text fg={theme.text}>
                {keybind.print("session_child_cycle")}, {keybind.print("session_child_cycle_reverse")}
                <span style={{ fg: theme.textMuted }}> to navigate between subagent sessions</span>
              </text>
            </box>
          </scrollbox>
        </Show>
      </>
    )
  },
})

toolRegistry.register<typeof WebFetchTool>({
  name: "webfetch",
  container: "inline",
  render(props) {
    const { theme } = useTheme()
    return (
      <ToolTitle
        fallback="Fetching from the web..."
        when={(props.input as any).url}
        onToggle={props.onToggle}
        collapsed={props.collapsed}
        toolName="WebFetch"
        input={props.input}
        output={props.output}
        trailing={props.priorityControls}
      >
        <ToolBadge>WebFetch</ToolBadge>
        <text fg={theme.text}>{(props.input as any).url}</text>
      </ToolTitle>
    )
  },
})

toolRegistry.register<typeof EditTool>({
  name: "edit",
  container: "block",
  render(props) {
    const ctx = use()
    const { theme, syntax } = useTheme()

    const style = createMemo(() => (ctx.width > 120 ? "split" : "stacked"))

    const diff = createMemo(() => {
      const diff = props.metadata.diff ?? props.permission["diff"]
      if (!diff) return null

      try {
        const patches = parsePatch(diff)
        if (patches.length === 0) return null

        const patch = patches[0]
        const oldLines: string[] = []
        const newLines: string[] = []

        for (const hunk of patch.hunks) {
          let i = 0
          while (i < hunk.lines.length) {
            const line = hunk.lines[i]

            if (line.startsWith("-")) {
              const removedLines: string[] = []
              while (i < hunk.lines.length && hunk.lines[i].startsWith("-")) {
                removedLines.push("- " + hunk.lines[i].slice(1))
                i++
              }

              const addedLines: string[] = []
              while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
                addedLines.push("+ " + hunk.lines[i].slice(1))
                i++
              }

              const maxLen = Math.max(removedLines.length, addedLines.length)
              for (let j = 0; j < maxLen; j++) {
                oldLines.push(removedLines[j] ?? "")
                newLines.push(addedLines[j] ?? "")
              }
            } else if (line.startsWith("+")) {
              const addedLines: string[] = []
              while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
                addedLines.push("+ " + hunk.lines[i].slice(1))
                i++
              }

              for (const added of addedLines) {
                oldLines.push("")
                newLines.push(added)
              }
            } else {
              oldLines.push("  " + line.slice(1))
              newLines.push("  " + line.slice(1))
              i++
            }
          }
        }

        return {
          oldContent: oldLines.join("\n"),
          newContent: newLines.join("\n"),
        }
      } catch (error) {
        return null
      }
    })

    const code = createMemo(() => {
      if (!props.metadata.diff) return ""
      const text = props.metadata.diff.split("\n").slice(5).join("\n")
      return text.trim()
    })

    const ft = createMemo(() => filetype(props.input.filePath))
    const editDetails = createMemo(() =>
      input({
        replaceAll: props.input.replaceAll,
      }),
    )

    return (
      <>
        <ToolTitle
          fallback="Preparing edit..."
          when={props.input.filePath}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Edit"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>Edit</ToolBadge>
          <text fg={theme.text}>{normalizePath(props.input.filePath!)}</text>
          <Show when={editDetails()}>{(details) => <text fg={theme.textMuted}>{details()}</text>}</Show>
        </ToolTitle>
        <Show when={!props.collapsed}>
          <Switch>
            <Match when={props.permission["diff"]}>
              <text fg={theme.text}>{props.permission["diff"]?.trim()}</text>
            </Match>
            <Match when={diff() && style() === "split"}>
              <box paddingLeft={1} flexDirection="row" gap={2}>
                <box flexGrow={1} flexBasis={0}>
                  <code filetype={ft()} syntaxStyle={syntax()} content={diff()!.oldContent} />
                </box>
                <box flexGrow={1} flexBasis={0}>
                  <code filetype={ft()} syntaxStyle={syntax()} content={diff()!.newContent} />
                </box>
              </box>
            </Match>
            <Match when={code()}>
              <box paddingLeft={1}>
                <code filetype={ft()} syntaxStyle={syntax()} content={code()} />
              </box>
            </Match>
          </Switch>
        </Show>
      </>
    )
  },
})

toolRegistry.register<typeof PatchTool>({
  name: "patch",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle
          fallback="Preparing patch..."
          when={true}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Patch"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>Patch</ToolBadge>
        </ToolTitle>
        <Show when={props.output}>
          <box>
            <text fg={theme.text}>{props.output?.trim()}</text>
          </box>
        </Show>
      </>
    )
  },
})

toolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <box marginLeft={1}>
        <For each={props.input.todos ?? []}>
          {(todo) => (
            <box flexDirection="row" alignItems="center" gap={1}>
              <text fg={theme.textMuted}>{todo.status === "completed" ? "●" : "○"}</text>
              <text fg={todo.status === "in_progress" ? theme.success : theme.textMuted}>{todo.content}</text>
            </box>
          )}
        </For>
      </box>
    )
  },
})

toolRegistry.register<typeof AddTaskTool>({
  name: "add_task",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const keybind = useKeybind()
    const { navigate } = useRoute()
    const renderer = useRenderer()
    const taskInput = props.input as { subagent_type?: string; description?: string }

    return (
      <>
        <ToolTitle
          fallback="Creating subagent task..."
          when={taskInput.subagent_type ?? taskInput.description}
          onToggle={props.onToggle}
          collapsed={props.collapsed}
          toolName="Add Task"
          input={props.input}
          output={props.output}
          trailing={props.priorityControls}
        >
          <ToolBadge>Add Task</ToolBadge>
          <text fg={theme.text}>
            [{taskInput.subagent_type ?? "unknown"}] {taskInput.description}
          </text>
        </ToolTitle>
        <Show when={!props.collapsed}>
          <Show when={props.metadata.sessionId}>
            {(sessionId) => (
              <text
                fg={theme.accent}
                attributes={1}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  navigate({
                    type: "session",
                    sessionID: sessionId(),
                  })
                }}
              >
                → Click to view subagent session
              </text>
            )}
          </Show>
          <text fg={theme.text}>
            {keybind.print("session_child_cycle")}, {keybind.print("session_child_cycle_reverse")}
            <span style={{ fg: theme.textMuted }}> to navigate between subagent sessions</span>
          </text>
        </Show>
      </>
    )
  },
})

// Register cc_* (Anthropic-native) tools to use same renderers as standard tools
toolRegistry.register({
  name: "cc_bash",
  container: "block",
  render: toolRegistry.render("bash")!,
})

toolRegistry.register({
  name: "cc_read",
  container: "inline",
  render: toolRegistry.render("read")!,
})

toolRegistry.register({
  name: "cc_write",
  container: "block",
  render: toolRegistry.render("write")!,
})

toolRegistry.register({
  name: "cc_edit",
  container: "block",
  render: toolRegistry.render("edit")!,
})

toolRegistry.register({
  name: "cc_list",
  container: "inline",
  render: toolRegistry.render("list")!,
})

toolRegistry.register({
  name: "cc_glob",
  container: "inline",
  render: toolRegistry.render("glob")!,
})

toolRegistry.register({
  name: "cc_grep",
  container: "inline",
  render: toolRegistry.render("grep")!,
})

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
