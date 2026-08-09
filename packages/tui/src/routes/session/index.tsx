import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  useContext,
} from "solid-js"
import path from "node:path"
import { EOL, tmpdir } from "node:os"
import { mkdir, writeFile } from "node:fs/promises"
import { useRoute, useRouteData } from "../../context/route"
import { createStore } from "solid-js/store"
import { useData } from "../../context/data"
import { SplitBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { Spinner, SPINNER_FRAMES } from "../../component/spinner"
import { PatchDiff } from "../../component/patch-diff"
import { ThemeContextProvider, useTheme, useThemes } from "../../context/theme"
import { BoxRenderable, ScrollBoxRenderable, addDefaultParsers, TextAttributes, RGBA } from "@opentui/core"
import { Prompt, type PromptRef } from "../../component/prompt"
import type {
  ModelInfo,
  SessionMessageInfo,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageUser,
  SessionInfo,
} from "@opencode-ai/client"
import { useLocal } from "../../context/local"
import { Locale } from "../../util/locale"
import { FilePath } from "../../ui/file-path"
import {
  canonicalToolName,
  finiteNumber,
  primitiveInputSummary,
  toolDisplayContent,
  toolDisplayMetadata,
  webSearchProviderLabel,
} from "../../util/tool-display"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useClient } from "../../context/client"
import { useEditorContext } from "../../context/editor"
import { openEditor } from "../../editor"
import { useDialog } from "../../ui/dialog"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { DialogMessage } from "./dialog-message"
import { DialogFork } from "./dialog-fork"
import { DialogTimeline } from "./dialog-timeline"
import { Sidebar } from "./sidebar"
import { Composer } from "./composer"
import { filetype } from "../../util/filetype"
import parsers from "../../parsers-config"
import { errorMessage } from "../../util/error"
import { useToast } from "../../ui/toast"
import stripAnsi from "strip-ansi"
import { usePromptRef } from "../../context/prompt"
import { sessionTabsFitVertically, SESSION_SIDEBAR_WIDTH } from "../../ui/layout"
import { projectedPromptInput } from "../../prompt/codec"
import { useEpilogue } from "../../context/epilogue"
import { normalizePath } from "../../util/path"
import { PermissionPrompt } from "./permission"
import { FormPrompt } from "./form"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { DialogExportResult } from "../../ui/dialog-export-result"
import { sessionEpilogue } from "../../util/presentation"
import { useConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { nextThinkingMode, reasoningSummary, type ThinkingMode } from "../../context/thinking"
import { getScrollAcceleration } from "../../util/scroll"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { Keymap, type KeymapCommand } from "../../context/keymap"
import { usePathFormatter } from "../../context/path-format"
import { useLocation } from "../../context/location"
import { PluginSlot } from "../../plugin/render"
import {
  cacheReuseDrop,
  createSessionRows,
  messageBoundaryIDs,
  resolvePart,
  type CacheUsage,
  type PartRef,
  type SessionRow,
} from "./rows"
import { switchLabel } from "../../util/model"
import { findMessageBoundary, messageNavigationSlack } from "./message-navigation"
import { stringWidth } from "../../util/string-width"
import { useArgs } from "../../context/args"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"
import { useSessionTabs } from "../../context/session-tabs"

addDefaultParsers(parsers.parsers)

// Exclude temporary bottom space when measuring the real transcript height.
const NAVIGATION_SLACK_ID = "session-navigation-slack"

// Tail-first transcript mounting: rows mounted with the session, then backfill cadence.
// The tail comfortably overfills a tall viewport; backfill drains a 200-message transcript
// in a few hundred milliseconds without a perceptible pause.
const TRANSCRIPT_TAIL_ROWS = 40
const TRANSCRIPT_BACKFILL_CHUNK = 60
const TRANSCRIPT_BACKFILL_DELAY = 120

const context = createContext<{
  width: number
  sessionID: string
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  markdownMode: () => "source" | "rendered"
  groupExploration: () => boolean
  diffWrapMode: () => "word" | "none"
  models: () => ModelInfo[]
  config: ReturnType<typeof useConfig>["data"]
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

export function Session() {
  const setEpilogue = useEpilogue()
  const clipboard = useClipboard()
  const writeExport = async (file: string, content: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const data = useData()
  const local = useLocal()
  const args = useArgs()
  const paths = useTuiPaths()
  const configState = useConfig()
  const config = configState.data
  const theme = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => data.session.get(route.sessionID))
  const messages = () => data.session.message.list(route.sessionID)
  const currentLocation = useLocation()
  const location = createMemo(() => session()?.location ?? currentLocation.ref)

  createEffect(() => currentLocation.set(location()))

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    setEpilogue(sessionEpilogue({ title, sessionID: session()?.id }))
  })
  onCleanup(() => setEpilogue())
  const descendantSessionIDs = createMemo(() => {
    if (session()?.parentID) return []
    return data.session.family(route.sessionID).filter((id) => id !== route.sessionID)
  })
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return [route.sessionID, ...descendantSessionIDs()].flatMap(
      (sessionID) => data.session.permission.list(sessionID) ?? [],
    )
  })
  const promptedPermissions = createMemo(() => (local.permission.mode === "auto" ? [] : permissions()))
  const forms = createMemo(() => {
    const global = data.session.form.list("global", location()) ?? []
    if (session()?.parentID) return global
    return [route.sessionID, ...descendantSessionIDs()]
      .flatMap((sessionID) => data.session.form.list(sessionID) ?? [])
      .concat(global)
  })
  const [composer, setComposer] = createStore({
    open: false,
    tab: undefined as string | undefined,
  })
  const disabled = createMemo(() => promptedPermissions().length > 0 || forms().length > 0)

  const pending = createMemo(() => {
    const completed = messages().findLast((x) => x.type === "assistant" && x.time.completed)?.id
    return messages().findLast((x) => x.type === "assistant" && !x.time.completed && (!completed || x.id > completed))
      ?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.type === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const sidebar = createMemo(() => config.session?.sidebar ?? "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const thinkingMode = createMemo<ThinkingMode>(() => config.session?.thinking ?? "hide")
  const showThinking = createMemo(() => true)
  const showScrollbar = createMemo(() => config.session?.scrollbar ?? false)
  const markdownMode = createMemo(() => config.session?.markdown ?? "rendered")
  const diffWrapMode = createMemo(() => config.diffs?.wrap ?? "word")
  const groupExploration = createMemo(() => config.session?.grouping !== "none")

  const availableWidth = createMemo(
    () =>
      dimensions().width -
      (config.tabs?.enabled && config.tabs.vertical && sessionTabsFitVertically(dimensions().width)
        ? SESSION_SIDEBAR_WIDTH
        : 0),
  )
  const wide = createMemo(() => availableWidth() > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const contentWidth = createMemo(() => availableWidth() - (sidebarVisible() ? 42 : 0) - 4)
  const models = createMemo(() => data.location.model.list(location()) ?? [])

  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  const toast = useToast()
  const client = useClient()
  const autoApproved = new Set<string>()
  createEffect(() => {
    if (local.permission.mode !== "auto") return
    permissions().forEach((request) => {
      if (autoApproved.has(request.id)) return
      autoApproved.add(request.id)
      void client.api.permission
        .reply({
          sessionID: request.sessionID,
          reply: "once",
          requestID: request.id,
        })
        .catch((error) => {
          autoApproved.delete(request.id)
          toast.error(error)
        })
    })
  })
  const editor = useEditorContext()
  const rows = createSessionRows(() => route.sessionID)
  const boundaries = createMemo(() => messageBoundaryIDs(rows, messages()))
  const [navigationMessage, setNavigationMessage] = createSignal<string>()
  const [navigationSlack, setNavigationSlack] = createSignal(0)
  const [synced, setSynced] = createSignal(false)
  const sessionTabs = useSessionTabs()

  const clearMessageNavigation = () => {
    setNavigationSlack(0)
    setNavigationMessage(undefined)
  }

  createEffect(
    on(
      () => [dimensions().width, dimensions().height] as const,
      (_, previous) => {
        if (previous) clearMessageNavigation()
      },
    ),
  )

  createEffect(
    on([descendantSessionIDs, () => client.connection.status()], ([sessionIDs, status]) => {
      if (status !== "connected") return
      void Promise.allSettled(
        sessionIDs.flatMap((sessionID) => [data.session.permission.sync(sessionID), data.session.form.sync(sessionID)]),
      )
    }),
  )

  createEffect(() => {
    if (client.connection.status() !== "connected") return
    setSynced(false)
    const sessionID = route.sessionID
    void (async () => {
      await Promise.all([
        data.session.sync(sessionID, { children: true }),
        data.session.permission.sync(sessionID).catch(() => undefined),
        data.session.form.sync(sessionID).catch(() => undefined),
      ])
      const info = data.session.get(sessionID)
      if (!info) {
        toast.show({
          message: `Session not found: ${sessionID}`,
          variant: "error",
          duration: 5000,
        })
        sessionTabs.enabled() ? sessionTabs.close(sessionID) : navigate({ type: "home" })
        return
      }
      editor.reconnect(info.location.directory)
      if (route.sessionID === sessionID && scroll) scroll.scrollBy(100_000)
      setSynced(true)
    })().catch((error) => {
      if (route.sessionID !== sessionID) return
      toast.show({
        message: errorMessage(error),
        variant: "error",
        duration: 5000,
      })
      sessionTabs.enabled() ? sessionTabs.close(sessionID) : navigate({ type: "home" })
    })
  })

  let seeded = false
  let sent = false
  let scroll: ScrollBoxRenderable
  const [prompt, setPrompt] = createSignal<PromptRef>()
  const bind = (r: PromptRef | undefined) => {
    setPrompt(r)
    promptRef.set(r)
    if (seeded || !route.prompt || !r) return
    seeded = true
    r.set(route.prompt)
  }

  /** Runs after layout has settled (two frames), unless the transcript was torn down. */
  const afterLayout = (continuation: () => void) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scroll || scroll.isDestroyed) return
        continuation()
      })
    })
  }

  // Tail-first transcript mounting: only the newest rows mount when the session opens, and the
  // rest backfill in chunks shortly after, so switching to a long session costs the visible tail
  // instead of the whole transcript. Until backfill pins the count, the hidden span derives from
  // the row count, so it needs no effect ordering; the clamp keeps at least a tail visible when a
  // re-reduce shrinks the transcript. Streaming appends land at the end of the visible slice.
  const [hiddenRows, setHiddenRows] = createSignal<number>()
  const hidden = createMemo(() => Math.max(0, Math.min(hiddenRows() ?? Infinity, rows.length - TRANSCRIPT_TAIL_ROWS)))
  const visibleRows = createMemo(() => (hidden() === 0 ? rows : rows.slice(hidden())))
  createEffect(() => {
    const current = hidden()
    if (current === 0) return
    // Until the first chunk pins hiddenRows, appends change hidden() and reset this timer, so
    // backfill waits for a pause in streaming before starting. Once pinned, it drains on a fixed
    // cadence undisturbed by appends.
    const timer = setTimeout(() => {
      const before = scroll && !scroll.isDestroyed ? scroll.scrollHeight : undefined
      const viewportBottom = before === undefined ? 0 : scroll.scrollTop + scroll.viewport.height
      setHiddenRows(Math.max(0, current - TRANSCRIPT_BACKFILL_CHUNK))
      if (before === undefined) return
      // Sticky scroll holds bottom-anchored readers through the mount; compensation is only for
      // readers who have scrolled up.
      if (viewportBottom >= before - 1) return
      afterLayout(() => scroll.scrollBy(scroll.scrollHeight - before))
    }, TRANSCRIPT_BACKFILL_DELAY)
    onCleanup(() => clearTimeout(timer))
  })
  /** Message navigation needs the full transcript mounted before walking or jumping. */
  const ensureAllRows = (continuation: () => void) => {
    if (hidden() === 0) return continuation()
    setHiddenRows(0)
    afterLayout(continuation)
  }

  createEffect(() => {
    const current = prompt()
    if (sent || !current || !synced() || !local.model.ready) return
    if (!local.agent.current() || !local.model.current()) return
    if (!args.prompt || route.prompt?.text !== args.prompt || current.current.text !== args.prompt) return
    sent = true
    current.submit()
  })
  const dialog = useDialog()
  const renderer = useRenderer()
  const unavailable = (feature: string) => {
    toast.show({ message: `${feature} is not implemented for V2 sessions yet`, variant: "error", duration: 5000 })
    dialog.clear()
  }

  const alignMessage = (messageID: string, top: number) => {
    scroll.stickyScroll = false
    setNavigationMessage(messageID)
    setNavigationSlack(
      messageNavigationSlack({
        top,
        viewportHeight: scroll.viewport.height,
        scrollHeight: scroll.scrollHeight,
        currentSlack: scroll.getRenderable(NAVIGATION_SLACK_ID)?.height ?? 0,
      }),
    )
    afterLayout(() => {
      if (navigationMessage() !== messageID) return
      scroll.scrollTo(top)
    })
  }

  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>, userOnly = false) =>
    ensureAllRows(() => {
      const target = findMessageBoundary({
        direction,
        children: scroll.getChildren(),
        messages: messages(),
        scrollTop: scroll.scrollTop,
        viewportY: scroll.viewport.y,
        currentID: navigationMessage(),
        userOnly,
      })

      if (target) alignMessage(target.id, target.top)
      dialog.clear()
    })

  const jumpToMessage = (messageID: string) =>
    ensureAllRows(() => {
      const child = scroll.getRenderable(messageID)
      if (!child) return
      const y = scroll.scrollTop + child.y - scroll.viewport.y
      const message = data.session.message.get(route.sessionID, messageID)
      alignMessage(messageID, Math.max(0, y - (message?.type === "assistant" ? 1 : 0)))
    })

  function toBottom() {
    clearMessageNavigation()
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const globalCommands = [
    {
      id: "session.page.up",
      title: "Page up",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      id: "session.page.down",
      title: "Page down",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      id: "session.line.up",
      title: "Line up",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      id: "session.line.down",
      title: "Line down",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      id: "session.half.page.up",
      title: "Half page up",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      id: "session.half.page.down",
      title: "Half page down",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
  ]

  const baseAndUnfocusedCommands = [
    {
      id: "session.first",
      title: "First message",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      id: "session.last",
      title: "Last message",
      group: "Session",
      palette: undefined,
      run: () => {
        clearMessageNavigation()
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
  ]

  const baseCommands = createMemo(() => [
    {
      title: "Share session",
      id: "session.share",
      suggested: route.type === "session",
      group: "Session",
      slash: { name: "share" },
      run: () => unavailable("Sharing"),
    },
    {
      title: "Rename session",
      id: "session.rename",
      group: "Session",
      slash: { name: "rename" },
      run: () => DialogSessionRename.show(dialog, route.sessionID, session()?.title),
    },
    {
      title: "Jump to message",
      id: "session.timeline",
      group: "Session",
      slash: { name: "timeline" },
      run: () => {
        dialog.replace(() => (
          <DialogTimeline
            sessionID={route.sessionID}
            onMove={jumpToMessage}
            setPrompt={(value) => promptRef.current?.set(value)}
          />
        ))
      },
    },
    {
      title: "Fork session",
      id: "session.fork",
      group: "Session",
      slash: { name: "fork" },
      run: () => {
        dialog.replace(() => (
          <DialogFork
            sessionID={route.sessionID}
            onMove={(messageID) => {
              if (!messageID) return
              jumpToMessage(messageID)
            }}
          />
        ))
      },
    },
    {
      title: "Compact session",
      id: "session.compact",
      group: "Session",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      run: () => {
        void client.api.session.compact({ sessionID: route.sessionID })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      id: "session.unshare",
      group: "Session",
      enabled: false,
      slash: { name: "unshare" },
      run: () => unavailable("Unsharing"),
    },
    {
      title: "Undo previous message",
      id: "session.undo",
      group: "Session",
      slash: { name: "undo" },
      run: () => {
        const boundary = session()?.revert?.messageID
        const message = messages().findLast(
          (message): message is SessionMessageUser =>
            message.type === "user" && !!message.text.trim() && (!boundary || message.id < boundary),
        )
        if (!message) {
          toast.show({ message: "Nothing to undo", variant: "error", duration: 3000 })
          dialog.clear()
          return
        }
        void client.api.session.revert
          .stage({ sessionID: route.sessionID, messageID: message.id })
          .catch((error) => toast.show({ message: errorMessage(error), variant: "error", duration: 5000 }))
        prompt()?.set({
          ...projectedPromptInput(message),
          pasted: [],
        })
        dialog.clear()
      },
    },
    {
      title: "Redo",
      id: "session.redo",
      group: "Session",
      enabled: !!session()?.revert?.messageID,
      slash: { name: "redo" },
      run: () => {
        void (async () => {
          const error = await client.api.session.revert.clear({ sessionID: route.sessionID }).then(
            () => undefined,
            (error) => error,
          )
          if (error) toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
          dialog.clear()
        })()
      },
    },
    {
      title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      id: "session.sidebar.toggle",
      group: "Session",
      run: () => {
        batch(() => {
          const isVisible = sidebarVisible()
          void configState
            .update((draft) => {
              draft.session = { ...draft.session, sidebar: isVisible ? "hide" : "auto" }
            })
            .catch(toast.error)
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      title: (() => {
        const next = nextThinkingMode(thinkingMode())
        if (next === "hide") return "Collapse thinking"
        return "Expand thinking"
      })(),
      id: "session.toggle.thinking",
      group: "Session",
      palette: undefined,
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      run: () => {
        void configState
          .update((draft) => {
            draft.session = { ...draft.session, thinking: nextThinkingMode(thinkingMode()) }
          })
          .catch(toast.error)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      id: "session.toggle.scrollbar",
      group: "Session",
      palette: undefined,
      run: () => {
        void configState
          .update((draft) => {
            draft.session = { ...draft.session, scrollbar: !showScrollbar() }
          })
          .catch(toast.error)
        dialog.clear()
      },
    },
    {
      title: groupExploration() ? "Show tool calls individually" : "Group related tool calls",
      id: "session.toggle.exploration_grouping",
      group: "Session",
      palette: undefined,
      run: () => {
        void configState
          .update((draft) => {
            draft.session = { ...draft.session, grouping: groupExploration() ? "none" : "auto" }
          })
          .catch(toast.error)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      id: "session.messages_last_user",
      group: "Session",
      palette: undefined,
      run: () => {
        const messages = data.session.message.list(route.sessionID)
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.type !== "user" || !message.text.trim()) continue
          {
            jumpToMessage(message.id)
            break
          }
        }
      },
    },
    {
      title: "Next message",
      id: "session.message.next",
      group: "Session",
      palette: undefined,
      run: () => scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      id: "session.message.previous",
      group: "Session",
      palette: undefined,
      run: () => scrollToMessage("prev", dialog),
    },
    {
      title: "Next user message",
      id: "session.message.user.next",
      group: "Session",
      palette: undefined,
      run: () => scrollToMessage("next", dialog, true),
    },
    {
      title: "Previous user message",
      id: "session.message.user.previous",
      group: "Session",
      palette: undefined,
      run: () => scrollToMessage("prev", dialog, true),
    },
    {
      title: "Copy last assistant message",
      id: "messages.copy",
      group: "Session",
      run: () => {
        const revertID = session()?.revert?.messageID
        const lastAssistantMessage = messages().findLast(
          (msg): msg is SessionMessageAssistant => msg.type === "assistant" && (!revertID || msg.id < revertID),
        )
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const textParts = lastAssistantMessage.content.filter((part) => part.type === "text")
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

        clipboard
          .write?.(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      id: "session.copy",
      group: "Session",
      slash: {
        name: "copy",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const transcript = formatSessionTranscript(sessionData, messages(), showThinking())
          await clipboard.write?.(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      id: "session.export",
      group: "Session",
      slash: {
        name: "export",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return

          const options = await DialogExportOptions.show(dialog, showThinking())

          if (options === null) return

          const content =
            options.format === "markdown"
              ? formatSessionTranscript(sessionData, messages(), options.thinking)
              : await (async () => {
                  const messages: unknown[] = []
                  let cursor: string | undefined
                  do {
                    const page = await client.api.message.list(
                      cursor
                        ? { sessionID: sessionData.id, limit: 200, cursor }
                        : { sessionID: sessionData.id, limit: 200, order: "asc" },
                    )
                    messages.push(...page.data)
                    cursor = page.data.length ? (page.cursor.next ?? undefined) : undefined
                  } while (cursor)
                  return JSON.stringify({ info: sessionData, messages }, null, 2) + EOL
                })()

          if (options.action === "copy") {
            await clipboard.write?.(content)
            dialog.clear()
            toast.show({ message: "Copied to clipboard", variant: "success" })
            return
          }

          const filepath = path.join(
            tmpdir(),
            `session-${crypto.randomUUID()}.${options.format === "markdown" ? "md" : "json"}`,
          )
          await writeExport(filepath, content)
          await DialogExportResult.show(dialog, filepath)
        } catch {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Background blocking tools",
      id: "session.background",
      group: "Session",
      palette: undefined,
      run: () => {
        void client.api.session.background({ sessionID: route.sessionID })
        dialog.clear()
      },
    },
    {
      title: "Toggle subagent picker",
      id: "session.child.first",
      group: "Session",
      run: () => {
        if (composer.open || session()?.parentID) setComposer("open", false)
        else setComposer("open", true)
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      id: "session.parent",
      group: "Session",
      palette: undefined,
      enabled: !!session()?.parentID,
      run: () => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
          })
        }
        dialog.clear()
      },
    },
  ])

  const commands = createMemo(() =>
    [...globalCommands, ...baseAndUnfocusedCommands, ...baseCommands()].map(
      (command) =>
        ({
          bind: false,
          palette: true as const,
          ...command,
        }) satisfies KeymapCommand,
    ),
  )

  Keymap.createLayer(() => ({
    mode: "global",
    commands: commands(),
    bindings: globalCommands.map((command) => command.id),
  }))

  Keymap.createLayer(() => ({
    enabled: () => renderer.currentFocusedEditor === null,
    bindings: baseAndUnfocusedCommands.map((command) => command.id),
  }))

  Keymap.createLayer(() => ({
    bindings: [...baseAndUnfocusedCommands, ...baseCommands()].map((command) => command.id),
  }))

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))
  createEffect(
    on(
      () => route.sessionID,
      () => {
        setComposer("open", false)
        clearMessageNavigation()
      },
    ),
  )

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        sessionID: route.sessionID,
        thinkingMode,
        showThinking,
        markdownMode,
        groupExploration,
        diffWrapMode,
        models,
        config,
      }}
    >
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <box
          flexGrow={1}
          minHeight={0}
          paddingBottom={1}
          paddingLeft={dimensions().width < 44 ? 1 : 2}
          paddingRight={dimensions().width < 44 ? 1 : 2}
          gap={1}
        >
          <Show when={session()}>
            <scrollbox
              ref={(r) => (scroll = r)}
              viewportOptions={{
                paddingRight: showScrollbar() ? 1 : 0,
              }}
              verticalScrollbarOptions={{
                paddingLeft: 1,
                visible: showScrollbar(),
                trackOptions: {
                  backgroundColor: theme.raise(theme.background.surface.offset),
                  foregroundColor: theme.border.default,
                },
              }}
              stickyScroll={!navigationMessage()}
              stickyStart="bottom"
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
            >
              <For each={visibleRows()}>
                {(row, index) => (
                  <SessionRowView
                    row={row}
                    message={(messageID) => data.session.message.get(route.sessionID, messageID)}
                    boundaryID={boundaries()[index() + hidden()]}
                  />
                )}
              </For>
              <BackgroundToolHint messages={messages()} />
              <Show when={session()?.revert?.messageID}>
                <RevertMessage
                  count={
                    messages().filter(
                      (message) => message.id >= session()!.revert!.messageID && message.type === "user",
                    ).length
                  }
                  files={session()!.revert!.files ?? []}
                />
              </Show>
              <Show when={navigationSlack()}>
                {(height) => <box id={NAVIGATION_SLACK_ID} height={height()} flexShrink={0} />}
              </Show>
            </scrollbox>
            <box flexShrink={0}>
              <PluginSlot name="session.composer.top" input={{ sessionID: route.sessionID }} mode="all" />
              <Composer
                sessionID={route.sessionID}
                open={composer.open || (!!session()?.parentID && forms().length === 0)}
                defaultTab={composer.tab ?? (session()?.parentID ? "subagents" : undefined)}
                onClose={() => setComposer("open", false)}
              />
              <Switch>
                <Match when={composer.open || (!!session()?.parentID && forms().length === 0)}>{null}</Match>
                <Match when={promptedPermissions().length > 0}>
                  <Show when={promptedPermissions()[0]?.id} keyed>
                    {(_) => {
                      const request = promptedPermissions()[0]
                      return request ? (
                        <PermissionPrompt request={request} directory={session()?.location.directory} />
                      ) : null
                    }}
                  </Show>
                </Match>
                <Match when={forms().length > 0}>
                  <Show when={forms()[0]?.id} keyed>
                    {(_) => {
                      const form = forms()[0]
                      return form ? <FormPrompt form={form} /> : null
                    }}
                  </Show>
                </Match>
                <Match when={!disabled()}>
                  <Prompt
                    visible={true}
                    ref={bind}
                    disabled={false}
                    onSubmit={() => {
                      toBottom()
                    }}
                    sessionID={route.sessionID}
                  />
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar sessionID={route.sessionID} />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-end"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <Sidebar sessionID={route.sessionID} />
              </box>
            </Match>
          </Switch>
        </Show>
      </box>
    </context.Provider>
  )
}

type SessionRowViewProps = {
  row: SessionRow
  message: (messageID: string) => SessionMessageInfo | undefined
  boundaryID?: string
}

function SessionRowView(props: SessionRowViewProps) {
  return (
    <box id={props.boundaryID} marginTop={1} flexShrink={0}>
      <Switch>
        <Match when={props.row.type === "message" ? props.row : undefined}>
          {(row) => (
            <Show when={props.message(row().messageID)}>{(message) => <SessionMessageView message={message()} />}</Show>
          )}
        </Match>
        <Match when={props.row.type === "compaction-queued"}>
          <CompactionQueued />
        </Match>
        <Match when={props.row.type === "part" ? props.row : undefined}>
          {(row) => <SessionPartView partRef={row().ref} message={props.message} />}
        </Match>
        <Match when={props.row.type === "group" && props.row.kind === "reasoning" ? props.row : undefined}>
          {(row) => <SessionReasoningGroupView refs={row().refs} completed={row().completed} message={props.message} />}
        </Match>
        <Match when={props.row.type === "group" && props.row.kind === "exploration" ? props.row : undefined}>
          {(row) => (
            <SessionGroupView
              refs={row().refs}
              pending={row().pending}
              completed={row().completed}
              message={props.message}
            />
          )}
        </Match>
        <Match when={props.row.type === "assistant-footer" ? props.row : undefined}>
          {(row) => (
            <Show when={props.message(row().messageID)}>
              {(message) => (
                <Show when={message().type === "assistant"}>
                  <AssistantFooter message={message() as SessionMessageAssistant} />
                </Show>
              )}
            </Show>
          )}
        </Match>
        <Match when={props.row.type === "turn-usage" ? props.row : undefined}>
          {(row) => (
            <TurnTokenUsage
              messageIDs={row().messageIDs}
              previousCache={row().previousCache}
              message={props.message}
            />
          )}
        </Match>
      </Switch>
    </box>
  )
}

function TurnTokenUsage(props: {
  messageIDs: string[]
  previousCache?: CacheUsage
  message: (messageID: string) => SessionMessageInfo | undefined
}) {
  const config = useConfig()
  const theme = useTheme()
  const verbose = () => config.data.debug?.turn_tokens === "verbose"
  const steps = createMemo(() => {
    let previousCache = props.previousCache
    return props.messageIDs.flatMap((messageID) => {
      const message = props.message(messageID)
      if (message?.type !== "assistant" || !message.tokens) return []
      const total =
        message.tokens.input +
        message.tokens.output +
        message.tokens.reasoning +
        message.tokens.cache.read +
        message.tokens.cache.write
      if (total === 0) return []
      const newTokens = total - message.tokens.cache.read
      const currentCache = { read: message.tokens.cache.read, model: message.model }
      const reuseDrop = cacheReuseDrop(previousCache, currentCache)
      previousCache = currentCache
      return [
        {
          finish: message.finish === "tool-calls" ? "tool-call" : (message.finish ?? "unknown"),
          tools: verbose() ? message.content.filter((part) => part.type === "tool") : [],
          newTokens,
          cached: message.tokens.cache.read,
          total,
          reuseDrop,
        },
      ]
    })
  })
  const columns = createMemo(() => ({
    step: Math.max("Step".length, ...steps().map((item) => item.finish.length)),
    newTokens: Math.max("New".length, ...steps().map((item) => item.newTokens.toLocaleString().length)),
    cached: Math.max("Cached".length, ...steps().map((item) => item.cached.toLocaleString().length)),
    total: Math.max("Total".length, ...steps().map((item) => item.total.toLocaleString().length)),
  }))
  return (
    <Show when={Boolean(config.data.debug?.turn_tokens) && steps().length > 0}>
      <box paddingLeft={3} flexDirection="column">
        <box flexDirection="row">
          <text width={INLINE_TOOL_ICON_WIDTH} fg={theme.text.subdued}>
            ◈
          </text>
          <text fg={theme.text.subdued} attributes={TextAttributes.BOLD}>
            Tokens
          </text>
        </box>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH}>
          <text fg={theme.text.subdued} attributes={TextAttributes.ITALIC}>
            {"Step".padEnd(columns().step + 2)}
            {"New".padStart(columns().newTokens)}
            {"  "}
            {"Cached".padStart(columns().cached)}
            {"  "}
            {"Total".padStart(columns().total)}
          </text>
        </box>
        <For each={steps()}>
          {(item) => (
            <box paddingLeft={INLINE_TOOL_ICON_WIDTH} flexDirection="column">
              <text fg={verbose() && item.finish === "tool-call" ? undefined : theme.text.subdued}>
                {item.finish.padEnd(columns().step + 2)}
                <span style={{ attributes: TextAttributes.BOLD }}>
                  {item.newTokens.toLocaleString().padStart(columns().newTokens)}
                </span>
                {"  "}
                {item.cached.toLocaleString().padStart(columns().cached)}
                {"  "}
                {item.total.toLocaleString().padStart(columns().total)}
              </text>
              <TurnTokenToolCalls tools={item.tools} />
              <Show when={item.reuseDrop !== undefined}>
                <text fg={theme.text.feedback.warning.default}>
                  ! Likely cache bust: {item.reuseDrop?.toLocaleString()} fewer cached tokens than the previous step
                </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

function TurnTokenToolCalls(props: { tools: SessionMessageAssistantTool[] }) {
  const theme = useTheme()
  const nameWidth = () => Math.max(0, ...props.tools.map((tool) => tool.name.length)) + 2
  return (
    <Show when={props.tools.length > 0}>
      <box paddingLeft={2} flexDirection="column">
        <For each={props.tools}>
          {(tool) => (
            <box flexDirection="row">
              <text
                width={nameWidth()}
                flexShrink={0}
                fg={theme.text.subdued}
                attributes={TextAttributes.BOLD}
              >
                {tool.name}
              </text>
              <text
                fg={theme.text.subdued}
                attributes={TextAttributes.DIM}
                wrapMode="word"
                flexGrow={1}
                minWidth={0}
              >
                {turnTokenToolSummary(tool)}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

function turnTokenToolSummary(tool: SessionMessageAssistantTool) {
  const data = tool.state.input
  if (typeof data === "string") return data
  const primaryKey = ["command", "id", "pattern", "url", "query", "path", "description", "code"].find(
    (key) => key in data,
  )
  const input = Object.entries(data).filter(([, value]) =>
    ["string", "number", "boolean"].includes(typeof value),
  )
  const primary = input.find(([key]) => key === primaryKey)?.[1]
  const details = input.filter(([key]) => key !== primaryKey).map(([key, value]) => `${key}: ${String(value)}`)
  return [primary === undefined ? "" : String(primary), ...details].filter(Boolean).join("  ")
}

function BackgroundToolHint(props: { messages: SessionMessageInfo[] }) {
  const theme = useTheme()
  const shortcut = Keymap.useShortcut("session.background")
  const visible = createMemo(() => {
    const current = props.messages.findLast(
      (message): message is SessionMessageAssistant => message.type === "assistant" && !message.time.completed,
    )
    return (
      current?.content.some((part) => {
        if (part.type !== "tool" || part.state.status !== "running") return false
        const display = toolDisplay(part.name)
        return display === "shell" || display === "subagent"
      }) ?? false
    )
  })
  return (
    <Show when={visible() && shortcut()}>
      {(value) => (
        <box marginTop={1} paddingLeft={3} flexShrink={0}>
          <text fg={theme.text.subdued}>
            Press <span style={{ fg: theme.text.default }}>{value()}</span> to move running work to the background
          </text>
        </box>
      )}
    </Show>
  )
}

function SessionMessageView(props: { message: SessionMessageInfo }) {
  return (
    <Switch>
      <Match when={props.message.type === "user"}>
        <UserMessage message={props.message as SessionMessageUser} />
      </Match>
      <Match when={props.message.type === "shell"}>
        <ShellMessage message={props.message as Extract<SessionMessageInfo, { type: "shell" }>} />
      </Match>
      <Match when={props.message.type === "agent-switched" || props.message.type === "model-switched"}>
        <SessionSwitchMessageV2 message={props.message} />
      </Match>
      <Match
        when={props.message.type === "system" || props.message.type === "synthetic" || props.message.type === "skill"}
      >
        <Show when={props.message.type === "skill"} fallback={<SessionNoticeMessageV2 message={props.message} />}>
          <SessionSkillMessage message={props.message as Extract<SessionMessageInfo, { type: "skill" }>} />
        </Show>
      </Match>
      <Match when={props.message.type === "compaction"}>
        <CompactionMessage message={props.message as Extract<SessionMessageInfo, { type: "compaction" }>} />
      </Match>
    </Switch>
  )
}

function SessionPartView(props: { partRef: PartRef; message: (messageID: string) => SessionMessageInfo | undefined }) {
  const message = createMemo(() => props.message(props.partRef.messageID))
  const part = createMemo(() => {
    const item = message()
    if (item?.type !== "assistant") return
    return resolvePart(item, props.partRef.partID)
  })
  return (
    <Show when={part()}>
      {(item) => (
        <Switch>
          <Match when={item().type === "text"}>
            <TextPart part={item() as SessionMessageAssistantText} last={false} />
          </Match>
          <Match when={item().type === "reasoning"}>
            <ReasoningPart
              part={item() as SessionMessageAssistantReasoning}
              message={message() as SessionMessageAssistant}
              last={false}
            />
          </Match>
          <Match when={item().type === "tool"}>
            <ToolPart part={item() as SessionMessageAssistantTool} />
          </Match>
        </Switch>
      )}
    </Show>
  )
}

function SessionReasoningGroupView(props: {
  refs: PartRef[]
  completed: boolean
  message: (messageID: string) => SessionMessageInfo | undefined
}) {
  const ctx = use()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const renderer = useRenderer()
  const [expanded, setExpanded] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const parts = createMemo(() =>
    props.refs.flatMap((ref) => {
      const message = props.message(ref.messageID)
      if (message?.type !== "assistant") return []
      const part = resolvePart(message, ref.partID)
      if (part?.type !== "reasoning" || !reasoningContent(part)) return []
      return [{ message, part }]
    }),
  )
  const latest = createMemo((previous: string | null) => {
    const item = parts().at(-1)
    if (!item) return previous
    const title = reasoningSummary(reasoningContent(item.part)).title
    if (title) return title
    if (item.part.time?.completed !== undefined || item.message.time.completed !== undefined) return null
    return previous
  }, null)
  const duration = createMemo(() =>
    parts().reduce((total, item) => {
      const start = item.part.time?.created
      const end = item.part.time?.completed
      return total + (start === undefined || end === undefined ? 0 : Math.max(0, end - start))
    }, 0),
  )

  return (
    <Show when={parts().length > 0}>
      <Show
        when={ctx.thinkingMode() === "hide"}
        fallback={<For each={props.refs}>{(ref) => <SessionPartView partRef={ref} message={props.message} />}</For>}
      >
        <box flexDirection="column" flexShrink={0}>
          <InlineToolRow
            icon={expanded() ? "-" : "+"}
            color={
              !props.completed
                ? theme.text.default
                : hover() || expanded()
                  ? theme.text.feedback.warning.default
                  : RGBA.fromValues(
                      theme.text.feedback.warning.default.r,
                      theme.text.feedback.warning.default.g,
                      theme.text.feedback.warning.default.b,
                      0.6,
                    )
            }
            complete={props.completed}
            pending={latest() ? `Thinking: ${latest()}` : "Thinking"}
            spinner={!props.completed}
            onMouseOver={() => setHover(true)}
            onMouseOut={() => setHover(false)}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              setExpanded((value) => !value)
            }}
          >
            {props.completed ? "Thought" : latest() ? `Thinking: ${latest()}` : "Thinking"}
            <Show when={props.completed && !expanded() && latest()}>: {latest()}</Show>
            <Show when={props.completed && parts().length > 1}> · {parts().length} steps</Show>
            <Show when={props.completed && duration()}> · {Locale.duration(duration())}</Show>
          </InlineToolRow>
          <Show when={expanded()}>
            <box paddingLeft={3}>
              <For each={props.refs}>
                {(ref) => {
                  const message = createMemo(() => {
                    const item = props.message(ref.messageID)
                    return item?.type === "assistant" ? item : undefined
                  })
                  const part = createMemo(() => {
                    const item = message()
                    if (!item) return undefined
                    const part = resolvePart(item, ref.partID)
                    return part?.type === "reasoning" ? part : undefined
                  })
                  const content = createMemo(() => {
                    const item = part()
                    return item ? reasoningContent(item) : ""
                  })
                  return (
                    <Show when={content()}>
                      <box marginTop={1}>
                        <box
                          border={["left"]}
                          customBorderChars={SplitBorder.customBorderChars}
                          borderColor={theme.raise(theme.background.surface.offset)}
                          paddingLeft={1}
                        >
                          <code
                            filetype="markdown"
                            drawUnstyledText={false}
                            streaming={part()?.time?.completed === undefined && message()?.time.completed === undefined}
                            syntaxStyle={syntax()}
                            content={content()}
                            conceal={ctx.markdownMode() === "rendered"}
                            fg={theme.text.subdued}
                          />
                        </box>
                      </box>
                    </Show>
                  )
                }}
              </For>
            </box>
          </Show>
        </box>
      </Show>
    </Show>
  )
}

function SessionGroupView(props: {
  refs: PartRef[]
  pending: PartRef[]
  completed: boolean
  message: (messageID: string) => SessionMessageInfo | undefined
}) {
  const theme = useTheme()
  const ctx = use()
  const renderer = useRenderer()
  const [expanded, setExpanded] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const parts = (refs: PartRef[]) =>
    refs.flatMap((ref) => {
      const message = props.message(ref.messageID)
      if (message?.type !== "assistant") return []
      const part = resolvePart(message, ref.partID)
      if (part?.type !== "tool") return []
      return [part]
    })
  const grouped = createMemo(() => parts(props.refs))
  const pending = createMemo(() => parts(props.pending))
  const label = createMemo(() => {
    const counts = grouped().reduce<Record<string, number>>((result, part) => {
      const tool = toolDisplay(part.name)
      const name = tool === "grep" || tool === "glob" ? "search" : tool
      result[name] = (result[name] ?? 0) + 1
      return result
    }, {})
    const tools = Object.entries(counts).map(
      ([name, count]) => `${count} ${count === 1 ? name : name === "search" ? "searches" : `${name}s`}`,
    )
    return `${props.completed ? "Explored" : "Exploring"} — ${tools.join(", ")}`
  })
  return (
    <Show when={grouped().length > 0 || pending().length > 0}>
      <Show
        when={ctx.groupExploration()}
        fallback={<For each={[...grouped(), ...pending()]}>{(part) => <ToolPart part={part} />}</For>}
      >
        <Show when={grouped().length > 0}>
          <InlineToolRow
            icon={props.completed ? "→" : "✱"}
            color={hover() ? theme.text.default : theme.text.subdued}
            complete={props.completed}
            pending={label()}
            spinner={!props.completed}
            onMouseOver={() => setHover(true)}
            onMouseOut={() => setHover(false)}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              setExpanded((value) => !value)
            }}
          >
            {label()}
          </InlineToolRow>
        </Show>
        <Show when={expanded() && grouped().length > 0}>
          <For each={grouped()}>{(part) => <ToolPart part={part} />}</For>
        </Show>
        <For each={pending()}>{(part) => <ToolPart part={part} />}</For>
      </Show>
    </Show>
  )
}

function AssistantFooter(props: { message: SessionMessageAssistant }) {
  const ctx = use()
  const local = useLocal()
  const dimensions = useTerminalDimensions()
  const theme = useTheme("elevated")
  const model = createMemo(
    () =>
      ctx
        .models()
        .find((model) => model.providerID === props.message.model.providerID && model.id === props.message.model.id)
        ?.name ?? `${props.message.model.providerID}/${props.message.model.id}`,
  )
  const duration = createMemo(() =>
    props.message.time.completed ? props.message.time.completed - props.message.time.created : 0,
  )
  const interrupted = createMemo(() => props.message.error?.message === "Step interrupted")
  return (
    <>
      <Show when={props.message.error && !interrupted()}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={theme.background.default}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.text.feedback.error.default}
        >
          <text fg={theme.text.subdued}>{errorMessage(props.message.error)}</text>
        </box>
      </Show>
      <AssistantRetry retry={props.message.retry} />
      <box paddingLeft={3} marginTop={props.message.error && !interrupted() ? 1 : 0}>
        <text>
          <span style={{ fg: props.message.error ? theme.text.subdued : local.agent.color(props.message.agent) }}>
            {Locale.titlecase(props.message.agent)}
          </span>
          <Show when={dimensions().width >= 28}>
            <span style={{ fg: theme.text.subdued }}> · {model()}</span>
          </Show>
          <Show when={duration() && (dimensions().width < 28 || dimensions().width >= 36)}>
            <span style={{ fg: theme.text.subdued }}> · {Locale.duration(duration())}</span>
          </Show>
          <Show when={interrupted()}>
            <span style={{ fg: theme.text.subdued }}> · interrupted</span>
          </Show>
        </text>
      </box>
    </>
  )
}

function SessionSwitchMessageV2(props: { message: SessionMessageInfo }) {
  const ctx = use()
  const theme = useTheme()
  const text = () => {
    if (props.message.type === "agent-switched") return `Switched agent to ${props.message.agent}`
    if (props.message.type === "model-switched")
      return switchLabel(props.message.model, ctx.models(), props.message.previous)
    return ""
  }
  return (
    <box paddingLeft={3}>
      <text fg={theme.text.subdued}>{text()}</text>
    </box>
  )
}

function SessionNoticeMessageV2(props: { message: SessionMessageInfo }) {
  const ctx = use()
  const theme = useTheme()
  const metadata = () => (props.message.type === "synthetic" ? props.message.metadata : undefined)
  const source = () => stringValue(metadata()?.source)
  const completion = () => source() === "subagent" || source() === "shell"
  const state = () => stringValue(metadata()?.state)
  const actor = () => (source() === "shell" ? "Shell" : Locale.titlecase(stringValue(metadata()?.agent) ?? "Subagent"))
  const text = () => {
    if (props.message.type === "system") return props.message.text
    if (props.message.type === "synthetic") return props.message.description ?? ""
    return ""
  }
  const description = () => (source() === "shell" ? text().replace(/\s+/g, " ").trim() : text())
  const status = () => {
    if (state() === "completed") return "finished"
    if (state() === "error") return "failed"
    return state() ?? "finished"
  }
  const heading = () => `${state() === "completed" ? "↳" : "!"} ${actor()} ${status()}`
  const suffix = () => Locale.truncateWidth(` · ${description()}`, Math.max(0, ctx.width - 3 - stringWidth(heading())))
  const color = () => {
    if (state() === "error") return theme.text.feedback.error.default
    if (state() === "cancelled") return theme.text.feedback.warning.default
    return theme.text.feedback.info.default
  }
  return (
    <Show
      when={completion()}
      fallback={
        <InlineToolRow icon="◈" color={theme.text.subdued} pending="Notice" complete={true}>
          {text()}
        </InlineToolRow>
      }
    >
      <box marginLeft={3}>
        <text wrapMode="none">
          <span style={{ fg: color() }}>{heading()}</span>
          <span style={{ fg: theme.text.subdued }}>{suffix()}</span>
        </text>
      </box>
    </Show>
  )
}

function SessionSkillMessage(props: { message: Extract<SessionMessageInfo, { type: "skill" }> }) {
  const theme = useTheme()
  return (
    <InlineToolRow icon="→" color={theme.text.subdued} pending="Skill" complete={true}>
      Skill {props.message.name}
    </InlineToolRow>
  )
}

function CompactionMessage(props: { message: Extract<SessionMessageInfo, { type: "compaction" }> }) {
  const ctx = use()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const status = () => props.message.status
  const cancelled = () => props.message.status === "failed" && props.message.error.type === "aborted"
  const text = () =>
    props.message.status === "failed" ? (cancelled() ? "" : props.message.error.message) : props.message.summary
  const content = createMemo(() => text().trim())
  const color = () =>
    status() === "failed" && !cancelled() ? theme.text.feedback.error.default : theme.text.subdued
  return (
    <box>
      <box flexDirection="row" alignItems="center">
        <box border={["top"]} borderColor={color()} flexGrow={1} />
        <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
          <Switch>
            <Match when={status() === "running"}>
              <Show when={ctx.config.animations ?? true} fallback={<text fg={color()}>⋯</text>}>
                <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
              </Show>
            </Match>
            <Match when={status() === "failed" && !cancelled()}>
              <text fg={color()}>✗</text>
            </Match>
          </Switch>
          <text fg={color()}>Compaction</text>
          <Show when={cancelled()}>
            <text fg={color()}>· cancelled</text>
          </Show>
        </box>
        <box border={["top"]} borderColor={color()} flexGrow={1} />
      </box>
      <Show when={content()}>
        <box paddingTop={1} paddingLeft={3}>
          <markdown
            syntaxStyle={syntax()}
            streaming={true}
            internalBlockMode="top-level"
            content={content()}
            tableOptions={{ style: "grid" }}
            conceal={ctx.markdownMode() === "rendered"}
            fg={theme.markdown.text}
            bg={theme.background.default}
          />
        </box>
      </Show>
    </box>
  )
}

function CompactionQueued() {
  const theme = useTheme()
  return (
    <box flexDirection="row" alignItems="center">
      <box border={["top"]} borderColor={theme.border.default} flexGrow={1} />
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.text.subdued}>◇</text>
        <text fg={theme.text.subdued}>Compaction queued</text>
      </box>
      <box border={["top"]} borderColor={theme.border.default} flexGrow={1} />
    </box>
  )
}

function statusLabel(status: "added" | "modified" | "deleted") {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}

function RevertMessage(props: {
  count: number
  files: ReadonlyArray<{
    readonly file: string
    readonly status: "added" | "modified" | "deleted"
    readonly additions: number
    readonly deletions: number
  }>
}) {
  const ctx = use()
  const theme = useTheme("elevated")
  const route = useRouteData("session")
  const client = useClient()
  const toast = useToast()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const redoKey = Keymap.useShortcut("session.redo")
  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        void (async () => {
          const error = await client.api.session.revert.clear({ sessionID: route.sessionID }).then(
            () => undefined,
            (error) => error,
          )
          if (error) toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
        })()
      }}
      flexShrink={0}
      marginTop={1}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background.default}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.raise(theme.background.default) : theme.background.default}
      >
        <text fg={theme.text.subdued}>
          {props.count} message{props.count === 1 ? "" : "s"} reverted
        </text>
        <Show when={props.files.length > 0}>
          <box paddingTop={1} paddingBottom={1} flexDirection="column">
            <For each={props.files}>
              {(file) => (
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <text fg={theme.text.subdued}>{statusLabel(file.status)}</text>
                  <FilePath
                    value={file.file}
                    maxWidth={Math.max(
                      2,
                      ctx.width -
                        5 -
                        (file.additions > 0 ? stringWidth(`+${file.additions}`) + 1 : 0) -
                        (file.deletions > 0 ? stringWidth(`-${file.deletions}`) + 1 : 0),
                    )}
                    fg={theme.text.default}
                  />
                  <Show when={file.additions > 0}>
                    <text fg={theme.diff.text.added}>+{file.additions}</text>
                  </Show>
                  <Show when={file.deletions > 0}>
                    <text fg={theme.diff.text.removed}>-{file.deletions}</text>
                  </Show>
                </box>
              )}
            </For>
          </box>
        </Show>
        <text fg={theme.text.subdued}>
          <span style={{ fg: theme.text.default }}>{redoKey()}</span> or /redo to restore
        </text>
      </box>
    </box>
  )
}

