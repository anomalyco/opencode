import { useFilteredList } from "@opencode-ai/ui/hooks"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import {
  createEffect,
  on,
  Component,
  Show,
  onCleanup,
  createMemo,
  createSignal,
  createResource,
  Switch,
  Match,
  type JSX,
} from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import type { useLocal } from "@/context/local"
import { selectionFromLines, type SelectedLineRange, useFile } from "@/context/file"
import {
  ContentPart,
  DEFAULT_PROMPT,
  isCommentItem,
  isPromptEqual,
  Prompt,
  usePrompt,
  ImageAttachmentPart,
  AgentPart,
  FileAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useComments } from "@/context/comments"
import { Button } from "@opencode-ai/ui/button"
import { DockShellForm, DockTray } from "@opencode-ai/ui/dock-surface"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ModelSelectorPopover, ModelSelectorPopoverV2 } from "@/components/dialog-select-model"
import { DialogSelectModelUnpaid } from "@/components/dialog-select-model-unpaid"
import { DialogSelectModelUnpaidV2 } from "@/components/dialog-select-model-unpaid-v2"
import { useCommand } from "@/context/command"
import { Persist, persisted } from "@/utils/persist"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { createSessionTabs } from "@/pages/session/helpers"
import { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./prompt-input/editor-dom"
import { createPromptAttachments } from "./prompt-input/attachments"
import { ACCEPTED_FILE_TYPES, pickAttachmentFiles } from "./prompt-input/files"
import {
  canNavigateHistoryAtCursor,
  navigatePromptHistory,
  prependHistoryEntry,
  type PromptHistoryComment,
  type PromptHistoryEntry,
  type PromptHistoryStoredEntry,
  promptLength,
} from "./prompt-input/history"
import { createPromptSubmit, type FollowupDraft } from "./prompt-input/submit"
import { PromptPopover, type AtOption, type SlashCommand } from "./prompt-input/slash-popover"
import { PromptContextItems } from "./prompt-input/context-items"
import { PromptImageAttachments } from "./prompt-input/image-attachments"
import { PromptDragOverlay } from "./prompt-input/drag-overlay"
import { promptPlaceholder } from "./prompt-input/placeholder"
import { createPromptInputTransientState } from "./prompt-input/transient-state"
import { showToast } from "@/utils/toast"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import type { ReferenceInfo } from "@opencode-ai/sdk/v2/client"

export type PromptInputState = ReturnType<typeof usePrompt>

export type PromptInputHistory = {
  entries: (mode: "normal" | "shell") => PromptHistoryStoredEntry[]
  add: (prompt: Prompt, mode: "normal" | "shell", comments: PromptHistoryComment[]) => void
}

export type PromptInputSubmission = {
  abort: () => Promise<void> | void
  handleSubmit: (event: Event) => Promise<void> | void
}

export type PromptInputControls = {
  agents: {
    available: { name: string; hidden?: boolean; mode: string }[]
    options: string[]
    current: string
    loading: boolean
    visible: boolean
    select: (name: string | undefined) => void
  }
  model: {
    selection: ReturnType<typeof useLocal>["model"]
    paid: boolean
    loading: boolean
  }
  session: {
    id?: string
    tabs: {
      active: () => string | undefined
      all: () => string[]
      open: (tab: string) => void | Promise<void>
      setActive: (tab: string) => void
    }
    reviewPanel: {
      opened: () => boolean
      open: () => void
    }
  }
  newLayoutDesigns: boolean
}

export function createPromptInputHistory(): PromptInputHistory {
  const [normal, setNormal] = createStore<PromptHistoryState>({ entries: [] })
  const [shell, setShell] = createStore<PromptHistoryState>({ entries: [] })
  return createPromptInputHistoryStore(normal, setNormal, shell, setShell)
}

type PromptHistoryState = { entries: PromptHistoryStoredEntry[] }

function createPromptInputHistoryStore(
  normal: Store<PromptHistoryState>,
  setNormal: SetStoreFunction<PromptHistoryState>,
  shell: Store<PromptHistoryState>,
  setShell: SetStoreFunction<PromptHistoryState>,
): PromptInputHistory {
  return {
    entries: (mode) => (mode === "shell" ? shell.entries : normal.entries),
    add(prompt, mode, comments) {
      const current = mode === "shell" ? shell : normal
      const setCurrent = mode === "shell" ? setShell : setNormal
      const next = prependHistoryEntry(current.entries, prompt, comments)
      if (next === current.entries) return
      setCurrent("entries", next)
    },
  }
}

function createPersistedPromptInputHistory() {
  const [normal, setNormal] = persisted(
    Persist.global("prompt-history", ["prompt-history.v1"]),
    createStore<PromptHistoryState>({ entries: [] }),
  )
  const [shell, setShell] = persisted(
    Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
    createStore<PromptHistoryState>({ entries: [] }),
  )
  return createPromptInputHistoryStore(normal, setNormal, shell, setShell)
}

export interface PromptInputProps {
  class?: string
  variant?: "dock" | "new-session"
  state?: PromptInputState
  history?: PromptInputHistory
  submission?: PromptInputSubmission
  controls: PromptInputControls
  ref?: (el: HTMLDivElement) => void
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: FollowupDraft["context"] }
  onEditLoaded?: () => void
  shouldQueue?: () => boolean
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  toolbar?: JSX.Element
}

