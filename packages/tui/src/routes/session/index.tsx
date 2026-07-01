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
import { mkdir, writeFile } from "node:fs/promises"
import { useRoute, useRouteData } from "../../context/route"
import { createStore } from "solid-js/store"
import { useProject } from "../../context/project"
import { useData } from "../../context/data"
import { SplitBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { Spinner } from "../../component/spinner"
import { createSyntaxStyleMemo, generateSubtleSyntax, useTheme } from "../../context/theme"
import { BoxRenderable, ScrollBoxRenderable, addDefaultParsers, TextAttributes, RGBA } from "@opentui/core"
import { Prompt, type PromptRef } from "../../component/prompt"
import type {
  ModelV2Info,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageUser,
  SessionV2Info,
} from "@opencode-ai/sdk/v2"
import { useLocal } from "../../context/local"
import { Locale } from "../../util/locale"
import { webSearchProviderLabel } from "../../util/tool-display"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "../../context/sdk"
import { useEditorContext } from "../../context/editor"
import { openEditor } from "../../editor"
import { useDialog } from "../../ui/dialog"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import { Sidebar } from "./sidebar"
import { Composer } from "./composer"
import { filetype } from "../../util/filetype"
import parsers from "../../parsers-config"
import { errorMessage } from "../../util/error"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import stripAnsi from "strip-ansi"
import { usePromptRef } from "../../context/prompt"
import { useEpilogue } from "../../context/epilogue"
import { normalizePath } from "../../util/path"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { sessionEpilogue } from "../../util/presentation"
import { useTuiConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { nextThinkingMode, reasoningSummary, useThinkingMode, type ThinkingMode } from "../../context/thinking"
import { getScrollAcceleration } from "../../util/scroll"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { usePluginRuntime } from "../../plugin/runtime"
import { OPENCODE_BASE_MODE, useBindings, useCommandShortcut } from "../../keymap"
import { usePathFormatter } from "../../context/path-format"
import { LocationProvider } from "../../context/location"
import { createSessionRows, type PartRef, type SessionRow } from "./rows"

addDefaultParsers(parsers.parsers)

const sessionBindingCommands = [
  "session.share",
  "session.rename",
  "session.timeline",
  "session.fork",
  "session.compact",
  "session.unshare",
  "session.undo",
  "session.redo",
  "session.sidebar.toggle",
  "session.toggle.conceal",
  "session.toggle.timestamps",
  "session.toggle.thinking",
  "session.toggle.actions",
  "session.toggle.scrollbar",
  "session.toggle.generic_tool_output",
  "session.toggle.exploration_grouping",
  "session.first",
  "session.last",
  "session.messages_last_user",
  "session.message.next",
  "session.message.previous",
  "messages.copy",
  "session.copy",
  "session.export",
  "session.background",
  "session.child.first",
  "session.parent",
  "session.child.next",
  "session.child.previous",
] as const

const sessionGlobalBindingCommands = [
  "session.page.up",
  "session.page.down",
  "session.line.up",
  "session.line.down",
  "session.half.page.up",
  "session.half.page.down",
] as const

const sessionGlobalUnfocusedBindingCommands = ["session.first", "session.last"] as const

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  groupExploration: () => boolean
  diffWrapMode: () => "word" | "none"
  models: () => ModelV2Info[]
  tui: ReturnType<typeof useTuiConfig>
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
  const pluginRuntime = usePluginRuntime()
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const data = useData()
  const project = useProject()
  const paths = useTuiPaths()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => data.session.get(route.sessionID))
  const messageIDs = createMemo(() => data.session.message.ids(route.sessionID))
  const sessionMessages = () =>
    messageIDs().flatMap((id) => {
      const message = data.session.message.get(route.sessionID, id)
      return message ? [message] : []
    })
  const location = createMemo(() => session()?.location)

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    setEpilogue(sessionEpilogue({ title, sessionID: session()?.id }))
  })
  onCleanup(() => setEpilogue())
  const messages = sessionMessages
  const descendantSessionIDs = createMemo(() => {
    if (session()?.parentID) return []
    const sessions = data.session.list()
    const childrenByParent = sessions.reduce((acc, item) => {
      if (!item.parentID) return acc
      acc.set(item.parentID, [...(acc.get(item.parentID) ?? []), item.id])
      return acc
    }, new Map<string, string[]>())
    function collect(sessionID: string): string[] {
      return (childrenByParent.get(sessionID) ?? []).flatMap((id) => [id, ...collect(id)])
    }
    return collect(route.sessionID)
  })
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return [route.sessionID, ...descendantSessionIDs()].flatMap(
      (sessionID) => data.session.permission.list(sessionID) ?? [],
    )
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return data.session.question.list(route.sessionID) ?? []
  })
  const [composer, setComposer] = createStore({
    open: false,
    tab: undefined as string | undefined,
  })
  const disabled = createMemo(() => permissions().length > 0 || questions().length > 0)

  const pending = createMemo(() => {
    const completed = messages().findLast((x) => x.type === "assistant" && x.time.completed)?.id
    return messages().findLast((x) => x.type === "assistant" && !x.time.completed && (!completed || x.id > completed))
      ?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.type === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const thinking = useThinkingMode()
  const thinkingMode = thinking.mode
  const showThinking = createMemo(() => true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, _setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [_animationsEnabled, _setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)
  const [groupExploration, setGroupExploration] = kv.signal("exploration_grouping", true)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)
  const models = createMemo(() => data.location.model.list(location()) ?? [])

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const toast = useToast()
  const sdk = useSDK()
  const editor = useEditorContext()
  const rows = createSessionRows(() => route.sessionID)

  createEffect(
    on(descendantSessionIDs, (sessionIDs) => {
      void Promise.all(sessionIDs.map((sessionID) => data.session.permission.refresh(sessionID)))
    }),
  )

  createEffect(() => {
    const sessionID = route.sessionID
    void (async () => {
      await Promise.all([
        data.session.refresh(sessionID),
        data.session.permission.refresh(sessionID),
        data.session.question.refresh(sessionID),
      ])
      const info = data.session.get(sessionID)
      if (!info) {
        toast.show({
          message: `Session not found: ${sessionID}`,
          variant: "error",
          duration: 5000,
        })
        navigate({ type: "home" })
        return
      }

      project.workspace.set(info.location.workspaceID)
      editor.reconnect(info.location.directory)
      if (route.sessionID === sessionID && scroll) scroll.scrollBy(100_000)
    })().catch((error) => {
      if (route.sessionID !== sessionID) return
      toast.show({
        message: errorMessage(error),
        variant: "error",
        duration: 5000,
      })
      navigate({ type: "home" })
    })
  })

  let seeded = false
  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  const bind = (r: PromptRef | undefined) => {
    prompt = r
    promptRef.set(r)
    if (seeded || !route.prompt || !r) return
    seeded = true
    r.set(route.prompt)
  }
  const dialog = useDialog()
  const renderer = useRenderer()
  const unavailable = (feature: string) => {
    toast.show({ message: `${feature} is not implemented for V2 sessions yet`, variant: "error", duration: 5000 })
    dialog.clear()
  }

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        if (message.type === "user") return Boolean(message.text.trim())
        return (
          message.type === "assistant" &&
          message.content.some((content) => content.type === "text" && content.text.trim())
        )
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const sessionCommandList = createMemo(() => [
    {
      title: "Share session",
      value: "session.share",
      suggested: route.type === "session",
      category: "Session",
      slash: { name: "share" },
      run: () => unavailable("Sharing"),
    },
    {
      title: "Rename session",
      value: "session.rename",
      category: "Session",
      slash: { name: "rename" },
      run: () => DialogSessionRename.show(dialog, route.sessionID, session()?.title),
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      category: "Session",
      slash: { name: "timeline" },
      run: () => unavailable("The message timeline"),
    },
    {
      title: "Fork session",
      value: "session.fork",
      category: "Session",
      slash: { name: "fork" },
      run: () => unavailable("Forking"),
    },
    {
      title: "Compact session",
      value: "session.compact",
      category: "Session",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      run: () => {
        void sdk.api.session.compact({ sessionID: route.sessionID })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      category: "Session",
      enabled: false,
      slash: { name: "unshare" },
      run: () => unavailable("Unsharing"),
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      category: "Session",
      slash: { name: "undo" },
      run: () => {
        void (async () => {
          const boundary = session()?.revert?.messageID
          const list = messages()
          let target: string | undefined
          for (let i = list.length - 1; i >= 0; i--) {
            const message = list[i]
            if (message.type !== "user" || !message.text.trim()) continue
            if (boundary && message.id >= boundary) continue
            target = message.id
            break
          }
          if (!target) {
            toast.show({ message: "Nothing to undo", variant: "error", duration: 3000 })
            dialog.clear()
            return
          }
          const error = await sdk.api.session.revertStage({ sessionID: route.sessionID, messageID: target }).then(
            () => undefined,
            (error) => error,
          )
          if (error) toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
          dialog.clear()
        })()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      category: "Session",
      enabled: !!session()?.revert?.messageID,
      slash: { name: "redo" },
      run: () => {
        void (async () => {
          const error = await sdk.api.session.revertClear({ sessionID: route.sessionID }).then(
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
      value: "session.sidebar.toggle",
      category: "Session",
      run: () => {
        batch(() => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      title: conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      category: "Session",
      run: () => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      slash: {
        name: "timestamps",
        aliases: ["toggle-timestamps"],
      },
      run: () => {
        setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: (() => {
        const next = nextThinkingMode(thinkingMode())
        if (next === "hide") return "Collapse thinking"
        return "Expand thinking"
      })(),
      value: "session.toggle.thinking",
      category: "Session",
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      run: () => {
        thinking.set(nextThinkingMode(thinkingMode()))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      category: "Session",
      run: () => {
        setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      category: "Session",
      run: () => {
        setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      run: () => {
        setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: groupExploration() ? "Show exploration tools individually" : "Group exploration tools",
      value: "session.toggle.exploration_grouping",
      category: "Session",
      run: () => {
        setGroupExploration((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      category: "Session",
      hidden: true,
      run: () => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      category: "Session",
      hidden: true,
      run: () => {
        const messages = sessionMessages()
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.type !== "user" || !message.text.trim()) continue
          {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      category: "Session",
      hidden: true,
      run: () => scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      category: "Session",
      hidden: true,
      run: () => scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      category: "Session",
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
      value: "session.copy",
      category: "Session",
      slash: {
        name: "copy",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const transcript = formatSessionTranscript(sessionData, messages(), showThinking(), showDetails())
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
      value: "session.export",
      category: "Session",
      slash: {
        name: "export",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            showThinking(),
            showDetails(),
            showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatSessionTranscript(sessionData, messages(), options.thinking, options.toolDetails)

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await openEditor({
              renderer,
              value: transcript,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                paths.cwd,
            })
          } else {
            const exportDir = paths.cwd
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await writeExport(filepath, transcript)

            // Open with EDITOR if available
            const result = await openEditor({
              renderer,
              value: transcript,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                paths.cwd,
            })
            if (result !== undefined) {
              await writeExport(filepath, result)
            }

            toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Background subagents",
      value: "session.background",
      category: "Session",
      hidden: true,
      run: () => unavailable("Backgrounding subagents"),
    },
    {
      title: "Toggle subagent picker",
      value: "session.child.first",
      category: "Session",
      run: () => {
        if (composer.open || session()?.parentID) setComposer("open", false)
        else setComposer("open", true)
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      category: "Session",
      hidden: true,
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
    {
      title: "Next child session",
      value: "session.child.next",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: () => unavailable("Sibling session navigation"),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      run: () => unavailable("Sibling session navigation"),
    },
  ])

  const sessionCommands = createMemo(() =>
    sessionCommandList().map((command) => ({
      namespace: "palette",
      name: command.value,
      desc: "description" in command ? command.description : undefined,
      slashName: "slash" in command ? command.slash?.name : undefined,
      slashAliases: "slash" in command ? command.slash?.aliases : undefined,
      ...command,
    })),
  )

  useBindings(() => ({
    commands: sessionCommands(),
  }))

  useBindings(() => ({
    bindings: tuiConfig.keybinds.gather("session.global", sessionGlobalBindingCommands),
  }))

  useBindings(() => ({
    enabled: () => renderer.currentFocusedEditor === null,
    bindings: tuiConfig.keybinds.gather("session.global.unfocused", sessionGlobalUnfocusedBindingCommands),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("session", sessionBindingCommands),
  }))

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))
  createEffect(
    on(
      () => route.sessionID,
      () => setComposer("open", false),
    ),
  )

  return (
    <LocationProvider location={location()}>
      <context.Provider
        value={{
          get width() {
            return contentWidth()
          },
          sessionID: route.sessionID,
          conceal,
          thinkingMode,
          showThinking,
          showTimestamps,
          showDetails,
          showGenericToolOutput,
          groupExploration,
          diffWrapMode,
          models,
          tui: tuiConfig,
        }}
      >
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexGrow={1} minHeight={0} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
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
                    backgroundColor: theme.backgroundElement,
                    foregroundColor: theme.border,
                  },
                }}
                stickyScroll={true}
                stickyStart="bottom"
                flexGrow={1}
                scrollAcceleration={scrollAcceleration()}
              >
                <For each={rows}>
                  {(row) => (
                    <SessionRowView
                      row={row}
                      message={(messageID) => data.session.message.get(route.sessionID, messageID)}
                    />
                  )}
                </For>
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
              </scrollbox>
              <box flexShrink={0}>
                <Composer
                  sessionID={route.sessionID}
                  open={composer.open || !!session()?.parentID}
                  defaultTab={composer.tab ?? (session()?.parentID ? "subagents" : undefined)}
                  onClose={() => setComposer("open", false)}
                />
                <Switch>
                  <Match when={composer.open || !!session()?.parentID}>{null}</Match>
                  <Match when={permissions().length > 0}>
                    <PermissionPrompt request={permissions()[0]} directory={session()?.location.directory} />
                  </Match>
                  <Match when={questions().length > 0}>
                    <QuestionPrompt request={questions()[0]} directory={session()?.location.directory} />
                  </Match>
                  <Match when={!disabled()}>
                    <pluginRuntime.Slot
                      name="session_prompt"
                      mode="replace"
                      session_id={route.sessionID}
                      visible={true}
                      disabled={false}
                      on_submit={toBottom}
                      ref={bind}
                    >
                      <Prompt
                        visible={true}
                        ref={bind}
                        disabled={false}
                        onSubmit={() => {
                          toBottom()
                        }}
                        sessionID={route.sessionID}
                        right={<pluginRuntime.Slot name="session_prompt_right" session_id={route.sessionID} />}
                      />
                    </pluginRuntime.Slot>
                  </Match>
                </Switch>
              </box>
            </Show>
            <Toast />
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
    </LocationProvider>
  )
}

function SessionRowView(props: { row: SessionRow; message: (messageID: string) => SessionMessage | undefined }) {
  return (
    <box marginTop={1} flexShrink={0}>
      <Switch>
        <Match when={props.row.type === "message" ? props.row : undefined}>
          {(row) => (
            <Show when={props.message(row().messageID)}>{(message) => <SessionMessageView message={message()} />}</Show>
          )}
        </Match>
        <Match when={props.row.type === "part" ? props.row : undefined}>
          {(row) => <SessionPartView partRef={row().ref} message={props.message} />}
        </Match>
        <Match when={props.row.type === "group" ? props.row : undefined}>
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
      </Switch>
    </box>
  )
}

function SessionMessageView(props: { message: SessionMessage }) {
  return (
    <Switch>
      <Match when={props.message.type === "user"}>
        <UserMessage message={props.message as SessionMessageUser} />
      </Match>
      <Match when={props.message.type === "shell"}>
        <box paddingLeft={3}>
          <text>{props.message.type === "shell" ? `$ ${props.message.command}\n${props.message.output}` : ""}</text>
        </box>
      </Match>
      <Match when={props.message.type === "agent-switched" || props.message.type === "model-switched"}>
        <SessionSwitchMessageV2 message={props.message} />
      </Match>
      <Match
        when={props.message.type === "system" || props.message.type === "synthetic" || props.message.type === "skill"}
      >
        <Show when={props.message.type === "skill"} fallback={<SessionNoticeMessageV2 message={props.message} />}>
          <SessionSkillMessage message={props.message as Extract<SessionMessage, { type: "skill" }>} />
        </Show>
      </Match>
      <Match when={props.message.type === "compaction"}>
        <CompactionMessage />
      </Match>
    </Switch>
  )
}

function SessionPartView(props: { partRef: PartRef; message: (messageID: string) => SessionMessage | undefined }) {
  const message = createMemo(() => props.message(props.partRef.messageID))
  const part = createMemo(() => {
    const item = message()
    if (item?.type !== "assistant") return
    return item.content.find((part) => part.id === props.partRef.partID)
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

function SessionGroupView(props: {
  refs: PartRef[]
  pending: PartRef[]
  completed: boolean
  message: (messageID: string) => SessionMessage | undefined
}) {
  const { theme } = useTheme()
  const ctx = use()
  const renderer = useRenderer()
  const [expanded, setExpanded] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const parts = (refs: PartRef[]) =>
    refs.flatMap((ref) => {
      const message = props.message(ref.messageID)
      if (message?.type !== "assistant") return []
      const part = message.content.find((part) => part.id === ref.partID)
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
            color={hover() ? theme.text : theme.textMuted}
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
  const { theme } = useTheme()
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
  return (
    <>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{errorMessage(props.message.error)}</text>
        </box>
      </Show>
      <box paddingLeft={3} marginTop={props.message.error ? 1 : 0}>
        <text>
          <span style={{ fg: props.message.error ? theme.textMuted : local.agent.color(props.message.agent) }}>
            {Locale.titlecase(props.message.agent)}
          </span>
          <span style={{ fg: theme.textMuted }}> · {model()}</span>
          <Show when={duration()}>
            <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
          </Show>
        </text>
      </box>
    </>
  )
}

function SessionSwitchMessageV2(props: { message: SessionMessage }) {
  const { theme } = useTheme()
  const text = () => {
    if (props.message.type === "agent-switched") return `Switched agent to ${props.message.agent}`
    if (props.message.type === "model-switched")
      return `Switched model to ${props.message.model.providerID}/${props.message.model.id}`
    return ""
  }
  return <text fg={theme.textMuted}>{text()}</text>
}

function SessionNoticeMessageV2(props: { message: SessionMessage }) {
  const { theme } = useTheme()
  const text = () => {
    if (props.message.type === "system" || props.message.type === "synthetic") return props.message.text
    return ""
  }
  return <text fg={theme.textMuted}>{text()}</text>
}

function SessionSkillMessage(props: { message: Extract<SessionMessage, { type: "skill" }> }) {
  const { theme } = useTheme()
  return (
    <InlineToolRow icon="→" color={theme.textMuted} pending="Skill" complete={true}>
      Skill {props.message.name}
    </InlineToolRow>
  )
}

function CompactionMessage() {
  const { theme } = useTheme()
  return <box border={["top"]} title=" Compaction " titleAlignment="center" borderColor={theme.borderActive} />
}

function statusLabel(status: "added" | "modified" | "deleted") {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}

function RevertMessage(props: {
  count: number
  files: ReadonlyArray<{
    readonly path: string
    readonly status: "added" | "modified" | "deleted"
    readonly additions: number
    readonly deletions: number
  }>
}) {
  const { theme } = useTheme()
  const route = useRouteData("session")
  const sdk = useSDK()
  const toast = useToast()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const redoKey = useCommandShortcut("session.redo")
  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        void (async () => {
          const error = await sdk.api.session.revertClear({ sessionID: route.sessionID }).then(
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
      borderColor={theme.backgroundPanel}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.textMuted}>
          {props.count} message{props.count === 1 ? "" : "s"} reverted
        </text>
        <Show when={props.files.length > 0}>
          <box paddingTop={1} paddingBottom={1} flexDirection="column">
            <For each={props.files}>
              {(file) => (
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <text fg={theme.textMuted}>{statusLabel(file.status)}</text>
                  <text fg={theme.text} wrapMode="none">
                    {Locale.truncateLeft(file.path, 60)}
                  </text>
                  <Show when={file.additions > 0}>
                    <text fg={theme.diffAdded}>+{file.additions}</text>
                  </Show>
                  <Show when={file.deletions > 0}>
                    <text fg={theme.diffRemoved}>-{file.deletions}</text>
                  </Show>
                </box>
              )}
            </For>
          </box>
        </Show>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{redoKey()}</span> or /redo to restore
        </text>
      </box>
    </box>
  )
}

function UserMessage(props: { message: SessionMessageUser }) {
  const ctx = use()
  const local = useLocal()
  const files = createMemo(() => props.message.files ?? [])
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const color = createMemo(() => local.agent.color(useData().session.get(ctx.sessionID)?.agent ?? "build"))
  const dialog = useDialog()
  const renderer = useRenderer()

  return (
    <Show when={props.message.text.trim() || files().length}>
      <box
        id={props.message.id}
        border={["left"]}
        borderColor={color()}
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
            dialog.replace(() => <DialogMessage messageID={props.message.id} sessionID={ctx.sessionID} />)
          }}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
          flexShrink={0}
        >
          <text fg={theme.text}>{props.message.text}</text>
          <Show when={files().length}>
            <box
              flexDirection="row"
              paddingBottom={ctx.showTimestamps() ? 1 : 0}
              paddingTop={1}
              gap={1}
              flexWrap="wrap"
            >
              <For each={files()}>
                {(file) => {
                  const directory = file.mime === "application/x-directory"
                  return (
                    <text fg={theme.text}>
                      <span style={{ bg: theme.secondary, fg: theme.background }}>
                        {directory ? " Directory " : " File "}
                      </span>
                      <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}>
                        {" "}
                        {file.name ?? file.uri}{" "}
                      </span>
                    </text>
                  )
                }}
              </For>
            </box>
          </Show>
          <Show when={ctx.showTimestamps()}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.textMuted }}>{Locale.todayTimeOrDateTime(props.message.time.created)}</span>
            </text>
          </Show>
        </box>
      </box>
    </Show>
  )
}

function AssistantMessage(props: { message: SessionMessageAssistant; last: boolean }) {
  const ctx = use()
  const local = useLocal()
  const { theme } = useTheme()
  const model = createMemo(
    () =>
      ctx
        .models()
        .find((model) => model.providerID === props.message.model.providerID && model.id === props.message.model.id)
        ?.name ?? `${props.message.model.providerID}/${props.message.model.id}`,
  )

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    return props.message.time.completed - props.message.time.created
  })

  const exploration = createMemo(() => {
    const grouped = new Map<string, { first: boolean; parts: SessionMessageAssistantTool[]; active: boolean }>()
    if (!ctx.groupExploration()) return grouped
    const runs = props.message.content
      .map((part) =>
        part.type === "tool" &&
        ["read", "glob", "grep"].includes(toolDisplay(part.name)) &&
        part.state.status !== "pending"
          ? part
          : undefined,
      )
      .reduce<SessionMessageAssistantTool[][]>(
        (runs, part) => {
          if (part) runs[runs.length - 1].push(part)
          if (!part && runs[runs.length - 1].length) runs.push([])
          return runs
        },
        [[]],
      )
      .filter((run) => run.length > 0)
    for (const run of runs) {
      const summary = {
        parts: run,
        active: false,
      }
      run.forEach((part, index) => grouped.set(part.id, { ...summary, first: index === 0 }))
    }
    return grouped
  })

  return (
    <>
      <For each={props.message.content}>
        {(content, index) => (
          <Switch>
            <Match when={content.type === "text"}>
              <TextPart
                part={content as SessionMessageAssistantText}
                last={index() === props.message.content.length - 1}
              />
            </Match>
            <Match when={content.type === "reasoning"}>
              <ReasoningPart
                part={content as SessionMessageAssistantReasoning}
                message={props.message}
                last={index() === props.message.content.length - 1}
              />
            </Match>
            <Match when={content.type === "tool"}>
              <Show when={exploration().get((content as SessionMessageAssistantTool).id)?.first !== false}>
                <Show
                  when={exploration().get((content as SessionMessageAssistantTool).id)}
                  fallback={<ToolPart part={content as SessionMessageAssistantTool} />}
                >
                  {(summary) => <ExplorationSummary {...summary()} />}
                </Show>
              </Show>
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
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{errorMessage(props.message.error)}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error}>
          <box paddingLeft={3}>
            <text>
              <span style={{ fg: props.message.error ? theme.textMuted : local.agent.color(props.message.agent) }}>
                {Locale.titlecase(props.message.agent)}
              </span>
              <span style={{ fg: theme.textMuted }}> · {model()}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
    </>
  )
}

function ExplorationSummary(props: { parts: SessionMessageAssistantTool[]; active: boolean }) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const label = (part: SessionMessageAssistantTool) => {
    const input = typeof part.state.input === "string" ? {} : part.state.input
    const tool = toolDisplay(part.name)
    if (tool === "read") return `Read ${pathFormatter.format(stringValue(input.path))}`
    if (tool === "glob") return `Glob "${stringValue(input.pattern)}"`
    return `Grep "${stringValue(input.pattern)}"`
  }
  return (
    <box flexDirection="column">
      <InlineToolRow
        icon="✱"
        color={theme.textMuted}
        complete={!props.active}
        pending="Exploring"
        spinner={props.active}
      >
        {props.active ? "Exploring" : "Explored"}
      </InlineToolRow>
      <For each={props.parts}>
        {(part, index) => (
          <box paddingLeft={5}>
            <text fg={part.state.status === "error" ? theme.error : theme.textMuted}>
              {index() === props.parts.length - 1 ? "└" : "├"} {label(part)}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

const INLINE_TOOL_ICON_WIDTH = 2

function ReasoningPart(props: {
  last: boolean
  part: SessionMessageAssistantReasoning
  message: SessionMessageAssistant
}) {
  const { theme } = useTheme()
  const ctx = use()
  // Collapsed by default in hide mode: a single line throughout, so the
  // layout never shifts. Click to open the full markdown block, click to close.
  const [expanded, setExpanded] = createSignal(false)

  const content = createMemo(() => {
    // OpenRouter encrypts some reasoning blocks; drop the placeholder.
    return props.part.text.replace("[REDACTED]", "").trim()
  })
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
  const syntax = createSyntaxStyleMemo(() => generateSubtleSyntax(theme))

  const toggle = () => {
    if (!inMinimal()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content()}>
      <box paddingLeft={3} flexDirection="column" flexShrink={0}>
        <box onMouseUp={toggle}>
          <ReasoningHeader
            toggleable={inMinimal()}
            open={!inMinimal() || expanded()}
            done={isDone()}
            title={summary().title}
            duration={isDone() ? Locale.duration(duration()) : undefined}
          />
        </box>
        <Show when={(!inMinimal() || expanded()) && summary().body}>
          <box paddingLeft={inMinimal() ? 2 : 0} marginTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={summary().body}
              conceal={ctx.conceal()}
              fg={theme.textMuted}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: {
  toggleable: boolean
  open: boolean
  done: boolean
  title: string | null
  duration?: string
}) {
  const { theme } = useTheme()
  const fg = () =>
    props.open
      ? RGBA.fromValues(theme.warning.r, theme.warning.g, theme.warning.b, theme.thinkingOpacity)
      : theme.warning

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
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box paddingLeft={3} flexShrink={0}>
        <markdown
          syntaxStyle={syntax()}
          streaming={true}
          internalBlockMode="top-level"
          content={props.part.text.trim()}
          tableOptions={{ style: "grid" }}
          conceal={ctx.conceal()}
          fg={theme.markdownText}
          bg={theme.background}
        />
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { part: SessionMessageAssistantTool }) {
  const ctx = use()
  const data = useData()
  const display = createMemo(() => toolDisplay(props.part.name))
  const runningShell = createMemo(
    () => {
      if (display() !== "shell" || props.part.state.status === "pending") return false
      const shellID = stringValue(props.part.state.structured.shellID)
      return Boolean(shellID && data.shell.get(shellID))
    },
  )

  // Hide tool if showDetails is false and tool completed successfully
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (runningShell()) return false
    if (props.part.state.status !== "completed") return false
    if (display() === "shell") return false
    return true
  })

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : props.part.state.structured
    },
    get input() {
      return typeof props.part.state.input === "string" ? {} : props.part.state.input
    },
    get output() {
      if (props.part.state.status === "pending") return undefined
      return props.part.state.content
        .flatMap((content) => (content.type === "text" ? [content.text] : [content.name ?? content.uri]))
        .join("\n")
    },
    get tool() {
      return props.part.name
    },
    get part() {
      return props.part
    },
    get runningShell() {
      return runningShell()
    },
  }

  return (
    <Show when={!shouldHide()}>
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
          <Task {...toolprops} />
        </Match>
        <Match when={display() === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={display() === "todowrite"}>
          <TodoWrite {...toolprops} />
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
    </Show>
  )
}

type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  output?: string
  part: SessionMessageAssistantTool
  runningShell?: boolean
}
function GenericTool(props: ToolProps) {
  const { theme } = useTheme()
  const ctx = use()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 3
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
          {props.tool} {input(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.tool} ${input(props.input)}`}
        part={props.part}
        onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={collapsed().overflow}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  children: JSX.Element
  part: SessionMessageAssistantTool
  onClick?: () => void
}) {
  const { theme } = useTheme()
  const ctx = use()
  const data = useData()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const [errorExpanded, setErrorExpanded] = createSignal(false)

  const permission = createMemo(() => {
    const request = data.session.permission.list(ctx.sessionID)?.[0]
    return request?.source?.type === "tool" && request.source.callID === props.part.id
  })

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
    if (permission()) return theme.warning
    if (failed()) return theme.error
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })

  return (
    <InlineToolRow
      icon={props.icon}
      iconColor={props.iconColor}
      color={fg()}
      errorColor={theme.error}
      failed={failed()}
      denied={Boolean(denied())}
      error={error()}
      errorExpanded={errorExpanded()}
      complete={props.complete}
      pending={props.pending}
      failure={props.failure}
      spinner={props.spinner}
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
  children: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: () => void
}) {
  return (
    <box paddingLeft={3} onMouseOver={props.onMouseOver} onMouseOut={props.onMouseOut} onMouseUp={props.onMouseUp}>
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={props.color} children={props.children} />
        </Match>
        <Match when={true}>
          <Show
            fallback={
              <text
                paddingLeft={3}
                fg={props.color}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                ~ {props.pending}
              </text>
            }
            when={props.complete || props.failed}
          >
            <box flexDirection="row">
              <text
                width={INLINE_TOOL_ICON_WIDTH}
                fg={props.failed ? props.errorColor : (props.iconColor ?? props.color)}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {props.icon}
              </text>
              <text
                flexGrow={1}
                fg={props.failed ? props.errorColor : props.color}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {props.failed && !props.complete ? (props.failure ?? props.children) : props.children}
              </text>
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

function BlockTool(props: {
  title?: string
  children?: JSX.Element
  onClick?: () => void
  part?: SessionMessageAssistantTool
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const ctx = use()
  const data = useData()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error.message : undefined))
  const permission = createMemo(() => {
    if (!props.part) return false
    const request = data.session.permission.list(ctx.sessionID)?.[0]
    return request?.source?.type === "tool" && request.source.callID === props.part.id
  })
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show when={props.title}>
        {(title) => (
          <Show
            when={props.spinner}
            fallback={
              <text paddingLeft={3} fg={permission() ? theme.warning : theme.textMuted}>
                {title()}
              </text>
            }
          >
            <Spinner color={permission() ? theme.warning : theme.textMuted}>{title().replace(/^# /, "")}</Spinner>
          </Show>
        )}
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Shell(props: ToolProps) {
  const { theme } = useTheme()
  const ctx = use()
  const data = useData()
  const permission = createMemo(() => {
    const request = data.session.permission.list(ctx.sessionID)?.[0]
    return request?.source?.type === "tool" && request.source.callID === props.part.id
  })
  const color = createMemo(() => (permission() ? theme.warning : theme.text))
  const isRunning = createMemo(() => props.part.state.status === "running" || props.runningShell === true)
  const command = createMemo(() => stringValue(props.input.command))
  const output = createMemo(() => {
    if (props.part.state.status === "pending") return ""
    const content = props.part.state.content[0]
    return stripAnsi(content?.type === "text" ? content.text.trim() : "")
  })
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 10
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const input = createMemo(() => (command() ? `${isRunning() ? "" : "$ "}${command()}` : ""))
  const content = createMemo(() => [input(), output()].filter(Boolean).join("\n\n"))
  const collapsed = createMemo(() => collapseToolOutput(content(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return content()
    return collapsed().output
  })

  return (
    <BlockTool part={props.part} onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}>
      <box gap={1}>
        <Show
          when={command()}
          fallback={
            isRunning() || props.part.state.status === "pending" ? (
              <Spinner color={color()}>Writing command...</Spinner>
            ) : (
              <text fg={theme.textMuted}>Writing command...</text>
            )
          }
        >
          <Show
            when={isRunning()}
            fallback={
              <text>
                <span style={{ fg: theme.text }}>{limited().slice(0, input().length)}</span>
                <span style={{ fg: theme.textMuted }}>{limited().slice(input().length)}</span>
              </text>
            }
          >
            <Spinner color={color()}>
              <span style={{ fg: theme.text }}>{limited().slice(0, input().length)}</span>
              <span style={{ fg: theme.textMuted }}>{limited().slice(input().length)}</span>
            </Spinner>
          </Show>
        </Show>
        <Show when={collapsed().overflow}>
          <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
        </Show>
      </box>
    </BlockTool>
  )
}

function Write(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()
  const code = createMemo(() => {
    return stringValue(props.input.content) ?? ""
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + pathFormatter.format(stringValue(props.input.path))} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
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
      <Show when={numberValue(props.metadata.count)}>
        ({numberValue(props.metadata.count)} {numberValue(props.metadata.count) === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps) {
  const { theme } = useTheme()
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
            <text paddingLeft={3} fg={theme.textMuted}>
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
      <Show when={numberValue(props.metadata.matches)}>
        ({numberValue(props.metadata.matches)} {numberValue(props.metadata.matches) === 1 ? "match" : "matches"})
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
      {webSearchProviderLabel(props.metadata.provider)} "{stringValue(props.input.query)}"{" "}
      <Show when={numberValue(props.metadata.numResults)}>({numberValue(props.metadata.numResults)} results)</Show>
    </InlineTool>
  )
}

function Task(props: ToolProps) {
  const { navigate } = useRoute()
  const sessionID = createMemo(() => stringValue(props.metadata.sessionID) ?? stringValue(props.metadata.sessionId))
  const description = createMemo(() => stringValue(props.input.description))

  return (
    <InlineTool
      icon={props.part.state.status === "completed" ? "✓" : "│"}
      spinner={props.part.state.status === "running"}
      complete={description()}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        const id = sessionID()
        if (id) navigate({ type: "session", sessionID: id })
      }}
    >
      {formatSubagentTitle(
        Locale.titlecase(stringValue(props.input.agent) ?? stringValue(props.input.subagent_type) ?? "General"),
        description() ?? "Subagent",
        props.metadata.background === true,
      )}
    </InlineTool>
  )
}

export function formatSubagentToolcalls(count: number) {
  return `${count} toolcall${count === 1 ? "" : "s"}`
}

export function formatSubagentTitle(agent: string, description: string, background: boolean) {
  return `${agent} Subagent${background ? " (background)" : ""} — ${description}`
}

export function formatSubagentRetry(attempt: number, message: string) {
  return `Retrying (attempt ${attempt}) · ${message}`
}

export function formatCompletedSubagentDetail(toolcalls: number, duration: string) {
  if (toolcalls === 0) return duration
  return `${formatSubagentToolcalls(toolcalls)} · ${duration}`
}

function Edit(props: ToolProps) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const file = createMemo(() => parseApplyPatchFiles(props.metadata.files)[0])
  const path = createMemo(() => file()?.relativePath ?? stringValue(props.input.path))

  return (
    <Switch>
      <Match when={file()}>
        {(item) => (
          <BlockTool title={"← Edit " + pathFormatter.format(path())} part={props.part}>
            <box paddingLeft={1}>
              <diff
                diff={item().patch}
                view={view()}
                filetype={filetype(path())}
                syntaxStyle={syntax()}
                showLineNumbers={true}
                width="100%"
                wrapMode={ctx.diffWrapMode()}
                fg={theme.text}
                addedBg={theme.diffAddedBg}
                removedBg={theme.diffRemovedBg}
                contextBg={theme.diffContextBg}
                addedSignColor={theme.diffHighlightAdded}
                removedSignColor={theme.diffHighlightRemoved}
                lineNumberFg={theme.diffLineNumber}
                lineNumberBg={theme.diffContextBg}
                addedLineNumberBg={theme.diffAddedLineNumberBg}
                removedLineNumberBg={theme.diffRemovedLineNumberBg}
              />
            </box>
            <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.path) ?? ""} />
          </BlockTool>
        )}
      </Match>
      <Match when={true}>
        <BlockTool
          title={
            stringValue(props.input.path)
              ? "← Edit " + pathFormatter.format(stringValue(props.input.path))
              : "# Preparing edit..."
          }
          part={props.part}
          spinner={props.part.state.status === "pending"}
        />
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps) {
  const ctx = use()
  const { theme, syntax } = useTheme()
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
    if (ctx.tui.diff_style === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  return (
    <Switch>
      <Match when={files().length > 0}>
        <box flexDirection="column" gap={1}>
          <For each={files()}>
            {(file) => (
              <BlockTool
                title={`${file.type === "add" ? "# Created" : file.type === "delete" ? "# Deleted" : "← Patched"} ${pathFormatter.format(file.relativePath)}`}
                part={props.part}
              >
                <box paddingLeft={1}>
                  <diff
                    diff={file.patch}
                    view={view()}
                    filetype={filetype(file.relativePath)}
                    syntaxStyle={syntax()}
                    showLineNumbers={true}
                    width="100%"
                    wrapMode={ctx.diffWrapMode()}
                    fg={theme.text}
                    addedBg={theme.diffAddedBg}
                    removedBg={theme.diffRemovedBg}
                    contextBg={theme.diffContextBg}
                    addedSignColor={theme.diffHighlightAdded}
                    removedSignColor={theme.diffHighlightRemoved}
                    lineNumberFg={theme.diffLineNumber}
                    lineNumberBg={theme.diffContextBg}
                    addedLineNumberBg={theme.diffAddedLineNumberBg}
                    removedLineNumberBg={theme.diffRemovedLineNumberBg}
                  />
                </box>
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
                title={`${file.type === "add" ? "# Created" : file.type === "delete" ? "# Deleted" : "← Patched"} ${pathFormatter.format(file.resource)}`}
                part={props.part}
              >
                <text fg={file.type === "delete" ? theme.diffRemoved : theme.textMuted}>{file.resource}</text>
              </BlockTool>
            )}
          </For>
        </box>
      </Match>
      <Match when={true}>
        <BlockTool
          title={
            targets().length === 1
              ? `${props.part.state.status === "error" ? "# Patch failed" : "# Preparing patch"} ${pathFormatter.format(targets()[0])}`
              : props.part.state.status === "error"
                ? "# Patch failed"
                : "# Preparing patch..."
          }
          part={props.part}
          spinner={props.part.state.status === "pending"}
        />
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps) {
  const todos = createMemo(() => parseTodos(props.input.todos))
  return (
    <Switch>
      <Match when={parseTodos(props.metadata.todos).length}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={todos()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon="⚙"
          pending="Updating todos..."
          failure="Todo update failed"
          complete={false}
          part={props.part}
        >
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps) {
  const { theme } = useTheme()
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
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(answers()?.[i()])}</text>
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
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={stringValue(props.input.name)} part={props.part}>
      Skill "{stringValue(props.input.name)}"
    </InlineTool>
  )
}

function Diagnostics(props: { diagnostics: unknown; filePath: string }) {
  const { theme } = useTheme()
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
            <text fg={theme.error}>
              Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function input(input: Record<string, unknown>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
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
  "apply_patch",
  "todowrite",
  "question",
  "skill",
])

export function toolDisplay(tool: string) {
  // Legacy transcripts recorded the shell tool as "bash" and the subagent tool as "task"; render
  // them with the renamed views.
  const normalized = tool === "bash" ? "shell" : tool === "task" ? "subagent" : tool
  return toolDisplays.has(normalized) ? normalized : "generic"
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function formatSessionTranscript(
  session: SessionV2Info,
  messages: SessionMessage[],
  thinking: boolean,
  toolDetails: boolean,
) {
  const body = messages.flatMap((message) => {
    if (message.type === "user") return [`## User\n\n${message.text}`]
    if (message.type === "shell") return [`## Shell\n\n\`\`\`\n$ ${message.command}\n${message.output}\n\`\`\``]
    if (message.type !== "assistant") return []
    const content = message.content.flatMap((item) => {
      if (item.type === "text") return [item.text]
      if (item.type === "reasoning") return thinking ? [`_Thinking:_\n\n${item.text}`] : []
      if (!toolDetails) return [`**Tool: ${item.name}**`]
      const input = typeof item.state.input === "string" ? item.state.input : JSON.stringify(item.state.input, null, 2)
      const output =
        item.state.status === "error"
          ? item.state.error.message
          : item.state.status === "pending"
            ? ""
            : item.state.content
                .flatMap((entry) => (entry.type === "text" ? [entry.text] : [entry.name ?? entry.uri]))
                .join("\n")
      return [`**Tool: ${item.name}**\n\n**Input:**\n\`\`\`json\n${input}\n\`\`\`\n\n${output}`]
    })
    return [`## Assistant\n\n${content.join("\n\n")}`]
  })
  return `# ${session.title}\n\n**Session ID:** ${session.id}\n**Created:** ${new Date(session.time.created).toLocaleString()}\n**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n---\n\n${body.join("\n\n---\n\n")}\n`
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
    const additions = numberValue(file.additions)
    const deletions = numberValue(file.deletions)
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

export function parseTodos(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const todo = recordValue(item)
    const status = stringValue(todo?.status)
    const content = stringValue(todo?.content)
    return status && content ? [{ status, content }] : []
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
      const line = numberValue(start?.line)
      const character = numberValue(start?.character)
      const message = stringValue(diagnostic?.message)
      if (diagnostic?.severity !== 1 || line === undefined || character === undefined || !message) return []
      return [{ range: { start: { line, character } }, message }]
    })
    .slice(0, 3)
}