function ShellMessage(props: { message: Extract<SessionMessageInfo, { type: "shell" }> }) {
  const theme = useTheme("elevated")
  const output = createMemo(() => stripAnsi(props.message.output?.output.trim() ?? ""))

  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      gap={1}
      backgroundColor={theme.background.default}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background.default}
    >
      <text fg={theme.text.default}>$ {props.message.command}</text>
      <Show when={output()}>
        <text fg={theme.text.subdued}>{output()}</text>
      </Show>
    </box>
  )
}

function UserMessage(props: { message: SessionMessageUser }) {
  const ctx = use()
  const data = useData()
  const local = useLocal()
  const files = createMemo(() => props.message.files ?? [])
  const themes = useThemes()
  const theme = useTheme("elevated")
  const mode = themes.mode
  const [hover, setHover] = createSignal(false)
  const color = createMemo(() => local.agent.color(data.session.get(ctx.sessionID)?.agent ?? "build"))
  const queued = createMemo(
    () => data.session.status(ctx.sessionID) === "running" && data.session.input.has(ctx.sessionID, props.message.id),
  )
  const dialog = useDialog()
  const renderer = useRenderer()
  const promptRef = usePromptRef()

  return (
    <Show when={props.message.text.trim() || files().length}>
      <box
        border={["left"]}
        borderColor={queued() ? theme.border.default : color()}
        customBorderChars={SplitBorder.customBorderChars}
      >
        <box
          onMouseOver={() => {
            setHover(true)
          }}
          onMouseOut={() => {
            setHover(false)
          }}
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            dialog.replace(() => (
              <DialogMessage
                messageID={props.message.id}
                sessionID={ctx.sessionID}
                setPrompt={(value) => promptRef.current?.set(value)}
              />
            ))
          }}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={hover() ? theme.raise(theme.background.default) : theme.background.default}
          flexShrink={0}
        >
          <text fg={theme.text.default}>{props.message.text}</text>
          <Show when={files().length}>
            <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
              <For each={files()}>
                {(file) => {
                  const label = file.mime === "application/x-directory" ? "dir" : "file"
                  return (
                    <text fg={theme.text.default}>
                      <span
                        style={{
                          bg: theme.hue.accent[mode() === "light" ? 700 : 200],
                          fg: theme.background.default,
                          bold: true,
                        }}
                      >
                        {` ${label} `}
                      </span>
                      <span style={{ bg: theme.raise(theme.background.default), fg: theme.text.subdued }}>
                        {" "}
                        {file.name ?? (file.source.type === "uri" ? file.source.uri : "attachment")}{" "}
                      </span>
                    </text>
                  )
                }}
              </For>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  )
}