const EXAMPLES = [
  "prompt.example.1",
  "prompt.example.2",
  "prompt.example.3",
  "prompt.example.4",
  "prompt.example.5",
  "prompt.example.6",
  "prompt.example.7",
  "prompt.example.8",
  "prompt.example.9",
  "prompt.example.10",
  "prompt.example.11",
  "prompt.example.12",
  "prompt.example.13",
  "prompt.example.14",
  "prompt.example.15",
  "prompt.example.16",
  "prompt.example.17",
  "prompt.example.18",
  "prompt.example.19",
  "prompt.example.20",
  "prompt.example.21",
  "prompt.example.22",
  "prompt.example.23",
  "prompt.example.24",
  "prompt.example.25",
] as const

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sdk = useSDK()

  const sync = useSync()
  const files = useFile()
  const prompt = props.state ?? usePrompt()
  const layout = useLayout()
  const comments = useComments()
  const dialog = useDialog()
  const command = useCommand()
  const permission = usePermission()
  const language = useLanguage()
  const platform = usePlatform()
  const tabs = () => props.controls.session.tabs
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement
  let restoreEndOnFocus = true
  let savedCursor: number | null = null

  const mirror = { input: false }
  const inset = 56
  const space = `${inset}px`

  const scrollCursorIntoView = () => {
    const container = scrollRef
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const cursor = getCursorPosition(editorRef)
    const length = promptLength(prompt.current().filter((part) => part.type !== "image"))
    if (cursor >= length) {
      container.scrollTop = container.scrollHeight
      return
    }

    const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
      container.scrollTop = Math.max(0, top - padding)
      return
    }

    if (bottom > container.scrollTop + container.clientHeight - inset) {
      container.scrollTop = bottom - container.clientHeight + inset
    }
  }

  const queueScroll = (count = 2) => {
    requestAnimationFrame(() => {
      scrollCursorIntoView()
      if (count > 1) queueScroll(count - 1)
    })
  }

  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: files.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? files.tab(tab) : tab),
  }).activeFileTab

  const commentInReview = (path: string) => {
    const sessionID = props.controls.session.id
    if (!sessionID) return false

    const diffs = sync().data.session_diff[sessionID]
    if (!diffs) return false
    return diffs.some((diff) => diff.file === path)
  }

  const openComment = (item: { path: string; commentID?: string; commentOrigin?: "review" | "file" }) => {
    if (!item.commentID) return

    const focus = { file: item.path, id: item.commentID }
    comments.setActive(focus)

    const queueCommentFocus = (attempts = 6) => {
      const schedule = (left: number) => {
        requestAnimationFrame(() => {
          comments.setFocus({ ...focus })
          if (left <= 0) return
          requestAnimationFrame(() => {
            const current = comments.focus()
            if (!current) return
            if (current.file !== focus.file || current.id !== focus.id) return
            schedule(left - 1)
          })
        })
      }

      schedule(attempts)
    }

    const wantsReview = item.commentOrigin === "review" || (item.commentOrigin !== "file" && commentInReview(item.path))
    if (wantsReview) {
      if (!props.controls.session.reviewPanel.opened()) props.controls.session.reviewPanel.open()
      layout.fileTree.setTab("changes")
      tabs().setActive("review")
      queueCommentFocus()
      return
    }

    if (!props.controls.session.reviewPanel.opened()) props.controls.session.reviewPanel.open()
    layout.fileTree.setTab("all")
    const tab = files.tab(item.path)
    void tabs().open(tab)
    tabs().setActive(tab)
    void Promise.resolve(files.load(item.path)).finally(() => queueCommentFocus())
  }

  const recent = createMemo(() => {
    const all = tabs().all()
    const active = activeFileTab()
    const order = active ? [active, ...all.filter((x) => x !== active)] : all
    const seen = new Set<string>()
    const paths: string[] = []

    for (const tab of order) {
      const path = files.pathFromTab(tab)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }

    return paths
  })
  const info = createMemo(() => (props.controls.session.id ? sync().session.get(props.controls.session.id) : undefined))
  const working = createMemo(() => sync().data.session_working(props.controls.session.id ?? ""))
  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )

  const [store, setStore] = createPromptInputTransientState(
    () => prompt.capture(),
    Math.floor(Math.random() * EXAMPLES.length),
  )
  const buttonsSpring = useSpring(() => (store.mode === "normal" ? 1 : 0), { visualDuration: 0.2, bounce: 0 })
  const motion = (value: number) => ({
    opacity: value,
    transform: `scale(${0.98 + value * 0.02})`,
    filter: `blur(${(1 - value) * 2}px)`,
    "pointer-events": value > 0.5 ? ("auto" as const) : ("none" as const),
  })
  const buttons = createMemo(() => motion(buttonsSpring()))
  const shell = createMemo(() => motion(1 - buttonsSpring()))
  const control = createMemo(() => ({ height: "28px", ...buttons() }))

  const commentCount = createMemo(() => {
    if (store.mode === "shell") return 0
    return prompt.context.items().filter((item) => !!item.comment?.trim()).length
  })
  const blank = createMemo(() => {
    const text = prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
    return text.trim().length === 0 && imageAttachments().length === 0 && commentCount() === 0
  })
  const stopping = createMemo(() => working() && blank())
  const tip = () => {
    if (stopping()) {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.stop")}</span>
          <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
        </div>
      )
    }

    return (
      <div class="flex items-center gap-2">
        <span>{language.t("prompt.action.send")}</span>
        <Icon name="enter" size="small" class="text-icon-base" />
      </div>
    )
  }

  const contextItems = createMemo(() => {
    const items = prompt.context.items()
    if (store.mode !== "shell") return items
    return items.filter((item) => !item.comment?.trim())
  })

  const hasUserPrompt = createMemo(() => {
    const sessionID = props.controls.session.id
    if (!sessionID) return false
    const messages = sync().data.message[sessionID]
    if (!messages) return false
    return messages.some((m) => m.role === "user")
  })

  const history = props.history ?? createPersistedPromptInputHistory()

  const suggest = createMemo(() => !hasUserPrompt())

  const placeholder = createMemo(() =>
    promptPlaceholder({
      mode: store.mode,
      commentCount: commentCount(),
      example: suggest() ? (store.mode === "shell" ? "git status" : language.t(EXAMPLES[store.placeholder])) : "",
      suggest: suggest(),
      t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params as never),
    }),
  )

  const historyComments = () => {
    const byID = new Map(comments.all().map((item) => [`${item.file}\n${item.id}`, item] as const))
    return prompt.context.items().flatMap((item) => {
      if (item.type !== "file") return []
      const comment = item.comment?.trim()
      if (!comment) return []

      const selection = item.commentID ? byID.get(`${item.path}\n${item.commentID}`)?.selection : undefined
      const nextSelection =
        selection ??
        (item.selection
          ? ({
              start: item.selection.startLine,
              end: item.selection.endLine,
            } satisfies SelectedLineRange)
          : undefined)
      if (!nextSelection) return []

      return [
        {
          id: item.commentID ?? item.key,
          path: item.path,
          selection: { ...nextSelection },
          comment,
          time: item.commentID ? (byID.get(`${item.path}\n${item.commentID}`)?.time ?? Date.now()) : Date.now(),
          origin: item.commentOrigin,
          preview: item.preview,
        } satisfies PromptHistoryComment,
      ]
    })
  }

  const applyHistoryComments = (items: PromptHistoryComment[]) => {
    comments.replace(
      items.map((item) => ({
        id: item.id,
        file: item.path,
        selection: { ...item.selection },
        comment: item.comment,
        time: item.time,
      })),
    )
    prompt.context.replaceComments(
      items.map((item) => ({
        type: "file" as const,
        path: item.path,
        selection: selectionFromLines(item.selection),
        comment: item.comment,
        commentID: item.id,
        commentOrigin: item.origin,
        preview: item.preview,
      })),
    )
  }

  const applyHistoryPrompt = (entry: PromptHistoryEntry, position: "start" | "end") => {
    const p = entry.prompt
    const length = position === "start" ? 0 : promptLength(p)
    setStore("applyingHistory", true)
    applyHistoryComments(entry.comments)
    prompt.set(p, length)
    requestAnimationFrame(() => {
      editorRef.focus()
      setCursorPosition(editorRef, length)
      setStore("applyingHistory", false)
      queueScroll()
    })
  }

  const getCaretState = () => {
    const selection = window.getSelection()
    const textLength = promptLength(prompt.current())
    if (!selection || selection.rangeCount === 0) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    const anchorNode = selection.anchorNode
    if (!anchorNode || !editorRef.contains(anchorNode)) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    return {
      collapsed: selection.isCollapsed,
      cursorPosition: getCursorPosition(editorRef),
      textLength,
    }
  }

  const escBlur = () => platform.platform === "desktop" && platform.os === "macos"

  const pick = () => {
    pickAttachmentFiles({
      picker: platform.openAttachmentPickerDialog,
      directory: () => sdk().directory,
      fallback: () => fileInputRef?.click(),
      onFile: addAttachment,
      onError: (error) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
    })
  }

  const setMode = (mode: "normal" | "shell") => {
    setStore("mode", mode)
    setStore({ popover: null, slashMenu: false, slashMenuQuery: "" })
    requestAnimationFrame(() => editorRef?.focus())
  }

  const shellModeKey = "mod+shift+x"
  const normalModeKey = "mod+shift+e"

  command.register("prompt-input", () => [
    {
      id: "file.attach",
      title: language.t("prompt.action.attachFile"),
      category: language.t("command.category.file"),
      keybind: "mod+u",
      disabled: store.mode !== "normal",
      onSelect: pick,
    },
    {
      id: "prompt.mode.shell",
      title: language.t("command.prompt.mode.shell"),
      category: language.t("command.category.session"),
      keybind: shellModeKey,
      disabled: store.mode === "shell",
      onSelect: () => setMode("shell"),
    },
    {
      id: "prompt.mode.normal",
      title: language.t("command.prompt.mode.normal"),
      category: language.t("command.category.session"),
      keybind: normalModeKey,
      disabled: store.mode === "normal",
      onSelect: () => setMode("normal"),
    },
  ])

  const closePopover = () => setStore({ popover: null, slashMenu: false, slashMenuQuery: "" })

  const resetHistoryNavigation = (force = false) => {
    if (!force && (store.historyIndex < 0 || store.applyingHistory)) return
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)
  }

  const clearEditor = () => {
    editorRef.innerHTML = ""
  }

  const setEditorText = (text: string) => {
    clearEditor()
    editorRef.textContent = text
  }

  const focusEditorEnd = () => {
    requestAnimationFrame(() => {
      editorRef.focus()
      const range = document.createRange()
      const selection = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const currentCursor = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) return null
    return getCursorPosition(editorRef)
  }

  const restoreFocus = () => {
    requestAnimationFrame(() => {
      const cursor = savedCursor ?? prompt.cursor() ?? promptLength(prompt.current())
      editorRef.focus()
      setCursorPosition(editorRef, cursor)
      queueScroll()
    })
  }

  const handleFocus = () => {
    if (!restoreEndOnFocus) return
    restoreEndOnFocus = false
    requestAnimationFrame(() => {
      if (document.activeElement !== editorRef) return
      setCursorPosition(editorRef, prompt.cursor() ?? promptLength(prompt.current()))
      queueScroll()
    })
  }

  const renderEditorWithCursor = (parts: Prompt) => {
    const cursor = currentCursor()
    renderEditor(parts)
    if (cursor !== null) setCursorPosition(editorRef, cursor)
  }

  createEffect(() => {
    props.controls.session.id
    if (props.controls.session.id) return
    if (!suggest()) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  const [composing, setComposing] = createSignal(false)
  const isImeComposing = (event: KeyboardEvent) => event.isComposing || composing() || event.keyCode === 229

  const handleBlur = () => {
    const cursor = currentCursor()
    savedCursor = cursor
    if (cursor !== null && cursor !== prompt.cursor()) prompt.set(prompt.current(), cursor)
    closePopover()
    setComposing(false)
  }

  const handleCompositionStart = () => {
    setComposing(true)
  }

  const handleCompositionEnd = () => {
    setComposing(false)
    requestAnimationFrame(() => {
      if (composing()) return
      reconcile(prompt.current().filter((part) => part.type !== "image"))
    })
  }

  const referenceDescription = (reference: ReferenceInfo) =>
    reference.source.type === "git" ? reference.source.repository : reference.source.path

  const referenceList = createMemo(() =>
    sync()
      .data.reference.filter((reference) => !reference.hidden)
      .map(
        (reference): AtOption => ({
          type: "reference",
          name: reference.name,
          path: reference.path,
          display: reference.name,
          description: reference.description ?? referenceDescription(reference),
        }),
      ),
  )

  const agentList = createMemo(() =>
    props.controls.agents.available
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent): AtOption => ({ type: "agent", name: agent.name, display: agent.name })),
  )

  const mcpResourceList = createMemo(() =>
    Object.values(sync().data.mcp_resource).map(
      (resource): AtOption => ({
        type: "resource",
        name: resource.name,
        uri: resource.uri,
        client: resource.client,
        display: resource.name,
        description: resource.description,
        mime: resource.mimeType,
      }),
    ),
  )

  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    if (option.type === "agent") {
      addPart({ type: "agent", name: option.name, content: "@" + option.name, start: 0, end: 0 })
      return
    }
    if (option.type === "reference") {
      addPart({
        type: "file",
        path: option.path,
        content: "@" + option.name,
        start: 0,
        end: 0,
        mime: "application/x-directory",
        filename: option.name,
      })
      return
    }
    if (option.type === "resource") {
      addPart({
        type: "file",
        path: option.uri,
        content: "@" + option.name,
        start: 0,
        end: 0,
        mime: option.mime ?? "text/plain",
        filename: option.name,
        url: option.uri,
        source: {
          type: "resource",
          text: { value: "@" + option.name, start: 0, end: 0 },
          clientName: option.client,
          uri: option.uri,
        },
      })
      return
    }
    addPart({ type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 })
  }

  const atKey = (x: AtOption | undefined) => {
    if (!x) return ""
    if (x.type === "agent") return `agent:${x.name}`
    if (x.type === "reference") return `reference:${x.name}`
    if (x.type === "resource") return `resource:${x.client}:${x.uri}`
    return `file:${x.path}`
  }

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) => {
      const references = referenceList()
      const agents = agentList()
      const mcpResources = mcpResourceList()
      const open = recent()
      const seen = new Set(open)
      const pinned: AtOption[] = open.map((path) => ({ type: "file", path, display: path, recent: true }))
      if (!query.trim()) return [...references, ...agents, ...mcpResources, ...pinned]
      const paths = await files.searchFilesAndDirectories(query)
      const fileOptions: AtOption[] = paths
        .filter((path) => !seen.has(path))
        .map((path) => ({ type: "file", path, display: path }))
      return [...references, ...agents, ...mcpResources, ...pinned, ...fileOptions]
    },
    key: atKey,
    filterKeys: ["display"],
    skipFilter: (item) => item.type === "file" && !item.recent,
    groupBy: (item) => {
      if (item.type === "reference") return "reference"
      if (item.type === "agent") return "agent"
      if (item.type === "resource") return "resource"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const rank = (category: string) => {
        if (category === "reference") return 0
        if (category === "agent") return 1
        if (category === "resource") return 2
        if (category === "recent") return 3
        return 4
      }
      return rank(a.category) - rank(b.category)
    },
    onSelect: handleAtSelect,
  })

  const slashCommands = createMemo<SlashCommand[]>(() => {
    const builtin = command.options
      .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
      .map((opt) => ({
        id: opt.id,
        trigger: opt.slash!,
        title: opt.title,
        description: opt.description,
        keybind: opt.keybind,
        type: "builtin" as const,
      }))

    const custom = sync().data.command.map((cmd) => ({
      id: `custom.${cmd.name}`,
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      type: "custom" as const,
      source: cmd.source,
    }))

    return [...custom, ...builtin]
  })

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    const menu = store.slashMenu
    closePopover()
    const images = imageAttachments()

    if (cmd.type === "custom") {
      const text = `/${cmd.trigger} `
      if (menu) {
        editorRef.focus()
        setCursorPosition(editorRef, 0)
        addPart({ type: "text", content: text, start: 0, end: text.length })
        focusEditorEnd()
        return
      }
      setEditorText(text)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }, ...images], text.length)
      focusEditorEnd()
      return
    }

    if (menu) {
      command.trigger(cmd.id, "slash")
      return
    }

    clearEditor()
    prompt.set([...DEFAULT_PROMPT, ...images], 0)
    command.trigger(cmd.id, "slash")
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title"],
    onSelect: handleSlashSelect,
  })

  const createPill = (part: FileAttachmentPart | AgentPart) => {
    const pill = document.createElement("span")
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    if (part.type === "file") {
      pill.setAttribute("data-path", part.path)
      if (part.mime) pill.setAttribute("data-mime", part.mime)
      if (part.filename) pill.setAttribute("data-filename", part.filename)
      if (part.url) pill.setAttribute("data-url", part.url)
      if (part.source?.type === "resource") {
        pill.setAttribute("data-source-type", part.source.type)
        pill.setAttribute("data-source-client-name", part.source.clientName)
        pill.setAttribute("data-source-uri", part.source.uri)
      }
    }
    if (part.type === "agent") pill.setAttribute("data-name", part.name)
    pill.setAttribute("contenteditable", "false")
    pill.style.userSelect = "text"
    pill.style.cursor = "default"
    return pill
  }

  const isNormalizedEditor = () =>
    Array.from(editorRef.childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ""
        if (!text.includes("\u200B")) return true
        if (text !== "\u200B") return false

        const prev = node.previousSibling
        const next = node.nextSibling
        const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
        return !!prevIsBr && !next
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      const el = node as HTMLElement
      if (el.dataset.type === "file") return true
      if (el.dataset.type === "agent") return true
      return el.tagName === "BR"
    })

  const renderEditor = (parts: Prompt) => {
    clearEditor()
    for (const part of parts) {
      if (part.type === "text") {
        editorRef.appendChild(createTextFragment(part.content))
        continue
      }
      if (part.type === "file" || part.type === "agent") {
        editorRef.appendChild(createPill(part))
      }
    }

    const last = editorRef.lastChild
    if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
      editorRef.appendChild(document.createTextNode("\u200B"))
    }
  }

  const scrollSlashActiveIntoView = () => {
    const activeId = slashActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector(`[data-slash-id="${activeId}"]`)
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  }
  const selectPopoverActive = () => {
    if (store.popover === "at") {
      const items = atFlat()
      if (items.length === 0) return
      const active = atActive()
      const item = items.find((entry) => atKey(entry) === active) ?? items[0]
      handleAtSelect(item)
      return
    }

    if (store.popover === "slash") {
      const items = slashFlat()
      if (items.length === 0) return
      const active = slashActive()
      const item = items.find((entry) => entry.id === active) ?? items[0]
      handleSlashSelect(item)
    }
  }

  const reconcile = (input: Prompt) => {
    if (mirror.input) {
      mirror.input = false
      if (isNormalizedEditor()) return

      renderEditorWithCursor(input)
      return
    }

    const dom = parseFromDOM()
    if (isNormalizedEditor() && isPromptEqual(input, dom)) return

    renderEditorWithCursor(input)
  }

  createEffect(
    on(
      () => prompt.current(),
      (parts) => {
        if (composing()) return
        reconcile(parts.filter((part) => part.type !== "image"))
      },
    ),
  )

  const parseFromDOM = (): Prompt => {
    const parts: Prompt = []
    let position = 0
    let buffer = ""

    const flushText = () => {
      let content = buffer
      if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
      if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
      buffer = ""
      if (!content) return
      parts.push({ type: "text", content, start: position, end: position + content.length })
      position += content.length
    }

    const pushFile = (file: HTMLElement) => {
      const content = file.textContent ?? ""
      const source =
        file.dataset.sourceType === "resource" && file.dataset.sourceClientName && file.dataset.sourceUri
          ? {
              type: "resource" as const,
              text: {
                value: content,
                start: position,
                end: position + content.length,
              },
              clientName: file.dataset.sourceClientName,
              uri: file.dataset.sourceUri,
            }
          : undefined
      parts.push({
        type: "file",
        path: file.dataset.path!,
        content,
        start: position,
        end: position + content.length,
        ...(file.dataset.mime ? { mime: file.dataset.mime } : {}),
        ...(file.dataset.filename ? { filename: file.dataset.filename } : {}),
        ...(file.dataset.url ? { url: file.dataset.url } : {}),
        ...(source ? { source } : {}),
      })
      position += content.length
    }

    const pushAgent = (agent: HTMLElement) => {
      const content = agent.textContent ?? ""
      parts.push({
        type: "agent",
        name: agent.dataset.name!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return

      const el = node as HTMLElement
      if (el.dataset.type === "file") {
        flushText()
        pushFile(el)
        return
      }
      if (el.dataset.type === "agent") {
        flushText()
        pushAgent(el)
        return
      }
      if (el.tagName === "BR") {
        buffer += "\n"
        return
      }

      for (const child of Array.from(el.childNodes)) {
        visit(child)
      }
    }

    const children = Array.from(editorRef.childNodes)
    children.forEach((child, index) => {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
      visit(child)
      if (isBlock && index < children.length - 1) {
        buffer += "\n"
      }
    })

    flushText()

    if (parts.length === 0) parts.push(...DEFAULT_PROMPT)
    return parts
  }

  const handleInput = () => {
    const rawParts = parseFromDOM()
    const images = imageAttachments()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText =
      rawParts.length === 1 && rawParts[0]?.type === "text"
        ? rawParts[0].content
        : rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const textContent = (editorRef.textContent ?? "").replace(/\u200B/g, "")
    const shouldReset =
      textContent.length === 0 && rawText.replace(/\n/g, "").length === 0 && !hasNonText && images.length === 0

    if (shouldReset) {
      closePopover()
      resetHistoryNavigation()
      if (prompt.dirty()) {
        mirror.input = true
        prompt.set(DEFAULT_PROMPT, 0)
      }
      queueScroll()
      return
    }

    const shellMode = store.mode === "shell"

    if (!shellMode) {
      const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
      const slashMatch = rawText.match(/^\/(\S*)$/)

      if (atMatch) {
        atOnInput(atMatch[1])
        setStore({ popover: "at", slashMenu: false, slashMenuQuery: "" })
      } else if (slashMatch) {
        slashOnInput(slashMatch[1])
        setStore({ popover: "slash", slashMenu: false, slashMenuQuery: "" })
      } else {
        closePopover()
      }
    } else {
      closePopover()
    }

    resetHistoryNavigation()

    mirror.input = true
    prompt.set([...rawParts, ...images], cursorPosition)
    queueScroll()
  }

  const addPart = (part: ContentPart) => {
    if (part.type === "image") return false

    const selection = window.getSelection()
    if (!selection) return false

    if (selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) {
      editorRef.focus()
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      setCursorPosition(editorRef, cursor)
    }

    if (selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return false

    if (part.type === "file" || part.type === "agent") {
      const cursorPosition = getCursorPosition(editorRef)
      const rawText = prompt
        .current()
        .map((p) => ("content" in p ? p.content : ""))
        .join("")
      const textBeforeCursor = rawText.substring(0, cursorPosition)
      const atMatch = textBeforeCursor.match(/@(\S*)$/)
      const pill = createPill(part)
      const gap = document.createTextNode(" ")

      if (atMatch) {
        const start = atMatch.index ?? cursorPosition - atMatch[0].length
        setRangeEdge(editorRef, range, "start", start)
        setRangeEdge(editorRef, range, "end", cursorPosition)
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    if (part.type === "text") {
      const fragment = createTextFragment(part.content)
      const last = fragment.lastChild
      range.deleteContents()
      range.insertNode(fragment)
      if (last) {
        if (last.nodeType === Node.TEXT_NODE) {
          const text = last.textContent ?? ""
          if (text === "\u200B") {
            range.setStart(last, 0)
          }
          if (text !== "\u200B") {
            range.setStart(last, text.length)
          }
        }
        if (last.nodeType !== Node.TEXT_NODE) {
          const isBreak = last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR"
          const next = last.nextSibling
          const emptyText = next?.nodeType === Node.TEXT_NODE && (next.textContent ?? "") === ""
          if (isBreak && (!next || emptyText)) {
            const placeholder = next && emptyText ? next : document.createTextNode("\u200B")
            if (!next) last.parentNode?.insertBefore(placeholder, null)
            placeholder.textContent = "\u200B"
            range.setStart(placeholder, 0)
          } else {
            range.setStartAfter(last)
          }
        }
      }
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    closePopover()
    return true
  }

  const openCommands = () => {
    const populated = prompt.dirty() || commentCount() > 0
    requestAnimationFrame(() => {
      if (!populated) {
        if (!addPart({ type: "text", content: "/", start: 0, end: 0 })) return
        slashOnInput("")
        setStore({ popover: "slash", slashMenu: false, slashMenuQuery: "" })
        return
      }
      slashOnInput("")
      setStore({ popover: "slash", slashMenu: true, slashMenuQuery: "" })
    })
  }

  const openContext = () => {
    requestAnimationFrame(() => {
      if (!addPart({ type: "text", content: "@", start: 0, end: 0 })) return
      atOnInput("")
      setStore({ popover: "at", slashMenu: false, slashMenuQuery: "" })
    })
  }

  const addToHistory = (prompt: Prompt, mode: "normal" | "shell") => {
    history.add(prompt, mode, mode === "shell" ? [] : historyComments())
  }

  createEffect(
    on(
      () => props.edit?.id,
      (id) => {
        const edit = props.edit
        if (!id || !edit) return

        for (const item of prompt.context.items()) {
          prompt.context.remove(item.key)
        }

        for (const item of edit.context) {
          prompt.context.add({
            type: item.type,
            path: item.path,
            selection: item.selection,
            comment: item.comment,
            commentID: item.commentID,
            commentOrigin: item.commentOrigin,
            preview: item.preview,
          })
        }

        setStore("mode", "normal")
        closePopover()
        setStore("historyIndex", -1)
        setStore("savedPrompt", null)
        prompt.set(edit.prompt, promptLength(edit.prompt))
        requestAnimationFrame(() => {
          editorRef.focus()
          setCursorPosition(editorRef, promptLength(edit.prompt))
          queueScroll()
        })
        props.onEditLoaded?.()
      },
      { defer: true },
    ),
  )

  const navigateHistory = (direction: "up" | "down") => {
    const result = navigatePromptHistory({
      direction,
      entries: history.entries(store.mode),
      historyIndex: store.historyIndex,
      currentPrompt: prompt.current(),
      currentComments: historyComments(),
      savedPrompt: store.savedPrompt,
    })
    if (!result.handled) return false
    setStore("historyIndex", result.historyIndex)
    setStore("savedPrompt", result.savedPrompt)
    applyHistoryPrompt(result.entry, result.cursor)
    return true
  }

  const { addAttachment, addAttachments, removeAttachment, handlePaste } = createPromptAttachments({
    prompt,
    editor: () => editorRef,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => {
      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
    },
    addPart,
    readClipboardImage: platform.readClipboardImage,
    getPathForFile: platform.getPathForFile,
  })

  const fileAttachmentInput = () => (
    <input
      ref={(el) => (fileInputRef = el)}
      type="file"
      multiple
      accept={ACCEPTED_FILE_TYPES.join(",")}
      class="hidden"
      onChange={(e) => {
        const list = e.currentTarget.files
        if (list) void addAttachments(Array.from(list))
        e.currentTarget.value = ""
      }}
    />
  )

  const variants = createMemo(() => ["default", ...props.controls.model.selection.variant.list()])
  // Check provider variants directly: `variants` also includes the UI-only default option.
  const showVariantControl = createMemo(() => props.controls.model.selection.variant.list().length > 0)
  const accepting = createMemo(() => {
    const id = props.controls.session.id
    if (!id) return permission.isAutoAcceptingDirectory(sdk().directory)
    return permission.isAutoAccepting(id, sdk().directory)
  })

  const { abort, handleSubmit } =
    props.submission ??
    createPromptSubmit({
      prompt,
      info,
      imageAttachments,
      commentCount,
      autoAccept: () => accepting(),
      mode: () => store.mode,
      working,
      editor: () => editorRef,
      queueScroll,
      promptLength,
      addToHistory,
      resetHistoryNavigation: () => {
        resetHistoryNavigation(true)
      },
      setMode: (mode) => setStore("mode", mode),
      setPopover: (popover) => {
        if (!popover) return closePopover()
        setStore({ popover, slashMenu: false, slashMenuQuery: "" })
      },
      newSessionWorktree: () => props.newSessionWorktree,
      onNewSessionWorktreeReset: props.onNewSessionWorktreeReset,
      shouldQueue: props.shouldQueue,
      onQueue: props.onQueue,
      onAbort: props.onAbort,
      onSubmit: props.onSubmit,
      model: props.controls.model.selection,
    })

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (store.mode !== "normal") return
      pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    if (event.key === "!" && store.mode === "normal") {
      const cursorPosition = getCursorPosition(editorRef)
      if (cursorPosition === 0) {
        setStore("mode", "shell")
        closePopover()
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (store.mode === "shell") {
        setStore("mode", "normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (working()) {
        void abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (escBlur()) {
        editorRef.blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (store.mode === "shell") {
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        setStore("mode", "normal")
        event.preventDefault()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    // and should always insert a newline regardless of composition state
    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (store.popover) {
      if (event.key === "Tab") {
        selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (store.popover === "at") {
          atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "slash") {
          slashOnKeyDown(event)
          if (event.key === "ArrowUp" || event.key === "ArrowDown" || ctrlNav) {
            scrollSlashActiveIntoView()
          }
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        return
      }
      if (working()) {
        void abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(editorRef)
      const textContent = prompt
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, store.historyIndex >= 0)) return
      if (navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat) return
      if (
        working() &&
        prompt
          .current()
          .map((part) => ("content" in part ? part.content : ""))
          .join("")
          .trim().length === 0 &&
        imageAttachments().length === 0 &&
        commentCount() === 0
      ) {
        return
      }
      void handleSubmit(event)
    }
  }

  const handleSlashMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePopover()
      requestAnimationFrame(() => editorRef.focus())
      event.preventDefault()
      return
    }

    if (event.key === "Tab") {
      selectPopoverActive()
      event.preventDefault()
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
    const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
    if (!nav && !ctrlNav) return
    slashOnKeyDown(event)
    if (event.key === "ArrowUp" || event.key === "ArrowDown" || ctrlNav) scrollSlashActiveIntoView()
    event.preventDefault()
  }

  const agentsLoading = () => props.controls.agents.loading
  const agentsShouldFadeIn = createMemo<boolean>((prev) => prev ?? agentsLoading())
  const providersLoading = () => props.controls.model.loading
  const providersShouldFadeIn = createMemo<boolean>((prev) => prev ?? providersLoading())

  const [promptReady] = createResource(
    () => prompt.ready.promise,
    (p) => p,
  )

  const designPlaceholder = () => {
    if (store.mode === "shell") return placeholder()
    return "Ask anything, / for commands, @ for context..."
  }

  const modelControlState = createMemo<ComposerModelControlState>(() => ({
    loading: providersLoading(),
    shouldAnimate: providersShouldFadeIn(),
    paid: props.controls.model.paid,
    title: language.t("command.model.choose"),
    keybind: command.keybindParts("model.choose"),
    model: props.controls.model.selection,
    providerID: props.controls.model.selection.current()?.provider?.id,
    modelName: props.controls.model.selection.current()?.name ?? language.t("dialog.model.select.title"),
    newLayoutDesigns: props.controls.newLayoutDesigns,
    style: control(),
    onClose: restoreFocus,
    onUnpaidClick: () => {
      if (props.controls.newLayoutDesigns) {
        dialog.show(() => <DialogSelectModelUnpaidV2 model={props.controls.model.selection} />)
        return
      }
      dialog.show(() => <DialogSelectModelUnpaid model={props.controls.model.selection} />)
    },
  }))

  const newSession = () => props.variant === "new-session"
  const bindEditorRef = (el: HTMLDivElement) => {
    editorRef = el
    restoreEndOnFocus = true
    props.ref?.(el)
  }
  const showAgentControl = createMemo(() => props.controls.agents.visible && props.controls.agents.options.length > 0)
  const agentControlState = createMemo<ComposerAgentControlState>(() => ({
    title: language.t("command.agent.cycle"),
    keybind: command.keybindParts("agent.cycle"),
    options: props.controls.agents.options,
    current: props.controls.agents.current,
    style: control(),
    onSelect: (value) => {
      props.controls.agents.select(value)
      restoreFocus()
    },
  }))
  return (
    <div class="relative size-full flex flex-col gap-0">
      {(promptReady(), null)}
      <PromptPopover
        popover={store.popover}
        setSlashPopoverRef={(el) => (slashPopoverRef = el)}
        atFlat={atFlat()}
        atActive={atActive() ?? undefined}
        atKey={atKey}
        setAtActive={setAtActive}
        onAtSelect={handleAtSelect}
        slashFlat={slashFlat()}
        slashActive={slashActive() ?? undefined}
        setSlashActive={setSlashActive}
        onSlashSelect={handleSlashSelect}
        slashMenu={store.slashMenu}
        slashMenuQuery={store.slashMenuQuery}
        onSlashMenuInput={(value) => {
          setStore("slashMenuQuery", value)
          slashOnInput(value)
        }}
        onSlashMenuKeyDown={handleSlashMenuKeyDown}
        commandKeybind={command.keybind}
        commandKeybindParts={command.keybindParts}
        newLayoutDesigns={props.controls.newLayoutDesigns}
        t={(key) => language.t(key as Parameters<typeof language.t>[0])}
      />
      <Switch>
        <Match when={props.controls.newLayoutDesigns}>
          <div class="flex flex-col gap-3">
            <DockShellForm
              data-component={newSession() ? "session-new-composer" : "session-composer"}
              onSubmit={handleSubmit}
              classList={{
                "group/prompt-input min-h-[96px] w-full rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]": true,
                "border-icon-info-active border-dashed": store.draggingType !== null,
                [props.class ?? ""]: !!props.class,
              }}
            >
              <PromptDragOverlay
                type={store.draggingType}
                label={language.t(
                  store.draggingType === "@mention" ? "prompt.dropzone.file.label" : "prompt.dropzone.label",
                )}
              />
              <PromptContextItems
                items={contextItems().filter((item) => !isCommentItem(item))}
                active={(item) => {
                  const active = comments.active()
                  return !!item.commentID && item.commentID === active?.id && item.path === active?.file
                }}
                openComment={openComment}
                remove={(item) => {
                  if (item.commentID) comments.remove(item.path, item.commentID)
                  prompt.context.remove(item.key)
                }}
                newLayoutDesigns={props.controls.newLayoutDesigns}
                t={(key) => language.t(key as Parameters<typeof language.t>[0])}
              />
              <PromptImageAttachments
                attachments={imageAttachments()}
                onOpen={(attachment) =>
                  dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
                }
                onRemove={removeAttachment}
                removeLabel={language.t("prompt.attachment.remove")}
                newLayoutDesigns={props.controls.newLayoutDesigns}
                comments={contextItems().filter(isCommentItem)}
                commentActive={(item) => {
                  const active = comments.active()
                  return !!item.commentID && item.commentID === active?.id && item.path === active?.file
                }}
                onOpenComment={openComment}
                onRemoveComment={(item) => {
                  if (item.commentID) comments.remove(item.path, item.commentID)
                  prompt.context.remove(item.key)
                }}
              />
              <div
                class="relative min-h-[52px]"
                onMouseDown={(e) => {
                  const target = e.target
                  if (!(target instanceof HTMLElement)) return
                  if (target.closest('[data-action^="prompt-"]')) return
                  editorRef?.focus()
                }}
              >
                <div class="relative max-h-[180px] overflow-y-auto no-scrollbar" ref={(el) => (scrollRef = el)}>
                  <div
                    data-component="prompt-input"
                    ref={bindEditorRef}
                    role="textbox"
                    aria-multiline="true"
                    aria-label={designPlaceholder()}
                    contenteditable="true"
                    autocapitalize={store.mode === "normal" ? "sentences" : "off"}
                    autocorrect={store.mode === "normal" ? "on" : "off"}
                    spellcheck={store.mode === "normal"}
                    inputMode="text"
                    // @ts-expect-error
                    autocomplete="off"
                    onInput={handleInput}
                    onPaste={handlePaste}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    classList={{
                      "select-text": true,
                      "min-h-[52px] w-full px-4 pt-4 pb-2 focus:outline-none whitespace-pre-wrap leading-5 text-[13px] font-[440] text-v2-text-text-base": true,
                      "[&_[data-type=file]]:text-syntax-property": true,
                      "[&_[data-type=agent]]:text-syntax-type": true,
                      "font-mono!": store.mode === "shell",
                    }}
                  />
                  <div
                    data-component={newSession() ? "session-new-design-text" : "session-composer-text"}
                    class="absolute top-0 inset-x-0 px-4 pt-4 pointer-events-none whitespace-nowrap truncate leading-5 text-[13px] font-[440] text-v2-text-text-faint [font-family:Inter,var(--font-family-sans)]"
                    classList={{ "font-mono!": store.mode === "shell", hidden: prompt.dirty() }}
                  >
                    {designPlaceholder()}
                  </div>
                </div>
              </div>
              <div class="flex h-11 items-center px-2">
                <div class="flex min-w-0 flex-1 items-center gap-1">
                  {fileAttachmentInput()}
                  <TooltipV2
                    placement="top"
                    value={
                      <>
                        {language.t("prompt.menu.addImagesAndFiles")}
                        <KeybindV2 keys={command.keybindParts("file.attach")} variant="neutral" />
                      </>
                    }
                  >
                    <MenuV2 gutter={6} modal={false} placement="top-start">
                      <MenuV2.Trigger
                        as={IconButtonV2}
                        data-action="prompt-attach"
                        type="button"
                        icon={<IconV2 name="plus" />}
                        variant="ghost-muted"
                        size="large"
                        style={buttons()}
                        disabled={store.mode !== "normal"}
                        tabIndex={store.mode === "normal" ? undefined : -1}
                        aria-label={language.t("prompt.menu.addImagesAndFiles")}
                      />
                      <MenuV2.Portal>
                        <MenuV2.Content style={{ "min-width": "180px" }}>
                          <MenuV2.Item onSelect={pick} shortcut={command.keybind("file.attach")}>
                            {language.t("prompt.menu.imagesAndFiles")}
                          </MenuV2.Item>
                          <MenuV2.Separator />
                          <MenuV2.Item onSelect={openCommands} shortcut="/">
                            {language.t("prompt.menu.commands")}
                          </MenuV2.Item>
                          <MenuV2.Item onSelect={openContext} shortcut="@">
                            {language.t("prompt.menu.context")}
                          </MenuV2.Item>
                          <MenuV2.Item onSelect={() => setMode("shell")} shortcut="!">
                            {language.t("prompt.menu.shellCommand")}
                          </MenuV2.Item>
                        </MenuV2.Content>
                      </MenuV2.Portal>
                    </MenuV2>
                  </TooltipV2>
                  <Show when={showAgentControl()}>
                    <ComposerAgentControl state={agentControlState()} />
                  </Show>
                  {props.toolbar}
                  <ComposerModelControl state={modelControlState()} />
                  <Show when={!providersLoading() && store.mode !== "shell" && showVariantControl()}>
                    <div
                      data-component="prompt-variant-control"
                      class="[&_[data-action=prompt-model-variant]]:![font-weight:440]"
                      classList={{
                        "animate-in fade-in": providersShouldFadeIn(),
                        "hidden group-hover/prompt-input:block group-focus-within/prompt-input:block":
                          !props.controls.model.selection.variant.current() && !store.variantOpen,
                      }}
                    >
                      <TooltipV2
                        placement="top"
                        gutter={4}
                        value={
                          <>
                            {language.t("command.model.variant.cycle")}
                            <KeybindV2 keys={command.keybindParts("model.variant.cycle")} variant="neutral" />
                          </>
                        }
                      >
                        <MenuV2
                          gutter={6}
                          modal={false}
                          placement="top-start"
                          onOpenChange={(open) => setStore("variantOpen", open)}
                        >
                          <MenuV2.Trigger
                            as={ButtonV2}
                            data-action="prompt-model-variant"
                            variant="ghost-muted"
                            size="normal"
                            class="max-w-[160px] justify-start capitalize"
                            style={control()}
                          >
                            <span class="truncate leading-5">
                              {props.controls.model.selection.variant.current() ?? language.t("common.default")}
                            </span>
                            <span class="-ml-0.5 -mr-1 flex shrink-0">
                              <Icon name="chevron-down" size="small" />
                            </span>
                          </MenuV2.Trigger>
                          <MenuV2.Portal>
                            <MenuV2.Content>
                              <MenuV2.RadioGroup
                                value={props.controls.model.selection.variant.current() ?? "default"}
                                onChange={(value) => {
                                  props.controls.model.selection.variant.set(value === "default" ? undefined : value)
                                  restoreFocus()
                                }}
                              >
                                {variants().map((value) => (
                                  <MenuV2.RadioItem value={value} class="capitalize">
                                    {value === "default" ? language.t("common.default") : value}
                                  </MenuV2.RadioItem>
                                ))}
                              </MenuV2.RadioGroup>
                            </MenuV2.Content>
                          </MenuV2.Portal>
                        </MenuV2>
                      </TooltipV2>
                    </div>
                  </Show>
                </div>
                <TooltipV2 placement="top" inactive={!working() && blank()} value={tip()}>
                  <IconButton
                    data-action="prompt-submit"
                    type="submit"
                    disabled={!working() && blank()}
                    tabIndex={store.mode === "normal" ? undefined : -1}
                    icon={stopping() ? "stop" : store.mode === "shell" ? "arrow-undo-down" : "arrow-up"}
                    variant="primary"
                    class="size-7 rounded-md p-[6px] text-v2-icon-icon-muted shadow-[var(--v2-elevation-button-contrast)] disabled:opacity-50"
                    style={{
                      "background-image":
                        "linear-gradient(180deg,var(--v2-alpha-light-20) 0%,var(--v2-alpha-light-0) 100%),linear-gradient(90deg,var(--v2-background-bg-contrast) 0%,var(--v2-background-bg-contrast) 100%)",
                    }}
                    aria-label={stopping() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
                  />
                </TooltipV2>
              </div>
            </DockShellForm>
          </div>
        </Match>
        <Match when>
          <DockShellForm
            onSubmit={handleSubmit}
            classList={{
              "group/prompt-input": true,
              "focus-within:shadow-xs-border": true,
              "border-icon-info-active border-dashed": store.draggingType !== null,
              [props.class ?? ""]: !!props.class,
            }}
          >
            <PromptDragOverlay
              type={store.draggingType}
              label={language.t(
                store.draggingType === "@mention" ? "prompt.dropzone.file.label" : "prompt.dropzone.label",
              )}
            />
            <PromptContextItems
              items={contextItems()}
              active={(item) => {
                const active = comments.active()
                return !!item.commentID && item.commentID === active?.id && item.path === active?.file
              }}
              openComment={openComment}
              remove={(item) => {
                if (item.commentID) comments.remove(item.path, item.commentID)
                prompt.context.remove(item.key)
              }}
              newLayoutDesigns={props.controls.newLayoutDesigns}
              t={(key) => language.t(key as Parameters<typeof language.t>[0])}
            />
            <PromptImageAttachments
              attachments={imageAttachments()}
              onOpen={(attachment) =>
                dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
              }
              onRemove={removeAttachment}
              removeLabel={language.t("prompt.attachment.remove")}
              newLayoutDesigns={props.controls.newLayoutDesigns}
            />
            <div
              class="relative"
              onMouseDown={(e) => {
                const target = e.target
                if (!(target instanceof HTMLElement)) return
                if (target.closest('[data-action="prompt-attach"], [data-action="prompt-submit"]')) {
                  return
                }
                editorRef?.focus()
              }}
            >
              <div
                class="relative max-h-[240px] overflow-y-auto no-scrollbar"
                ref={(el) => (scrollRef = el)}
                style={{ "scroll-padding-bottom": space }}
              >
                <div
                  data-component="prompt-input"
                  ref={bindEditorRef}
                  role="textbox"
                  aria-multiline="true"
                  aria-label={placeholder()}
                  contenteditable="true"
                  autocapitalize={store.mode === "normal" ? "sentences" : "off"}
                  autocorrect={store.mode === "normal" ? "on" : "off"}
                  spellcheck={store.mode === "normal"}
                  inputMode="text"
                  // @ts-expect-error
                  autocomplete="off"
                  onInput={handleInput}
                  onPaste={handlePaste}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  classList={{
                    "select-text": true,
                    "w-full pl-3 pr-2 pt-2 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
                    "[&_[data-type=file]]:text-syntax-property": true,
                    "[&_[data-type=agent]]:text-syntax-type": true,
                    "font-mono!": store.mode === "shell",
                  }}
                  style={{ "padding-bottom": space }}
                />
                <div
                  class="absolute top-0 inset-x-0 pl-3 pr-2 pt-2 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
                  classList={{ "font-mono!": store.mode === "shell" }}
                  style={{ "padding-bottom": space, display: prompt.dirty() ? "none" : undefined }}
                >
                  {placeholder()}
                </div>
              </div>

              <div
                aria-hidden="true"
                class="pointer-events-none absolute inset-x-0 bottom-0"
                style={{
                  height: space,
                  background:
                    "linear-gradient(to top, var(--surface-raised-stronger-non-alpha) calc(100% - 20px), transparent)",
                }}
              />

              <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  class="hidden"
                  onChange={(e) => {
                    const list = e.currentTarget.files
                    if (list) void addAttachments(Array.from(list))
                    e.currentTarget.value = ""
                  }}
                />

                <div class="flex items-center gap-1 pointer-events-auto">
                  <Tooltip placement="top" inactive={!working() && blank()} value={tip()}>
                    <IconButton
                      data-action="prompt-submit"
                      type="submit"
                      disabled={!working() && blank()}
                      tabIndex={store.mode === "normal" ? undefined : -1}
                      icon={stopping() ? "stop" : store.mode === "shell" ? "arrow-undo-down" : "arrow-up"}
                      variant="primary"
                      class="size-8"
                      aria-label={stopping() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
                    />
                  </Tooltip>
                </div>
              </div>

              <div class="pointer-events-none absolute bottom-2 left-2">
                <div
                  aria-hidden={store.mode !== "normal"}
                  class="pointer-events-auto"
                  style={{
                    "pointer-events": buttonsSpring() > 0.5 ? "auto" : "none",
                  }}
                >
                  <TooltipKeybind
                    placement="top"
                    title={language.t("prompt.action.attachFile")}
                    keybind={command.keybind("file.attach")}
                  >
                    <Button
                      data-action="prompt-attach"
                      type="button"
                      variant="ghost"
                      class="size-8 p-0"
                      style={buttons()}
                      onClick={pick}
                      disabled={store.mode !== "normal"}
                      tabIndex={store.mode === "normal" ? undefined : -1}
                      aria-label={language.t("prompt.action.attachFile")}
                    >
                      <Icon name="plus" class="size-4.5" />
                    </Button>
                  </TooltipKeybind>
                </div>
              </div>
            </div>
          </DockShellForm>
          <Show when={store.mode === "normal" || store.mode === "shell"}>
            <DockTray attach="top">
              <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
                <div class="flex items-center gap-1.5 min-w-0 flex-1 relative">
                  <div
                    class="h-7 flex items-center gap-1.5 min-w-0 absolute inset-0"
                    style={{
                      padding: "0 0px 0 8px",
                      ...shell(),
                    }}
                  >
                    <Icon name="console" />
                    <span class="truncate text-13-medium text-text-base">{language.t("prompt.mode.shell")}</span>
                    <div class="flex-1" />
                    <Button
                      variant="ghost"
                      class="text-text-base"
                      onClick={() => {
                        setStore("mode", "normal")
                      }}
                    >
                      {language.t("common.cancel")}
                    </Button>
                  </div>
                  <div class="flex items-center gap-1.5 min-w-0 flex-1 h-7">
                    <Show when={!agentsLoading()}>
                      <div
                        data-component="prompt-agent-control"
                        classList={{ "animate-in fade-in duration-300": agentsShouldFadeIn() }}
                      >
                        <TooltipKeybind
                          placement="top"
                          gutter={4}
                          title={language.t("command.agent.cycle")}
                          keybind={command.keybind("agent.cycle")}
                        >
                          <Select
                            size="normal"
                            options={props.controls.agents.options}
                            current={props.controls.agents.current}
                            onSelect={(value) => {
                              props.controls.agents.select(value)
                              restoreFocus()
                            }}
                            class="capitalize max-w-[160px] text-text-base"
                            valueClass="truncate text-13-regular text-text-base"
                            triggerStyle={control()}
                            triggerProps={{ "data-action": "prompt-agent" }}
                            variant="ghost"
                          />
                        </TooltipKeybind>
                      </div>
                    </Show>
                    <Show when={!providersLoading()}>
                      <Show when={store.mode !== "shell"}>
                        <div
                          data-component="prompt-model-control"
                          classList={{ "animate-in fade-in duration-300": providersShouldFadeIn() }}
                        >
                          <Show
                            when={props.controls.model.paid}
                            fallback={
                              <TooltipKeybind
                                placement="top"
                                gutter={4}
                                title={language.t("command.model.choose")}
                                keybind={command.keybind("model.choose")}
                              >
                                <Button
                                  data-action="prompt-model"
                                  as="div"
                                  variant="ghost"
                                  size="normal"
                                  class="min-w-0 max-w-[320px] text-13-regular text-text-base group"
                                  style={control()}
                                  onClick={() => {
                                    dialog.show(() => (
                                      <DialogSelectModelUnpaid model={props.controls.model.selection} />
                                    ))
                                  }}
                                >
                                  <Show when={props.controls.model.selection.current()?.provider?.id}>
                                    <ProviderIcon
                                      id={props.controls.model.selection.current()?.provider?.id ?? ""}
                                      class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                                      style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                                    />
                                  </Show>
                                  <span class="truncate">
                                    {props.controls.model.selection.current()?.name ??
                                      language.t("dialog.model.select.title")}
                                  </span>
                                  <Icon name="chevron-down" size="small" class="shrink-0" />
                                </Button>
                              </TooltipKeybind>
                            }
                          >
                            <TooltipKeybind
                              placement="top"
                              gutter={4}
                              title={language.t("command.model.choose")}
                              keybind={command.keybind("model.choose")}
                            >
                              <ModelSelectorPopover
                                model={props.controls.model.selection}
                                triggerAs={Button}
                                triggerProps={{
                                  variant: "ghost",
                                  size: "normal",
                                  style: control(),
                                  class: "min-w-0 max-w-[320px] text-13-regular text-text-base group",
                                  "data-action": "prompt-model",
                                }}
                                onClose={restoreFocus}
                              >
                                <Show when={props.controls.model.selection.current()?.provider?.id}>
                                  <ProviderIcon
                                    id={props.controls.model.selection.current()?.provider?.id ?? ""}
                                    class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                                    style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                                  />
                                </Show>
                                <span class="truncate">
                                  {props.controls.model.selection.current()?.name ??
                                    language.t("dialog.model.select.title")}
                                </span>
                                <Icon name="chevron-down" size="small" class="shrink-0" />
                              </ModelSelectorPopover>
                            </TooltipKeybind>
                          </Show>
                        </div>
                        <Show when={showVariantControl()}>
                          <div
                            data-component="prompt-variant-control"
                            classList={{ "animate-in fade-in duration-300": providersShouldFadeIn() }}
                          >
                            <TooltipKeybind
                              placement="top"
                              gutter={4}
                              title={language.t("command.model.variant.cycle")}
                              keybind={command.keybind("model.variant.cycle")}
                            >
                              <Select
                                size="normal"
                                options={variants()}
                                current={props.controls.model.selection.variant.current() ?? "default"}
                                label={(x) => (x === "default" ? language.t("common.default") : x)}
                                onSelect={(value) => {
                                  props.controls.model.selection.variant.set(value === "default" ? undefined : value)
                                  restoreFocus()
                                }}
                                class="capitalize max-w-[160px] text-text-base"
                                valueClass="truncate text-13-regular text-text-base"
                                triggerStyle={control()}
                                triggerProps={{ "data-action": "prompt-model-variant" }}
                                variant="ghost"
                              />
                            </TooltipKeybind>
                          </div>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                </div>
              </div>
            </DockTray>
          </Show>
        </Match>
      </Switch>
    </div>
  )
}

type ComposerAgentControlState = {
  title: string
  keybind: string[]
  options: string[]
  current: string
  style: JSX.CSSProperties | undefined
  onSelect: (value: string | undefined) => void
}

type ComposerModelControlState = {
  loading: boolean
  shouldAnimate: boolean
  paid: boolean
  title: string
  keybind: string[]
  model: ReturnType<typeof useLocal>["model"]
  providerID?: string
  modelName: string
  newLayoutDesigns: boolean
  style: JSX.CSSProperties | undefined
  onClose: () => void
  onUnpaidClick: () => void
}

function ComposerAgentControl(props: { state: ComposerAgentControlState }) {
  return (
    <div class="relative">
      <div class="pointer-events-none absolute left-2 top-1/2 z-10 flex size-4 -translate-y-1/2 items-center justify-center text-v2-icon-icon-muted">
        <Icon name="sliders" size="small" />
      </div>
      <TooltipV2
        placement="top"
        gutter={4}
        value={
          <>
            {props.state.title}
            <KeybindV2 keys={props.state.keybind} variant="neutral" />
          </>
        }
      >
        <Select
          size="normal"
          options={props.state.options}
          current={props.state.current}
          onSelect={props.state.onSelect}
          class="max-w-[175px] justify-start text-v2-text-text-faint [&_[data-component=icon]]:text-v2-icon-icon-muted"
          valueClass="truncate pl-5 text-[13px] font-[440] leading-5 text-v2-text-text-faint"
          triggerStyle={props.state.style}
          triggerProps={{ "data-action": "prompt-agent" }}
          variant="ghost"
        />
      </TooltipV2>
    </div>
  )
}

function ComposerModelControl(props: { state: ComposerModelControlState }) {
  return (
    <Show when={!props.state.loading}>
      <Show
        when={props.state.paid}
        fallback={
          <TooltipV2
            placement="top"
            gutter={4}
            value={
              <>
                {props.state.title}
                <KeybindV2 keys={props.state.keybind} variant="neutral" />
              </>
            }
          >
            <Show
              when={props.state.newLayoutDesigns}
              fallback={
                <Button
                  data-action="prompt-model"
                  as="div"
                  variant="ghost"
                  size="normal"
                  class="min-w-0 max-w-[220px] justify-start text-[13px] font-[440] leading-5 text-v2-text-text-faint group"
                  classList={{ "animate-in fade-in": props.state.shouldAnimate }}
                  style={props.state.style}
                  onClick={props.state.onUnpaidClick}
                >
                  <Show when={props.state.providerID}>
                    {(providerID) => (
                      <ProviderIcon
                        id={providerID()}
                        class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                        style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                      />
                    )}
                  </Show>
                  <span class="truncate">{props.state.modelName}</span>
                  <span class="-ml-1 shrink-0 flex size-fit">
                    <Icon name="chevron-down" size="small" class="text-v2-icon-icon-muted" />
                  </span>
                </Button>
              }
            >
              <ButtonV2
                data-action="prompt-model"
                variant="ghost-muted"
                size="normal"
                class="min-w-0 max-w-[220px] justify-start ![font-weight:440] group"
                classList={{ "animate-in fade-in": props.state.shouldAnimate }}
                style={props.state.style}
                onClick={props.state.onUnpaidClick}
              >
                <ModelControlContent state={props.state} v2 />
              </ButtonV2>
            </Show>
          </TooltipV2>
        }
      >
        <TooltipV2
          placement="top"
          gutter={4}
          value={
            <>
              {props.state.title}
              <KeybindV2 keys={props.state.keybind} variant="neutral" />
            </>
          }
        >
          <Show
            when={props.state.newLayoutDesigns}
            fallback={
              <ModelSelectorPopover
                model={props.state.model}
                triggerAs={Button}
                triggerProps={{
                  variant: "ghost",
                  size: "normal",
                  style: props.state.style,
                  class:
                    "min-w-0 max-w-[220px] justify-start text-[13px] font-[440] leading-5 text-v2-text-text-faint group",
                  classList: { "animate-in fade-in": props.state.shouldAnimate },
                  "data-action": "prompt-model",
                }}
                onClose={props.state.onClose}
              >
                <ModelControlContent state={props.state} />
              </ModelSelectorPopover>
            }
          >
            <ModelSelectorPopoverV2
              model={props.state.model}
              triggerAs={ButtonV2}
              triggerProps={{
                variant: "ghost-muted",
                size: "normal",
                style: props.state.style,
                class: "min-w-0 max-w-[220px] justify-start ![font-weight:440] group",
                classList: { "animate-in fade-in": props.state.shouldAnimate },
                "data-action": "prompt-model",
              }}
              onClose={props.state.onClose}
            >
              <ModelControlContent state={props.state} v2 />
            </ModelSelectorPopoverV2>
          </Show>
        </TooltipV2>
      </Show>
    </Show>
  )
}

function ModelControlContent(props: { state: ComposerModelControlState; v2?: boolean }) {
  return (
    <>
      <Show when={props.state.providerID}>
        {(providerID) => (
          <ProviderIcon
            id={providerID()}
            class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
            style={{ "will-change": "opacity", transform: "translateZ(0)" }}
          />
        )}
      </Show>
      <span class="truncate leading-4">{props.state.modelName}</span>
      <span class={props.v2 ? "-ml-0.5 -mr-1 flex shrink-0" : "-ml-1 shrink-0 flex size-fit"}>
        <Icon name="chevron-down" size="small" class="text-v2-icon-icon-muted" />
      </span>
    </>
  )
}
