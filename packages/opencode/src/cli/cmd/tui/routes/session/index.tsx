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
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import { BoxRenderable, ScrollBoxRenderable, addDefaultParsers } from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type {
  AssistantMessage,
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
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
  type BoxProps,
  type JSX,
} from "@opentui/solid"
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
import { DialogTimeline } from "./dialog-timeline"
import { Sidebar } from "./sidebar"
import { LeftSidebar } from "./left-sidebar"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { MessageWidgets } from "@/ui/message-widgets"
import { PluginComponent } from "../../component/plugin-component"
import stripAnsi from "strip-ansi"

addDefaultParsers(parsers.parsers)

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
      renderBefore={function() {
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
          const xChar = (hover() || isActive()) ? " ×" : ""
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
              renderBefore={function() {
                const el = this as BoxRenderable
                el.on("mouseenter", () => setHover(true))
                el.on("mouseleave", () => setHover(false))
              }}
              onMouseUp={(evt) => {
                if (renderer.getSelection()?.getSelectedText()) return
                const target = (evt as any).target
                if (target?.textContent?.includes('×')) {
                  props.onClose(session.id)
                } else {
                  props.onSelect(session.id)
                }
              }}
            >
              <text style={{ fg: borderColor, bg: tabBgColor }}>{topBar}</text>
              <box flexDirection="row" backgroundColor={tabBgColor}>
                <text fg={textColor}>
                  {isActive() ? <b>{title}</b> : title}
                </text>
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

export function Session() {
  const route = useRouteData("session")
  const router = useRoute()
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(route.sessionID)!)

  // Track open session tabs
  const [openTabs, setOpenTabs] = createSignal<string[]>(
    kv.get("openTabs", [])
  )

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

  const messages = createMemo(() => {
    const currentSessionID = route.sessionID
    const current = sync.data.message[currentSessionID]

    // Return current messages if available, otherwise cached
    return current && current.length > 0 ? current : cachedMessages()
  })

  const permissions = createMemo(() => sync.data.permission[route.sessionID] ?? [])

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time?.completed)?.id
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("sidebar", "auto"))
  const [leftSidebar, setLeftSidebar] = createSignal<"show" | "hide" | "auto">(
    kv.get("leftSidebar", "auto"),
  )
  const [rightSidebar, setRightSidebar] = createSignal<"show" | "hide" | "auto">(
    kv.get("rightSidebar", "auto"),
  )
  const [conceal, setConceal] = createSignal(true)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => sidebar() === "show" || (sidebar() === "auto" && wide()))

  const leftSidebarVisible = createMemo(
    () => leftSidebar() === "show" || (leftSidebar() === "auto" && wide()),
  )
  const rightSidebarVisible = createMemo(
    () => rightSidebar() === "show" || (rightSidebar() === "auto" && wide()),
  )

  const bothSidebarsCollapsed = createMemo(() => !leftSidebarVisible() && !rightSidebarVisible())

  const toggleLeftSidebar = () => {
    setLeftSidebar((prev) => {
      const next =
        prev === "auto"
          ? leftSidebarVisible()
            ? "hide"
            : "show"
          : prev === "show"
            ? "hide"
            : "show"
      if (next === "show") kv.set("leftSidebar", "auto")
      if (next === "hide") kv.set("leftSidebar", "hide")
      return next
    })
  }

  const toggleRightSidebar = () => {
    setRightSidebar((prev) => {
      const next =
        prev === "auto"
          ? rightSidebarVisible()
            ? "hide"
            : "show"
          : prev === "show"
            ? "hide"
            : "show"
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

  const handleSwitchSession = () => {
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
    const leftWidth = leftSidebarVisible() ? 30 : 0
    const rightWidth = rightSidebarVisible() ? 42 : 0
    return dimensions().width - leftWidth - rightWidth - 4
  })

  const toast = useToast()

  const sdk = useSDK()

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()

  // Sync session data when session changes
  createEffect(async () => {
    await sync.session.sync(route.sessionID).catch(() => {
      toast.show({
        message: `Session not found: ${route.sessionID}`,
        variant: "error",
      })
      return navigate({ type: "home" })
    })
  })

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    // ESC to go back to parent session when in a subagent
    const parentID = session()?.parentID
    if (evt.name === "escape" && parentID) {
      navigate({
        type: "session",
        sessionID: parentID,
      })
      return
    }

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
  createEffect(on(() => route.sessionID, () => {
    setTimeout(() => {
      if (scroll) toBottom()
    }, 200)
  }))

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

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
    const reverted = messages().filter((x) => x.id >= messageID && x.role === "user")

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
      <box
        flexDirection="row"
        paddingBottom={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        gap={2}
      >
        {/* Left Sidebar */}
        <Show when={leftSidebarVisible()}>
          <LeftSidebar
            sessionID={route.sessionID}
            onToggle={toggleLeftSidebar}
            onSelect={selectSession}
            onSwitch={handleSwitchSession}
            openTabs={openTabs()}
            onClose={handleCloseSession}
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
                <text fg={theme.text}>
                  Previous{" "}
                  <span style={{ fg: theme.textMuted }}>
                    {keybind.print("session_child_cycle_reverse")}
                  </span>
                </text>
                <text fg={theme.text}>
                  <b>Viewing subagent session</b>
                </text>
                <text fg={theme.text}>
                  <span style={{ fg: theme.textMuted }}>
                    {keybind.print("session_child_cycle")}
                  </span>{" "}
                  Next
                </text>
              </box>
            </Show>
            <Show when={!sidebarVisible() && !leftSidebarVisible()}>
              <Header />
            </Show>
            <box flexGrow={1} flexShrink={1}>
              <scrollbox
                ref={(r) => (scroll = r)}
                scrollbarOptions={{
                  paddingLeft: 2,
                  trackOptions: {
                    backgroundColor: theme.backgroundElement,
                    foregroundColor: theme.border,
                  },
                }}
                stickyScroll={true}
                stickyStart="bottom"
                height="100%"
              >
              <For each={messages()}>
                {(message, index) => (
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
                              backgroundColor={
                                hover() ? theme.backgroundElement : theme.backgroundPanel
                              }
                            >
                              <text fg={theme.textMuted}>
                                {revert()!.reverted.length} message reverted
                              </text>
                              <text fg={theme.textMuted}>
                                <span style={{ fg: theme.text }}>
                                  {keybind.print("messages_redo")}
                                </span>{" "}
                                or /redo to restore
                              </text>
                              <Show when={revert()!.diffFiles?.length}>
                                <box marginTop={1}>
                                  <For each={revert()!.diffFiles}>
                                    {(file) => (
                                      <text>
                                        {file.filename}
                                        <Show when={file.additions > 0}>
                                          <span style={{ fg: theme.diffAdded }}>
                                            {" "}
                                            +{file.additions}
                                          </span>
                                        </Show>
                                        <Show when={file.deletions > 0}>
                                          <span style={{ fg: theme.diffRemoved }}>
                                            {" "}
                                            -{file.deletions}
                                          </span>
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
                    <Match when={message.role === "user"}>
                      <UserMessage
                        index={index()}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          dialog.replace(() => (
                            <DialogMessage messageID={message.id} sessionID={route.sessionID} />
                          ))
                        }}
                        message={message as UserMessage}
                        parts={sync.data.part[message.id] ?? []}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={index() === messages().length - 1}
                        message={message as AssistantMessage}
                        parts={sync.data.part[message.id] ?? []}
                      />
                    </Match>
                  </Switch>
                )}
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
          <Sidebar sessionID={route.sessionID} onToggle={toggleRightSidebar} />
        </Show>
      </box>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const text = createMemo(
    () => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0],
  )
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : theme.secondary))

  return (
    <Show when={text()}>
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
        <text fg={theme.text}>{text()?.text}</text>
        <Show when={files().length}>
          <box flexDirection="row" paddingBottom={1} paddingTop={1} gap={1} flexWrap="wrap">
            <For each={files()}>
              {(file) => {
                const bg = createMemo(() => {
                  if (file.mime.startsWith("image/")) return theme.accent
                  if (file.mime === "application/pdf") return theme.primary
                  return theme.secondary
                })
                return (
                  <text fg={theme.text}>
                    <span style={{ bg: bg(), fg: theme.background }}>
                      {" "}
                      {MIME_BADGE[file.mime] ?? file.mime}{" "}
                    </span>
                    <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}>
                      {" "}
                      {file.filename}{" "}
                    </span>
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <text fg={theme.text}>
          {sync.data.config.username ?? "You"}{" "}
          <Show
            when={queued()}
            fallback={
              <span style={{ fg: theme.textMuted }}>
                ({Locale.time(props.message.time.created)})
              </span>
            }
          >
            <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}>
              {" "}
              QUEUED{" "}
            </span>
          </Show>
        </text>
      </box>
    </Show>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  return (
    <>
      <For each={props.parts}>
        {(part) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic component={component()} part={part as any} message={props.message} />
            </Show>
          )
        }}
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
          !props.message.time.completed ||
          (props.last &&
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
          <text fg={local.agent.color(props.message.mode)}>
            {Locale.titlecase(props.message.mode)}
          </text>
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
            <span style={{ fg: local.agent.color(props.message.mode) }}>
              {Locale.titlecase(props.message.mode)}
            </span>{" "}
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

function ReasoningPart(props: { part: ReasoningPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box
        id={"text-" + props.part.id}
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
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={theme.text}>{props.part.text.trim()}</text>
        </box>
      </box>
    </Show>
  )
}

function TextPart(props: { part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { syntax, theme } = useTheme()
  const sdk = useSDK()
  const [segments, setSegments] = createSignal<
    Awaited<ReturnType<typeof MessageWidgets.splitText>>
  >([])

  // Generate a stable ID based on content hash
  const partId = createMemo(() => {
    const text = props.part.text
    return `text-${text.substring(0, 50).replace(/\s/g, "")}-${text.length}`
  })

  createEffect(() => {
    const text = props.part.text.trim()

    // WIDGET TEST: If text contains "widget_test", inject a sidebar widget for testing
    if (text.includes("widget_test")) {
      setSegments([
        { type: "text", content: "Testing sidebar widget in message stream:\n\n" },
        {
          type: "widget",
          widgetId: "context-panel",
          config: {},
          match: [] as any,
          streaming: false,
        },
        { type: "text", content: "\n\nIf you see the context panel above, message widgets work!" },
      ])
      return
    }

    // Allow incomplete widgets for progressive rendering during streaming
    const isStreaming = !props.message.time.completed
    MessageWidgets.splitText(text, { allowIncomplete: isStreaming }).then((result) => {
      const widgetCount = result.filter((s) => s.type === "widget").length
      const hasTag = text.includes("<steering-question")
      if (hasTag || widgetCount > 0) {
        Bun.write(
          Bun.file("/tmp/opencode-widget-debug.log"),
          `[${new Date().toISOString()}] TextPart segments: ${result.length}, widgets: ${widgetCount}, has tag: ${hasTag}, text length: ${text.length}\n`,
        )
      }
      setSegments(result)
    })
  })

  return (
    <Show when={props.part.text.trim()}>
      <box id={partId()} paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
        <For each={segments()}>
          {(segment) => (
            <Switch>
              <Match when={segment.type === "text"}>
                <code
                  filetype="markdown"
                  drawUnstyledText={false}
                  streaming={true}
                  syntaxStyle={syntax()}
                  content={(segment as any).content}
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

function ToolPart(props: { part: ToolPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const sync = useSync()
  const renderer = useRenderer()
  const [margin, setMargin] = createSignal(0)
  const [collapsed, setCollapsed] = createSignal(true)
  
  const render = ToolRegistry.render(props.part.tool) ?? GenericTool
  const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
  const input = props.part.state.input ?? {}
  const container = ToolRegistry.container(props.part.tool)
  const permissions = sync.data.permission[props.message.sessionID] ?? []
  const permissionIndex = permissions.findIndex((x) => x.callID === props.part.callID)
  const permission = permissions[permissionIndex]

  const style: BoxProps =
    container === "block" || permission
      ? {
          border: permissionIndex === 0 ? (["left", "right"] as const) : (["left"] as const),
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          marginTop: 1,
          gap: 1,
          backgroundColor: theme.backgroundPanel,
          customBorderChars: SplitBorder.customBorderChars,
          borderColor: permissionIndex === 0 ? theme.warning : theme.background,
        }
      : {
          paddingLeft: 3,
        }

  return (
    <box
      marginTop={margin()}
      {...style}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      {createMemo(() => {
        const RenderComponent = render
        const isCollapsed = collapsed()
        console.log('[ToolPart] Rendering tool, collapsed:', isCollapsed)
        return (
          <RenderComponent
            input={input}
            tool={props.part.tool}
            metadata={metadata}
            permission={permission?.metadata ?? {}}
            output={props.part.state.status === "completed" ? props.part.state.output : undefined}
            collapsed={isCollapsed}
            onToggle={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              console.log('[ToolPart] Toggle clicked, collapsed was:', collapsed())
              setCollapsed(!collapsed())
              console.log('[ToolPart] Toggle clicked, collapsed now:', !collapsed())
            }}
          />
        )
      })()}
      {props.part.state.status === "error" && (
        <box paddingLeft={2}>
          <text fg={theme.error}>{props.part.state.error.replace("Error: ", "")}</text>
        </box>
      )}
      {permission && (
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

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  collapsed?: boolean
  onToggle?: () => void
}
function GenericTool(props: ToolProps<any>) {
  const icon = createMemo(() => props.collapsed ? "▶" : "▼")
  const { theme, syntax } = useTheme()
  console.log('[GenericTool]', props.tool, 'collapsed:', props.collapsed, 'onToggle:', !!props.onToggle)
  return (
    <>
      <ToolTitle icon={icon()} fallback="Writing command..." when={true} onToggle={props.onToggle}>
        <ToolBadge>{props.tool}</ToolBadge> {input(props.input)}
      </ToolTitle>
      <Show when={!props.collapsed}>
        <Show when={props.output}>
          <box>
            <text fg={theme.text}>{props.output}</text>
          </box>
        </Show>
      </Show>
    </>
  )
}

type ToolRegistration<T extends Tool.Info = any> = {
  name: string
  container: "inline" | "block"
  render?: Component<ToolProps<T>>
}
const ToolRegistry = (() => {
  const state: Record<string, ToolRegistration> = {}
  function register<T extends Tool.Info>(input: ToolRegistration<T>) {
    state[input.name] = input
    return input
  }
  return {
    register,
    container(name: string) {
      return state[name]?.container
    },
    render(name: string) {
      return state[name]?.render
    },
  }
})()

function ToolBadge(props: { children: string }) {
  const { theme } = useTheme()
  return (
    <span style={{ bg: theme.textMuted, fg: theme.background, bold: true }}>
      {" "}
      {props.children.toUpperCase()}{" "}
    </span>
  )
}

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element; onToggle?: () => void }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  return (
    <box
      onMouseUp={(evt) => {
        if (renderer.getSelection()?.getSelectedText()) return
        console.log('[ToolTitle] Clicked, onToggle exists:', !!props.onToggle)
        props.onToggle?.()
      }}
    >
      <text fg={props.when ? theme.textMuted : theme.text}>
        <Show fallback={<>~ {props.fallback}</>} when={props.when}>
          <span style={{ bold: true }}>{props.icon}</span> {props.children}
        </Show>
      </text>
    </box>
  )
}

ToolRegistry.register<typeof BashTool>({
  name: "bash",
  container: "block",
  render(props) {
    const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
    const { theme } = useTheme()
    const icon = createMemo(() => props.collapsed ? "▶" : "▼")
    return (
      <>
        <ToolTitle icon={icon()} fallback="Writing command..." when={props.input.command} onToggle={props.onToggle}>
          <ToolBadge>Bash</ToolBadge> {props.input.description || "Shell"}
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

ToolRegistry.register<typeof ReadTool>({
  name: "read",
  container: "inline",
  render(props) {
    const { theme } = useTheme()
    const icon = createMemo(() => props.collapsed ? "▶" : "▼")
    return (
      <>
        <ToolTitle icon={icon()} fallback="Reading file..." when={props.input.filePath} onToggle={props.onToggle}>
          <ToolBadge>Read</ToolBadge> {normalizePath(props.input.filePath!)}{" "}
          {input(props.input, ["filePath"])}
        </ToolTitle>
        <Show when={!props.collapsed && props.output}>
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>{props.output}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof WriteTool>({
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

    const icon = createMemo(() => props.collapsed ? "▶" : "▼")
    console.log('[WriteTool] collapsed:', props.collapsed)

    return (
      <>
        <ToolTitle icon={icon()} fallback="Preparing write..." when={props.input.filePath} onToggle={props.onToggle}>
          <ToolBadge>Write</ToolBadge> {props.input.filePath}
        </ToolTitle>
        <Show when={!props.collapsed}>
          <box flexDirection="row">
            <box flexShrink={0}>
              <For each={numbers()}>
                {(value) => <text style={{ fg: theme.textMuted }}>{value}</text>}
              </For>
            </box>
            <box paddingLeft={1} flexGrow={1}>
              <code
                filetype={filetype(props.input.filePath!)}
                syntaxStyle={syntax()}
                content={code()}
              />
            </box>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof GlobTool>({
  name: "glob",
  container: "inline",
  render(props) {
    const icon = createMemo(() => props.collapsed ? "▶" : "▼")
    return (
      <>
        <ToolTitle icon={icon()} fallback="Finding files..." when={props.input.pattern} onToggle={props.onToggle}>
          <ToolBadge>Glob</ToolBadge> "{props.input.pattern}"{" "}
          <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
          <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof GrepTool>({
  name: "grep",
  container: "inline",
  render(props) {
    const icon = createMemo(() => props.collapsed ? "▶" : "▼")
    return (
      <ToolTitle icon={icon()} fallback="Searching content..." when={props.input.pattern} onToggle={props.onToggle}>
        <ToolBadge>Grep</ToolBadge> "{props.input.pattern}"{" "}
        <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
        <Show when={props.metadata.matches}>({props.metadata.matches} matches)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof ListTool>({
  name: "list",
  container: "inline",
  render(props) {
    const dir = createMemo(() => {
      if (props.input.path) {
        return normalizePath(props.input.path)
      }
      return ""
    })
    const icon = createMemo(() => props.collapsed ? "▶" : "▼")
    return (
      <>
        <ToolTitle icon={icon()} fallback="Listing directory..." when={props.input.path !== undefined} onToggle={props.onToggle}>
          <ToolBadge>List</ToolBadge> {dir()}
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof TaskTool>({
  name: "task",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const keybind = useKeybind()
    const { navigate } = useRoute()
    const renderer = useRenderer()

    return (
      <>
        <ToolTitle
          icon="%"
          fallback="Delegating..."
          when={props.input.subagent_type ?? props.input.description}
        >
          <ToolBadge>Task</ToolBadge> [{props.input.subagent_type ?? "unknown"}]{" "}
          {props.input.description}
        </ToolTitle>
        <Show when={props.metadata.summary?.length}>
          <box>
            <For each={props.metadata.summary ?? []}>
              {(task) => (
                <text style={{ fg: theme.textMuted }}>
                  ∟ {task.tool} {task.state.status === "completed" ? task.state.title : ""}
                </text>
              )}
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
      </>
    )
  },
})

ToolRegistry.register<typeof WebFetchTool>({
  name: "webfetch",
  container: "inline",
  render(props) {
    return (
      <ToolTitle icon="%" fallback="Fetching from the web..." when={(props.input as any).url}>
        <ToolBadge>WebFetch</ToolBadge> {(props.input as any).url}
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof EditTool>({
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
    const icon = createMemo(() => props.collapsed ? "▶" : "▼")

    return (
      <>
        <ToolTitle icon={icon()} fallback="Preparing edit..." when={props.input.filePath} onToggle={props.onToggle}>
          <ToolBadge>Edit</ToolBadge> {normalizePath(props.input.filePath!)}{" "}
          {input({
            replaceAll: props.input.replaceAll,
          })}
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

ToolRegistry.register<typeof PatchTool>({
  name: "patch",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle icon="%" fallback="Preparing patch..." when={true}>
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

ToolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <box>
        <For each={props.input.todos ?? []}>
          {(todo) => (
            <text style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}>
              [{todo.status === "completed" ? "✓" : " "}] {todo.content}
            </text>
          )}
        </For>
      </box>
    )
  },
})

// Register cc_* (Anthropic-native) tools to use same renderers as standard tools
ToolRegistry.register({
  name: "cc_bash",
  container: "block",
  render: ToolRegistry.render("bash"),
})

ToolRegistry.register({
  name: "cc_read",
  container: "inline",
  render: ToolRegistry.render("read"),
})

ToolRegistry.register({
  name: "cc_write",
  container: "block",
  render: ToolRegistry.render("write"),
})

ToolRegistry.register({
  name: "cc_edit",
  container: "block",
  render: ToolRegistry.render("edit"),
})

ToolRegistry.register({
  name: "cc_list",
  container: "inline",
  render: ToolRegistry.render("list"),
})

ToolRegistry.register({
  name: "cc_glob",
  container: "inline",
  render: ToolRegistry.render("glob"),
})

ToolRegistry.register({
  name: "cc_grep",
  container: "inline",
  render: ToolRegistry.render("grep"),
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