function AssistantRetry(props: { retry: SessionMessageAssistant["retry"] }) {
  const theme = useTheme()
  return (
    <Show when={props.retry}>
      {(retry) => (
        <box paddingLeft={3} marginTop={1}>
          <text fg={theme.text.subdued}>
            Retry attempt {retry().attempt} scheduled: {retry().error.message} [{retry().error.type}]
          </text>
        </box>
      )}
    </Show>
  )
}

const INLINE_TOOL_ICON_WIDTH = 2

function ReasoningPart(props: {
  last: boolean
  part: SessionMessageAssistantReasoning
  message: SessionMessageAssistant
}) {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const ctx = use()
  // Collapsed by default in hide mode: a single line throughout, so the
  // layout never shifts. Click to open the full markdown block, click to close.
  const [expanded, setExpanded] = createSignal(false)

  const content = createMemo(() => reasoningContent(props.part))
  const isDone = createMemo(
    () => props.part.time?.completed !== undefined || props.message.time.completed !== undefined,
  )
  const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
  const duration = createMemo(() => {
    const end = props.part.time?.completed ?? props.message.time.completed
    const start = props.part.time?.created ?? props.message.time.created
    return end === undefined ? 0 : Math.max(0, end - start)
  })
  const summary = createMemo(() => reasoningSummary(content()))
  const toggle = () => {
    if (!inMinimal()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content()}>
      <box paddingLeft={3} flexDirection="column" flexShrink={0}>
        <box
          border={!inMinimal() || expanded() ? ["left"] : undefined}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.raise(theme.background.default)}
          paddingLeft={!inMinimal() || expanded() ? 1 : 0}
        >
          <box onMouseUp={toggle}>
            <ReasoningHeader
              toggleable={inMinimal()}
              open={!inMinimal() || expanded()}
              done={isDone()}
              title={inMinimal() && !expanded() ? summary().title : null}
              duration={isDone() ? Locale.duration(duration()) : undefined}
            />
          </box>
        </box>
        <Show when={!inMinimal() || expanded()}>
          <box marginTop={1}>
            <box
              border={["left"]}
              customBorderChars={SplitBorder.customBorderChars}
              borderColor={theme.raise(theme.background.default)}
              paddingLeft={inMinimal() ? 3 : 1}
            >
              <code
                filetype="markdown"
                drawUnstyledText={false}
                streaming={true}
                syntaxStyle={syntax()}
                content={content()}
                conceal={ctx.markdownMode() === "rendered"}
                fg={theme.text.subdued}
              />
            </box>
          </box>
        </Show>
      </box>
    </Show>
  )
}

function reasoningContent(part: SessionMessageAssistantReasoning) {
  // OpenRouter encrypts some reasoning blocks; drop the placeholder.
  return part.text.replace("[REDACTED]", "").trim()
}

function ReasoningHeader(props: {
  toggleable: boolean
  open: boolean
  done: boolean
  title: string | null
  duration?: string
}) {
  const theme = useTheme()
  const fg = () =>
    props.open
      ? RGBA.fromValues(
          theme.text.feedback.warning.default.r,
          theme.text.feedback.warning.default.g,
          theme.text.feedback.warning.default.b,
          0.6,
        )
      : theme.text.feedback.warning.default

  return (
    <Switch>
      <Match when={!props.done}>
        <box flexDirection="row">
          <Spinner color={fg()}>{props.title ? "Thinking: " + props.title : "Thinking"}</Spinner>
        </box>
      </Match>
      <Match when={true}>
        <text fg={fg()} wrapMode="none">
          <Show when={props.toggleable}>
            <span>{props.open ? "- " : "+ "}</span>
          </Show>
          <span>Thought</span>
          <Show when={props.title || props.duration}>
            <span>: </span>
          </Show>
          <Show when={props.title}>
            <span>{props.title}</span>
          </Show>
          <Show when={props.duration}>
            <span>
              {props.title ? " · " : ""}
              {props.duration}
            </span>
          </Show>
        </text>
      </Match>
    </Switch>
  )
}

function TextPart(props: { last: boolean; part: SessionMessageAssistantText }) {
  const ctx = use()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  return (
    <Show when={props.part.text.trim()}>
      <box paddingLeft={3} flexShrink={0}>
        <markdown
          syntaxStyle={syntax()}
          streaming={true}
          internalBlockMode="top-level"
          content={props.part.text.trim()}
          tableOptions={{ style: "grid" }}
          conceal={ctx.markdownMode() === "rendered"}
          fg={theme.markdown.text}
          bg={theme.background.default}
        />
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { part: SessionMessageAssistantTool }) {
  const display = createMemo(() => toolDisplay(props.part.name))

  const toolprops = {
    get metadata() {
      return toolDisplayMetadata(props.part.state)
    },
    get input() {
      return typeof props.part.state.input === "string" ? {} : props.part.state.input
    },
    get output() {
      if (props.part.state.status === "streaming") return undefined
      return toolDisplayContent(props.part.state)
        .flatMap((content) => (content.type === "text" ? [content.text] : [content.name ?? content.uri]))
        .join("\n")
    },
    get tool() {
      return props.part.name
    },
    get part() {
      return props.part
    },
  }

  return (
    <Switch>
      <Match when={display() === "shell"}>
        <Shell {...toolprops} />
      </Match>
      <Match when={display() === "glob"}>
        <Glob {...toolprops} />
      </Match>
      <Match when={display() === "read"}>
        <Read {...toolprops} />
      </Match>
      <Match when={display() === "grep"}>
        <Grep {...toolprops} />
      </Match>
      <Match when={display() === "webfetch"}>
        <WebFetch {...toolprops} />
      </Match>
      <Match when={display() === "websearch"}>
        <WebSearch {...toolprops} />
      </Match>
      <Match when={display() === "write"}>
        <Write {...toolprops} />
      </Match>
      <Match when={display() === "edit"}>
        <Edit {...toolprops} />
      </Match>
      <Match when={display() === "subagent"}>
        <Subagent {...toolprops} />
      </Match>
      <Match when={display() === "execute"}>
        <Execute {...toolprops} />
      </Match>
      <Match when={display() === "patch"}>
        <ApplyPatch {...toolprops} />
      </Match>
      <Match when={display() === "question"}>
        <Question {...toolprops} />
      </Match>
      <Match when={display() === "skill"}>
        <Skill {...toolprops} />
      </Match>
      <Match when={true}>
        <GenericTool {...toolprops} />
      </Match>
    </Switch>
  )
}

type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  output?: string
  part: SessionMessageAssistantTool
}
function GenericTool(props: ToolProps) {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const output = createMemo(() => props.output?.trim() ?? "")
  const args = createMemo(() => JSON.stringify(props.input, null, 2))
  const [expanded, setExpanded] = createSignal(false)
  const expandable = createMemo(() => Object.keys(props.input).length > 0 || output().length > 0)

  return (
    <BlockTool
      title={`◆ ${props.tool}`}
      part={props.part}
      spinner={props.part.state.status === "streaming" || props.part.state.status === "running"}
      onClick={expandable() ? () => setExpanded((value) => !value) : undefined}
    >
      <Show when={expanded()}>
        <box gap={1} paddingTop={1}>
          <Show when={Object.keys(props.input).length > 0}>
            <box gap={1}>
              <text>
                <span style={{ bg: theme.raise(theme.background.default), fg: theme.text.subdued }}> Input </span>
              </text>
              <box paddingLeft={1}>
                <code
                  content={args()}
                  filetype="json"
                  syntaxStyle={syntax()}
                  conceal={false}
                  drawUnstyledText={false}
                  fg={theme.text.default}
                />
              </box>
            </box>
          </Show>
          <Show when={output()}>
            {(value) => (
              <box gap={1}>
                <text>
                  <span style={{ bg: theme.raise(theme.background.default), fg: theme.text.subdued }}>
                    {" "}
                    Output{" "}
                  </span>
                </text>
                <box paddingLeft={1}>
                  <text fg={theme.text.default} wrapMode="word">
                    {value()}
                  </text>
                </box>
              </box>
            )}
          </Show>
        </box>
      </Show>
    </BlockTool>
  )
}

function useToolPermission(part: () => SessionMessageAssistantTool | undefined) {
  const ctx = use()
  const data = useData()
  const local = useLocal()
  return createMemo(() => {
    if (local.permission.mode === "auto") return false
    const request = data.session.permission.list(ctx.sessionID)?.[0]
    return request?.source?.type === "tool" && request.source.id === part()?.id
  })
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  status?: JSX.Element
  children: JSX.Element
  part: SessionMessageAssistantTool
  onClick?: () => void
}) {
  const theme = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const [errorExpanded, setErrorExpanded] = createSignal(false)
  const permission = useToolPermission(() => props.part)

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error.message : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("QuestionRejectedError") ||
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  const failed = createMemo(() => Boolean(error() && !denied()))
  const clickable = createMemo(() => Boolean(props.onClick || failed()))
  const fg = createMemo(() => {
    if (props.color) return props.color
    if (permission()) return theme.text.feedback.warning.default
    if (failed()) return theme.text.feedback.error.default
    if (hover() && props.onClick) return theme.text.default
    return theme.text.subdued
  })

  return (
    <InlineToolRow
      icon={props.icon}
      iconColor={props.iconColor}
      color={fg()}
      errorColor={theme.text.feedback.error.default}
      failed={failed()}
      denied={Boolean(denied())}
      error={error()}
      errorExpanded={errorExpanded()}
      complete={props.complete}
      pending={props.pending}
      failure={props.failure}
      spinner={props.spinner}
      status={props.status}
      onMouseOver={() => clickable() && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (failed()) {
          setErrorExpanded((value) => !value)
          return
        }
        props.onClick?.()
      }}
    >
      {props.children}
    </InlineToolRow>
  )
}

export function InlineToolRow(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  errorColor?: RGBA
  failed?: boolean
  denied?: boolean
  error?: string
  errorExpanded?: boolean
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  status?: JSX.Element
  children: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: () => void
}) {
  return (
    <box paddingLeft={3} onMouseOver={props.onMouseOver} onMouseOut={props.onMouseOut} onMouseUp={props.onMouseUp}>
      <Switch>
        <Match when={props.spinner}>
          <Show when={props.status} fallback={<Spinner color={props.color} children={props.children} />}>
            {(status) => (
              <box flexDirection="row" gap={1}>
                <Spinner color={props.color} />
                <InlineToolLabel color={props.color} status={status()}>
                  {props.children}
                </InlineToolLabel>
              </box>
            )}
          </Show>
        </Match>
        <Match when={true}>
          <Show fallback={<Spinner color={props.color}>{props.pending}</Spinner>} when={props.complete || props.failed}>
            <box flexDirection="row">
              <text
                width={INLINE_TOOL_ICON_WIDTH}
                fg={props.failed ? props.errorColor : (props.iconColor ?? props.color)}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {props.icon}
              </text>
              <Show
                when={props.status}
                fallback={
                  <text
                    flexGrow={1}
                    fg={props.failed ? props.errorColor : props.color}
                    attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
                  >
                    {props.failed && !props.complete ? (props.failure ?? props.children) : props.children}
                  </text>
                }
              >
                {(status) => (
                  <InlineToolLabel
                    color={props.failed ? props.errorColor : props.color}
                    denied={props.denied}
                    status={status()}
                  >
                    {props.failed && !props.complete ? (props.failure ?? props.children) : props.children}
                  </InlineToolLabel>
                )}
              </Show>
            </box>
          </Show>
        </Match>
      </Switch>
      <Show when={props.failed && props.errorExpanded}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH}>
          <text fg={props.errorColor}>{props.error}</text>
        </box>
      </Show>
    </box>
  )
}

function InlineToolLabel(props: { color?: RGBA; denied?: boolean; status: JSX.Element; children: JSX.Element }) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={1} flexGrow={1}>
      <text
        maxWidth="100%"
        flexShrink={0}
        fg={props.color}
        attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
      >
        {props.children}
      </text>
      {props.status}
    </box>
  )
}

function StatusBadge(props: { children: string }) {
  const theme = useTheme()
  return (
    <text flexShrink={0} bg={theme.raise(theme.background.default)} fg={theme.text.subdued}>
      {" "}
      {props.children}{" "}
    </text>
  )
}

type BlockToolProps = {
  title?: string
  path?: { label: string; value: string }
  children?: JSX.Element
  onClick?: () => void
  part?: SessionMessageAssistantTool
  spinner?: boolean
}

function BlockTool(props: BlockToolProps) {
  const parentTheme = useTheme()
  return (
    <ThemeContextProvider context="elevated">
      <BlockToolContent {...props} borderColor={parentTheme.background.default} />
    </ThemeContextProvider>
  )
}

function BlockToolContent(props: BlockToolProps & { borderColor: RGBA }) {
  const theme = useTheme()
  const ctx = use()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error.message : undefined))
  const permission = useToolPermission(() => props.part)
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      gap={1}
      backgroundColor={hover() ? theme.raise(theme.background.default) : theme.background.default}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={props.borderColor}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show
        when={props.path}
        fallback={
          <Show when={props.title}>
            {(title) => (
              <Show
                when={props.spinner}
                fallback={
                  <text fg={permission() ? theme.text.feedback.warning.default : theme.text.subdued}>
                    {title()}
                  </text>
                }
              >
                <Spinner color={permission() ? theme.text.feedback.warning.default : theme.text.subdued}>
                  {title().replace(/^# /, "")}
                </Spinner>
              </Show>
            )}
          </Show>
        }
      >
        {(path) => (
          <box flexDirection="row" gap={1} minWidth={0}>
            <Show
              when={props.spinner}
              fallback={
                <text flexShrink={0} fg={permission() ? theme.text.feedback.warning.default : theme.text.subdued}>
                  {path().label}
                </text>
              }
            >
              <Spinner color={permission() ? theme.text.feedback.warning.default : theme.text.subdued}>
                {path().label.replace(/^# /, "")}
              </Spinner>
            </Show>
            <FilePath
              value={path().value}
              maxWidth={Math.max(2, ctx.width - 4 - stringWidth(path().label) - (props.spinner ? 2 : 0))}
              fg={permission() ? theme.text.feedback.warning.default : theme.text.subdued}
            />
          </box>
        )}
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.text.feedback.error.default}>{error()}</text>
      </Show>
    </box>
  )
}

const SHELL_DISPLAY_LIMIT = 1024 * 1024

function Shell(props: ToolProps) {
  const theme = useTheme()
  const ctx = use()
  const client = useClient()
  const data = useData()
  const pathFormatter = usePathFormatter()
  const permission = useToolPermission(() => props.part)
  const color = createMemo(() => (permission() ? theme.text.feedback.warning.default : theme.text.default))
  const shellID = createMemo(() => stringValue(props.metadata.shellID))
  const background = createMemo(() => Boolean(shellID()) && props.part.state.status !== "running")
  const backgroundRunning = createMemo(() => {
    const id = shellID()
    return Boolean(id && data.shell.get(id))
  })
  const isRunning = createMemo(() => props.part.state.status === "running" || backgroundRunning())
  const command = createMemo(() => stringValue(props.input.command))
  const workdir = createMemo(() => pathFormatter.format(stringValue(props.input.workdir)))
  const [expanded, setExpanded] = createSignal(false)
  const [backgroundOutput, setBackgroundOutput] = createSignal("")
  const [outputTruncated, setOutputTruncated] = createSignal(false)
  let loading = false
  let drainRequested = false
  let cursor = 0
  let wasRunning = false
  const loadBackgroundOutput = async (drain = false) => {
    const id = shellID()
    if (!id) return
    if (loading) {
      if (drain) drainRequested = true
      return
    }
    loading = true
    const location = data.session.get(ctx.sessionID)?.location
    do {
      const response = await client.api.shell
        .output({
          id,
          cursor,
          limit: SHELL_DISPLAY_LIMIT,
          location: location ? { directory: location.directory, workspace: location.workspaceID } : undefined,
        })
        .catch(() => undefined)
      if (!response) break
      if (response.data.output)
        setBackgroundOutput((output) => {
          const next = stripAnsi(output + response.data.output)
          if (next.length <= SHELL_DISPLAY_LIMIT) return next
          setOutputTruncated(true)
          return next.slice(-SHELL_DISPLAY_LIMIT)
        })
      if (response.data.cursor <= cursor) break
      cursor = response.data.cursor
      if (!drain || cursor >= response.data.size) break
      const tail = Math.max(cursor, response.data.size - SHELL_DISPLAY_LIMIT)
      if (tail > cursor) {
        cursor = tail
        setOutputTruncated(true)
      }
    } while (true)
    loading = false
    if (drainRequested) {
      drainRequested = false
      void loadBackgroundOutput(true)
    }
  }
  createEffect(() => {
    const running = backgroundRunning()
    if (!running) {
      if (wasRunning) void loadBackgroundOutput(true)
      wasRunning = false
      return
    }
    wasRunning = true
    if (background() && !expanded()) return
    void loadBackgroundOutput()
    const interval = setInterval(() => void loadBackgroundOutput(), 1_000)
    onCleanup(() => clearInterval(interval))
  })
  const output = createMemo(() => {
    if (props.part.state.status === "streaming") return ""
    if (shellID()) {
      if (background() && !expanded()) return ""
      const text = backgroundOutput().trim()
      return outputTruncated() ? `[earlier output omitted]\n${text}` : text
    }
    const content = toolDisplayContent(props.part.state)[0]
    return stripAnsi(content?.type === "text" ? content.text.trim() : "")
  })
  const maxLines = 10
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const input = createMemo(() => {
    if (!command()) return ""
    const prompt = workdir() && workdir() !== "." ? `${workdir()}$ ` : isRunning() ? "" : "$ "
    return `${prompt}${command()}`
  })
  const content = createMemo(() => [input(), output()].filter(Boolean).join("\n\n"))
  const collapsed = createMemo(() => collapseToolOutput(content(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return content()
    return collapsed().output
  })
  const limitedInput = createMemo(() => limited().slice(0, input().length))
  const limitedOutput = createMemo(() => limited().slice(Math.min(limited().length, input().length + 2)))
  const expandable = createMemo(() => Boolean(shellID()) || collapsed().overflow)
  const toggle = () => {
    const next = !expanded()
    setExpanded(next)
    if (next) void loadBackgroundOutput(!backgroundRunning())
  }

  return (
    <BlockTool part={props.part} onClick={expandable() ? toggle : undefined}>
      <box gap={1}>
        <Show
          when={command()}
          fallback={
            isRunning() || props.part.state.status === "streaming" ? (
              <Spinner color={color()}>Writing command...</Spinner>
            ) : (
              <text fg={theme.text.subdued}>Writing command...</text>
            )
          }
        >
          <Show
            when={isRunning()}
            fallback={
              <text>
                <span style={{ fg: theme.text.default }}>{limitedInput()}</span>
                <span style={{ fg: theme.text.subdued }}>{limited().slice(input().length)}</span>
              </text>
            }
          >
            <Spinner color={color()}>{limitedInput()}</Spinner>
            <Show when={limitedOutput()}>
              <text fg={theme.text.subdued}>{limitedOutput()}</text>
            </Show>
          </Show>
        </Show>
        <Show when={background()}>
          <StatusBadge>Background</StatusBadge>
        </Show>
      </box>
    </BlockTool>
  )
}

function Write(props: ToolProps) {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const pathFormatter = usePathFormatter()
  const code = createMemo(() => {
    return stringValue(props.input.content) ?? ""
  })

  return (
    <Switch>
      <Match when={props.part.state.status === "completed"}>
        <BlockTool
          path={{ label: "# Wrote", value: pathFormatter.format(stringValue(props.input.path)) }}
          part={props.part}
        >
          <line_number fg={theme.text.subdued} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text.default}
              filetype={filetype(stringValue(props.input.path))}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.path) ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={stringValue(props.input.path)} part={props.part}>
          Write {pathFormatter.format(stringValue(props.input.path))}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={stringValue(props.input.pattern)} part={props.part}>
      Glob "{stringValue(props.input.pattern)}"{" "}
      <Show when={stringValue(props.input.path)}>in {pathFormatter.format(stringValue(props.input.path))} </Show>
      <Show when={finiteNumber(props.metadata.count)}>
        ({finiteNumber(props.metadata.count)} {finiteNumber(props.metadata.count) === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps) {
  const theme = useTheme()
  const pathFormatter = usePathFormatter()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={stringValue(props.input.path)}
        spinner={isRunning()}
        part={props.part}
      >
        Read {pathFormatter.format(stringValue(props.input.path))}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.text.subdued}>
              ↳ Loaded {pathFormatter.format(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={stringValue(props.input.pattern)} part={props.part}>
      Grep "{stringValue(props.input.pattern)}"{" "}
      <Show when={stringValue(props.input.path)}>in {pathFormatter.format(stringValue(props.input.path))} </Show>
      <Show when={finiteNumber(props.metadata.matches)}>
        ({finiteNumber(props.metadata.matches)} {finiteNumber(props.metadata.matches) === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function WebFetch(props: ToolProps) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={stringValue(props.input.url)} part={props.part}>
      WebFetch {stringValue(props.input.url)}
    </InlineTool>
  )
}

function WebSearch(props: ToolProps) {
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={stringValue(props.input.query)} part={props.part}>
      {webSearchProviderLabel(props.metadata.provider)} "{stringValue(props.input.query)}"
    </InlineTool>
  )
}

function Subagent(props: ToolProps) {
  const { navigate } = useRoute()
  const data = useData()
  const sessionID = createMemo(() => stringValue(props.metadata.sessionID) ?? stringValue(props.metadata.sessionId))
  const description = createMemo(() => stringValue(props.input.description))
  const isRunning = createMemo(() => {
    const id = sessionID()
    return props.part.state.status === "running" || Boolean(id && data.session.status(id) === "running")
  })

  return (
    <InlineTool
      icon={isRunning() ? "│" : props.part.state.status === "completed" ? "✓" : "│"}
      spinner={isRunning()}
      complete={description()}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        const id = sessionID()
        if (id) navigate({ type: "session", sessionID: id })
      }}
      status={
        isBackgroundSubagent(props.metadata, props.part.state.status) ? (
          <StatusBadge>Background</StatusBadge>
        ) : undefined
      }
    >
      {`${Locale.titlecase(stringValue(props.input.agent) ?? stringValue(props.input.subagent_type) ?? "General")} Subagent — ${description() ?? "Subagent"}`}
    </InlineTool>
  )
}

export function isBackgroundSubagent(
  metadata: Record<string, unknown>,
  status: SessionMessageAssistantTool["state"]["status"],
) {
  return status === "completed" && metadata.status === "running"
}

type ExecuteCall = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    const item = recordValue(call)
    const tool = stringValue(item?.tool)
    const status = stringValue(item?.status)
    if (!tool || !status || !["running", "completed", "error"].includes(status)) return []
    return [{ tool, status: status as ExecuteCall["status"], input: recordValue(item?.input) }]
  })
}

// The `execute` tool streams child tool calls through metadata, not a child session like Task.
function Execute(props: ToolProps) {
  const ctx = use()
  const theme = useTheme()
  const isLoading = createMemo(() => props.part.state.status === "streaming" || props.part.state.status === "running")
  const calls = createMemo(() => executeCalls(props.metadata.toolCalls))
  const output = createMemo(() => stripAnsi(props.output?.trim() ?? ""))
  const hasRuntimeError = createMemo(() => props.metadata.error === true || props.part.state.status === "error")
  const outputPreview = createMemo(() => collapseToolOutput(output(), 4, 4 * Math.max(20, ctx.width - 6)).output)
  const showOutput = createMemo(() => output() && hasRuntimeError())
  const content = createMemo(() => {
    const lines = ["execute"]
    for (const call of calls()) {
      const args = primitiveInputSummary(call.input ?? {})
      lines.push(`↳ ${call.tool}${args ? ` ${args}` : ""}${call.status === "error" ? " (failed)" : ""}`)
    }
    return lines.join("\n")
  })

  return (
    <>
      <InlineTool
        icon={hasRuntimeError() ? "✗" : props.part.state.status === "completed" ? "✓" : "│"}
        color={hasRuntimeError() ? theme.text.feedback.error.default : undefined}
        spinner={isLoading()}
        pending="execute"
        complete={true}
        part={props.part}
      >
        {content()}
      </InlineTool>
      <Show when={showOutput()}>
        <box paddingLeft={3}>
          <For each={outputPreview().split("\n")}>
            {(line, index) => (
              <text paddingLeft={3} fg={theme.text.feedback.error.default}>
                {index() === 0 ? "↳ " : "  "}
                {line}
              </text>
            )}
          </For>
        </box>
      </Show>
    </>
  )
}

function Edit(props: ToolProps) {
  const ctx = use()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const pathFormatter = usePathFormatter()

  const view = createMemo(() => {
    const diffView = ctx.config.diffs?.view
    if (diffView === "unified") return "unified"
    if (diffView === "split") return "split"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const file = createMemo(() => parseApplyPatchFiles(props.metadata.files)[0])
  const path = createMemo(() => file()?.relativePath ?? stringValue(props.input.path))

  return (
    <Switch>
      <Match when={file()}>
        {(item) => (
          <BlockTool path={{ label: "← Edit", value: pathFormatter.format(path()) }} part={props.part}>
            <box paddingLeft={1}>
              <PatchDiff
                diff={item().patch}
                hunkFg={theme.diff.text.hunkHeader}
                view={view()}
                filetype={filetype(path())}
                syntaxStyle={syntax()}
                showLineNumbers={true}
                width="100%"
                wrapMode={ctx.diffWrapMode()}
                fg={theme.text.default}
                addedBg={theme.diff.background.added}
                removedBg={theme.diff.background.removed}
                contextBg={theme.diff.background.context}
                addedSignColor={theme.diff.highlight.added}
                removedSignColor={theme.diff.highlight.removed}
                lineNumberFg={theme.diff.lineNumber.text}
                lineNumberBg={theme.diff.background.context}
                addedLineNumberBg={theme.diff.lineNumber.background.added}
                removedLineNumberBg={theme.diff.lineNumber.background.removed}
              />
            </box>
            <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.path) ?? ""} />
          </BlockTool>
        )}
      </Match>
      <Match when={true}>
        <BlockTool
          path={
            stringValue(props.input.path)
              ? { label: "← Edit", value: pathFormatter.format(stringValue(props.input.path)) }
              : undefined
          }
          title={stringValue(props.input.path) ? undefined : "# Preparing edit..."}
          part={props.part}
          spinner={props.part.state.status === "streaming"}
        />
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps) {
  const ctx = use()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const pathFormatter = usePathFormatter()
  const files = createMemo(() => parseApplyPatchFiles(props.metadata.files))
  const targets = createMemo(() => {
    const patch = stringValue(props.input.patchText)
    if (!patch) return []
    return [...patch.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+)/g)].map((match) => match[1].trim())
  })
  const applied = createMemo(() => {
    const applied = props.metadata.applied
    if (!Array.isArray(applied)) return []
    return applied.flatMap((value) => {
      const item = recordValue(value)
      const type = stringValue(item?.type)
      const resource = stringValue(item?.resource)
      return type && resource ? [{ type, resource }] : []
    })
  })
  const view = createMemo(() => {
    if (ctx.config.diffs?.view === "unified") return "unified"
    if (ctx.config.diffs?.view === "split") return "split"
    return ctx.width > 120 ? "split" : "unified"
  })

  return (
    <Switch>
      <Match when={files().length > 0}>
        <box flexDirection="column" gap={1}>
          <For each={files()}>
            {(file) => (
              <BlockTool
                path={{
                  label: file.type === "add" ? "# Created" : file.type === "delete" ? "# Deleted" : "← Patched",
                  value: pathFormatter.format(file.relativePath),
                }}
                part={props.part}
              >
                <Show
                  when={file.type !== "delete"}
                  fallback={
                    <text fg={theme.diff.text.removed}>
                      -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                    </text>
                  }
                >
                  <box paddingLeft={1}>
                    <PatchDiff
                      diff={file.patch}
                      hunkFg={theme.diff.text.hunkHeader}
                      view={view()}
                      filetype={filetype(file.relativePath)}
                      syntaxStyle={syntax()}
                      showLineNumbers={true}
                      width="100%"
                      wrapMode={ctx.diffWrapMode()}
                      fg={theme.text.default}
                      addedBg={theme.diff.background.added}
                      removedBg={theme.diff.background.removed}
                      contextBg={theme.diff.background.context}
                      addedSignColor={theme.diff.highlight.added}
                      removedSignColor={theme.diff.highlight.removed}
                      lineNumberFg={theme.diff.lineNumber.text}
                      lineNumberBg={theme.diff.background.context}
                      addedLineNumberBg={theme.diff.lineNumber.background.added}
                      removedLineNumberBg={theme.diff.lineNumber.background.removed}
                    />
                  </box>
                </Show>
              </BlockTool>
            )}
          </For>
        </box>
      </Match>
      <Match when={applied().length > 0}>
        <box flexDirection="column" gap={1}>
          <For each={applied()}>
            {(file) => (
              <BlockTool
                path={{
                  label: file.type === "add" ? "# Created" : file.type === "delete" ? "# Deleted" : "← Patched",
                  value: pathFormatter.format(file.resource),
                }}
                part={props.part}
              >
                <FilePath
                  value={file.resource}
                  maxWidth={Math.max(2, ctx.width - 3)}
                  fg={file.type === "delete" ? theme.diff.text.removed : theme.text.subdued}
                />
              </BlockTool>
            )}
          </For>
        </box>
      </Match>
      <Match when={true}>
        <BlockTool
          path={
            targets().length === 1
              ? {
                  label: props.part.state.status === "error" ? "# Patch failed" : "Patching",
                  value: pathFormatter.format(targets()[0]),
                }
              : undefined
          }
          title={
            targets().length === 1 ? undefined : props.part.state.status === "error" ? "# Patch failed" : "Patching"
          }
          part={props.part}
          spinner={props.part.state.status === "streaming" || props.part.state.status === "running"}
        />
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps) {
  const theme = useTheme()
  const questions = createMemo(() => parseQuestions(props.input.questions))
  const answers = createMemo(() => parseQuestionAnswers(props.metadata.answers))
  const count = createMemo(() => questions().length)

  function format(answer?: ReadonlyArray<string>) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={answers()}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={questions()}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.text.subdued}>{q.question}</text>
                  <text fg={theme.text.default}>{format(answers()?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps) {
  const name = createMemo(() => stringValue(props.metadata.name) ?? stringValue(props.input.id))
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={name()} part={props.part}>
      Skill "{name()}"
    </InlineTool>
  )
}

function Diagnostics(props: { diagnostics: unknown; filePath: string }) {
  const theme = useTheme()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const errors = createMemo(() => {
    const normalized = normalizePath(
      typeof props.filePath === "string" ? props.filePath : "",
      terminalEnvironment.platform,
    )
    return parseDiagnostics(props.diagnostics, normalized)
  })

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.text.feedback.error.default}>
              Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

const toolDisplays = new Set([
  "shell",
  "glob",
  "read",
  "grep",
  "webfetch",
  "websearch",
  "write",
  "edit",
  "subagent",
  "execute",
  "patch",
  "question",
  "skill",
])

export function toolDisplay(tool: string) {
  const normalized = canonicalToolName(tool)
  return toolDisplays.has(normalized) ? normalized : "generic"
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function formatSessionTranscript(session: SessionInfo, messages: SessionMessageInfo[], thinking: boolean) {
  const body = messages.flatMap((message) => {
    if (message.type === "user") return [`## User\n\n${message.text}`]
    if (message.type === "shell")
      return [`## Shell\n\n\`\`\`\n$ ${message.command}\n${message.output?.output ?? ""}\n\`\`\``]
    if (message.type !== "assistant") return []
    const content = message.content.flatMap((item) => {
      if (item.type === "text") return [item.text]
      if (item.type === "reasoning") return thinking ? [`_Thinking:_\n\n${item.text}`] : []
      const input = typeof item.state.input === "string" ? item.state.input : JSON.stringify(item.state.input, null, 2)
      const output =
        item.state.status === "error"
          ? item.state.error.message
          : item.state.status === "streaming"
            ? ""
            : toolDisplayContent(item.state)
                .flatMap((entry) => (entry.type === "text" ? [entry.text] : [entry.name ?? entry.uri]))
                .join("\n")
      return [`**Tool: ${item.name}**\n\n**Input:**\n\`\`\`json\n${input}\n\`\`\`\n\n${output}`]
    })
    return [`## Assistant\n\n${content.join("\n\n")}`]
  })
  return `# ${withTimestampedFallback(session)}\n\n**Session ID:** ${session.id}\n**Created:** ${new Date(session.time.created).toLocaleString()}\n**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n---\n\n${body.join("\n\n---\n\n")}\n`
}

export function parseApplyPatchFiles(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const file = recordValue(item)
    if (!file) return []
    const status = stringValue(file.status)
    const type =
      stringValue(file.type) ??
      (status === "added" ? "add" : status === "deleted" ? "delete" : status === "modified" ? "update" : undefined)
    const relativePath = stringValue(file.file) ?? stringValue(file.relativePath)
    const filePath = stringValue(file.filePath) ?? relativePath
    const patch = stringValue(file.patch)
    const additions = finiteNumber(file.additions)
    const deletions = finiteNumber(file.deletions)
    if (
      !type ||
      !relativePath ||
      !filePath ||
      patch === undefined ||
      additions === undefined ||
      deletions === undefined
    )
      return []
    return [{ type, relativePath, filePath, patch, additions, deletions, movePath: stringValue(file.movePath) }]
  })
}

export function parseQuestions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const question = stringValue(recordValue(item)?.question)
    return question ? [{ question }] : []
  })
}

export function parseQuestionAnswers(value: unknown) {
  if (!Array.isArray(value)) return
  return value.map((answer) =>
    Array.isArray(answer) ? answer.filter((item): item is string => typeof item === "string") : [],
  )
}

export function parseDiagnostics(value: unknown, filePath: string) {
  const diagnostics = recordValue(value)?.[filePath]
  if (!Array.isArray(diagnostics)) return []
  return diagnostics
    .flatMap((item) => {
      const diagnostic = recordValue(item)
      const start = recordValue(recordValue(diagnostic?.range)?.start)
      const line = finiteNumber(start?.line)
      const character = finiteNumber(start?.character)
      const message = stringValue(diagnostic?.message)
      if (diagnostic?.severity !== 1 || line === undefined || character === undefined || !message) return []
      return [{ range: { start: { line, character } }, message }]
    })
    .slice(0, 3)
}
