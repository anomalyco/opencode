import { useFilteredList } from "@opencode-ai/ui/hooks"
import {
  createEffect,
  on,
  Component,
  Show,
  For,
  onMount,
  onCleanup,
  Switch,
  Match,
  createMemo,
  createSignal,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createFocusSignal } from "@solid-primitives/active-element"
import { useLocal } from "@/context/local"
import { useFile, type FileSelection } from "@/context/file"
import {
  ContentPart,
  DEFAULT_PROMPT,
  isPromptEqual,
  Prompt,
  usePrompt,
  ImageAttachmentPart,
  AgentPart,
  FileAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useComments } from "@/context/comments"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { getDirectory, getFilename, getFilenameTruncated } from "@opencode-ai/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { DialogSelectModelUnpaid } from "@/components/dialog-select-model-unpaid"
import { useProviders } from "@/hooks/use-providers"
import { useCommand } from "@/context/command"
import { Persist, persisted } from "@/utils/persist"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { createOpencodeClient, type Message, type Part } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/util/binary"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  onSubmit?: () => void
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

interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  keybind?: string
  type: "builtin" | "custom"
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const platform = usePlatform()
  const local = useLocal()
  const files = useFile()
  const prompt = usePrompt()
  const commentCount = createMemo(() => prompt.context.items().filter((item) => !!item.comment?.trim()).length)
  const layout = useLayout()
  const comments = useComments()
  const params = useParams()
  const dialog = useDialog()
  const providers = useProviders()
  const command = useCommand()
  const permission = usePermission()
  const language = useLanguage()
  let editorRef!: HTMLDivElement
  let fileInputRef!: HTMLInputElement
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement

  const mirror = { input: false }

  const scrollCursorIntoView = () => {
    const container = scrollRef
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const rect = range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
      container.scrollTop = Math.max(0, top - padding)
      return
    }

    if (bottom > container.scrollTop + container.clientHeight - padding) {
      container.scrollTop = bottom - container.clientHeight + padding
    }
  }

  const queueScroll = () => {
    requestAnimationFrame(scrollCursorIntoView)
  }

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))

  const commentInReview = (path: string) => {
    const sessionID = params.id
    if (!sessionID) return false

    const diffs = sync.data.session_diff[sessionID]
    if (!diffs) return false
    return diffs.some((diff) => diff.file === path)
  }

  const openComment = (item: { path: string; commentID?: string; commentOrigin?: "review" | "file" }) => {
    if (!item.commentID) return

    const focus = { file: item.path, id: item.commentID }
    comments.setActive(focus)

    const wantsReview = item.commentOrigin === "review" || (item.commentOrigin !== "file" && commentInReview(item.path))
    if (wantsReview) {
      layout.fileTree.setTab("changes")
      if (!layout.fileTree.opened()) tabs().open("review")
      requestAnimationFrame(() => comments.setFocus(focus))
      return
    }

    layout.fileTree.setTab("all")
    const tab = files.tab(item.path)
    tabs().open(tab)
    files.load(item.path)
    requestAnimationFrame(() => comments.setFocus(focus))
  }

  const recent = createMemo(() => {
    const all = tabs().all()
    const active = tabs().active()
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
  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const status = createMemo(
    () =>
      sync.data.session_status[params.id ?? ""] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status()?.type !== "idle")
  const imageAttachments = createMemo(
    () => prompt.current().filter((part) => part.type === "image") as ImageAttachmentPart[],
  )

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    historyIndex: number
    savedPrompt: Prompt | null
    placeholder: number
    dragging: boolean
    mode: "normal" | "shell"
    applyingHistory: boolean
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null,
    placeholder: Math.floor(Math.random() * EXAMPLES.length),
    dragging: false,
    mode: "normal",
    applyingHistory: false,
  })

  const MAX_HISTORY = 100
  const [history, setHistory] = persisted(
    Persist.global("prompt-history", ["prompt-history.v1"]),
    createStore<{
      entries: Prompt[]
    }>({
      entries: [],
    }),
  )
  const [shellHistory, setShellHistory] = persisted(
    Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
    createStore<{
      entries: Prompt[]
    }>({
      entries: [],
    }),
  )

  const clonePromptParts = (prompt: Prompt): Prompt =>
    prompt.map((part) => {
      if (part.type === "text") return { ...part }
      if (part.type === "image") return { ...part }
      if (part.type === "agent") return { ...part }
      return {
        ...part,
        selection: part.selection ? { ...part.selection } : undefined,
      }
    })

  const promptLength = (prompt: Prompt) =>
    prompt.reduce((len, part) => len + ("content" in part ? part.content.length : 0), 0)

  const applyHistoryPrompt = (p: Prompt, position: "start" | "end") => {
    const length = position === "start" ? 0 : promptLength(p)
    setStore("applyingHistory", true)
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

  const isFocused = createFocusSignal(() => editorRef)

  createEffect(() => {
    params.id
    if (params.id) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  const [composing, setComposing] = createSignal(false)
  const isImeComposing = (event: KeyboardEvent) => event.isComposing || composing() || event.keyCode === 229

  const addImageAttachment = async (file: File) => {
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const attachment: ImageAttachmentPart = {
        type: "image",
        id: crypto.randomUUID(),
        filename: file.name,
        mime: file.type,
        dataUrl,
      }
      const cursorPosition = prompt.cursor() ?? getCursorPosition(editorRef)
      prompt.set([...prompt.current(), attachment], cursorPosition)
    }
    reader.readAsDataURL(file)
  }

  const removeImageAttachment = (id: string) => {
    const current = prompt.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  const handlePaste = async (event: ClipboardEvent) => {
    if (!isFocused()) return
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    const items = Array.from(clipboardData.items)
    const fileItems = items.filter((item) => item.kind === "file")
    const imageItems = fileItems.filter((item) => ACCEPTED_FILE_TYPES.includes(item.type))

    if (imageItems.length > 0) {
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) await addImageAttachment(file)
      }
      return
    }

    if (fileItems.length > 0) {
      showToast({
        title: language.t("prompt.toast.pasteUnsupported.title"),
        description: language.t("prompt.toast.pasteUnsupported.description"),
      })
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""
    if (!plainText) return
    addPart({ type: "text", content: plainText, start: 0, end: 0 })
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (dialog.active) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    if (hasFiles) {
      setStore("dragging", true)
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (dialog.active) return

    // relatedTarget is null when leaving the document window
    if (!event.relatedTarget) {
      setStore("dragging", false)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (dialog.active) return

    event.preventDefault()
    setStore("dragging", false)

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    for (const file of Array.from(dropped)) {
      if (ACCEPTED_FILE_TYPES.includes(file.type)) {
        await addImageAttachment(file)
      }
    }
  }

  onMount(() => {
    document.addEventListener("dragover", handleGlobalDragOver)
    document.addEventListener("dragleave", handleGlobalDragLeave)
    document.addEventListener("drop", handleGlobalDrop)
  })
  onCleanup(() => {
    document.removeEventListener("dragover", handleGlobalDragOver)
    document.removeEventListener("dragleave", handleGlobalDragLeave)
    document.removeEventListener("drop", handleGlobalDrop)
  })

  createEffect(() => {
    if (!isFocused()) setStore("popover", null)
  })

  // Safety: reset composing state on focus change to prevent stuck state
  // This handles edge cases where compositionend event may not fire
  createEffect(() => {
    if (!isFocused()) setComposing(false)
  })

  type AtOption =
    | { type: "agent"; name: string; display: string }
    | { type: "file"; path: string; display: string; recent?: boolean }

  const agentList = createMemo(() =>
    sync.data.agent
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent): AtOption => ({ type: "agent", name: agent.name, display: agent.name })),
  )

  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    if (option.type === "agent") {
      addPart({ type: "agent", name: option.name, content: "@" + option.name, start: 0, end: 0 })
    } else {
      addPart({ type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 })
    }
  }

  const atKey = (x: AtOption | undefined) => {
    if (!x) return ""
    return x.type === "agent" ? `agent:${x.name}` : `file:${x.path}`
  }

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) => {
      const agents = agentList()
      const open = recent()
      const seen = new Set(open)
      const pinned: AtOption[] = open.map((path) => ({ type: "file", path, display: path, recent: true }))
      const paths = await files.searchFilesAndDirectories(query)
      const fileOptions: AtOption[] = paths
        .filter((path) => !seen.has(path))
        .map((path) => ({ type: "file", path, display: path }))
      return [...agents, ...pinned, ...fileOptions]
    },
    key: atKey,
    filterKeys: ["display"],
    groupBy: (item) => {
      if (item.type === "agent") return "agent"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const rank = (category: string) => {
        if (category === "agent") return 0
        if (category === "recent") return 1
        return 2
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

    const custom = sync.data.command.map((cmd) => ({
      id: `custom.${cmd.name}`,
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      type: "custom" as const,
    }))

    return [...custom, ...builtin]
  })

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    setStore("popover", null)

    if (cmd.type === "custom") {
      const text = `/${cmd.trigger} `
      editorRef.innerHTML = ""
      editorRef.textContent = text
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      requestAnimationFrame(() => {
        editorRef.focus()
        const range = document.createRange()
        const sel = window.getSelection()
        range.selectNodeContents(editorRef)
        range.collapse(false)
        sel?.removeAllRanges()
        sel?.addRange(range)
      })
      return
    }

    editorRef.innerHTML = ""
    prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    command.trigger(cmd.id, "slash")
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
    refetch: slashRefetch,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title", "description"],
    onSelect: handleSlashSelect,
  })

  const createPill = (part: FileAttachmentPart | AgentPart) => {
    const pill = document.createElement("span")
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    if (part.type === "file") pill.setAttribute("data-path", part.path)
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
        const nextIsBr = next?.nodeType === Node.ELEMENT_NODE && (next as HTMLElement).tagName === "BR"
        if (!prevIsBr && !nextIsBr) return false
        if (nextIsBr && !prevIsBr && prev) return false
        return true
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      const el = node as HTMLElement
      if (el.dataset.type === "file") return true
      if (el.dataset.type === "agent") return true
      return el.tagName === "BR"
    })

  const renderEditor = (parts: Prompt) => {
    editorRef.innerHTML = ""
    for (const part of parts) {
      if (part.type === "text") {
        editorRef.appendChild(createTextFragment(part.content))
        continue
      }
      if (part.type === "file" || part.type === "agent") {
        editorRef.appendChild(createPill(part))
      }
    }
  }

  createEffect(
    on(
      () => sync.data.command,
      () => slashRefetch(),
      { defer: true },
    ),
  )

  // Auto-scroll active command into view when navigating with keyboard
  createEffect(() => {
    const activeId = slashActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector(`[data-slash-id="${activeId}"]`)
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  })

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

  createEffect(
    on(
      () => prompt.current(),
      (currentParts) => {
        const inputParts = currentParts.filter((part) => part.type !== "image") as Prompt

        if (mirror.input) {
          mirror.input = false
          if (isNormalizedEditor()) return

          const selection = window.getSelection()
          let cursorPosition: number | null = null
          if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
            cursorPosition = getCursorPosition(editorRef)
          }

          renderEditor(inputParts)

          if (cursorPosition !== null) {
            setCursorPosition(editorRef, cursorPosition)
          }
          return
        }

        const domParts = parseFromDOM()
        if (isNormalizedEditor() && isPromptEqual(inputParts, domParts)) return

        const selection = window.getSelection()
        let cursorPosition: number | null = null
        if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
          cursorPosition = getCursorPosition(editorRef)
        }

        renderEditor(inputParts)

        if (cursorPosition !== null) {
          setCursorPosition(editorRef, cursorPosition)
        }
      },
    ),
  )

  const parseFromDOM = (): Prompt => {
    const parts: Prompt = []
    let position = 0
    let buffer = ""

    const flushText = () => {
      const content = buffer.replace(/\r\n?/g, "\n").replace(/\u200B/g, "")
      buffer = ""
      if (!content) return
      parts.push({ type: "text", content, start: position, end: position + content.length })
      position += content.length
    }

    const pushFile = (file: HTMLElement) => {
      const content = file.textContent ?? ""
      parts.push({
        type: "file",
        path: file.dataset.path!,
        content,
        start: position,
        end: position + content.length,
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
    const rawText = rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const trimmed = rawText.replace(/\u200B/g, "").trim()
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const shouldReset = trimmed.length === 0 && !hasNonText && images.length === 0

    if (shouldReset) {
      setStore("popover", null)
      if (store.historyIndex >= 0 && !store.applyingHistory) {
        setStore("historyIndex", -1)
        setStore("savedPrompt", null)
      }
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
        setStore("popover", "at")
      } else if (slashMatch) {
        slashOnInput(slashMatch[1])
        setStore("popover", "slash")
      } else {
        setStore("popover", null)
      }
    } else {
      setStore("popover", null)
    }

    if (store.historyIndex >= 0 && !store.applyingHistory) {
      setStore("historyIndex", -1)
      setStore("savedPrompt", null)
    }

    mirror.input = true
    prompt.set([...rawParts, ...images], cursorPosition)
    queueScroll()
  }

  const setRangeEdge = (range: Range, edge: "start" | "end", offset: number) => {
    let remaining = offset
    const nodes = Array.from(editorRef.childNodes)

    for (const node of nodes) {
      const length = getNodeLength(node)
      const isText = node.nodeType === Node.TEXT_NODE
      const isPill =
        node.nodeType === Node.ELEMENT_NODE &&
        ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
      const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

      if (isText && remaining <= length) {
        if (edge === "start") range.setStart(node, remaining)
        if (edge === "end") range.setEnd(node, remaining)
        return
      }

      if ((isPill || isBreak) && remaining <= length) {
        if (edge === "start" && remaining === 0) range.setStartBefore(node)
        if (edge === "start" && remaining > 0) range.setStartAfter(node)
        if (edge === "end" && remaining === 0) range.setEndBefore(node)
        if (edge === "end" && remaining > 0) range.setEndAfter(node)
        return
      }

      remaining -= length
    }
  }

  const addPart = (part: ContentPart) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const cursorPosition = getCursorPosition(editorRef)
    const currentPrompt = prompt.current()
    const rawText = currentPrompt.map((p) => ("content" in p ? p.content : "")).join("")
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (part.type === "file" || part.type === "agent") {
      const pill = createPill(part)
      const gap = document.createTextNode(" ")
      const range = selection.getRangeAt(0)

      if (atMatch) {
        const start = atMatch.index ?? cursorPosition - atMatch[0].length
        setRangeEdge(range, "start", start)
        setRangeEdge(range, "end", cursorPosition)
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } else if (part.type === "text") {
      const range = selection.getRangeAt(0)
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
          range.setStartAfter(last)
        }
      }
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    setStore("popover", null)
  }

  const abort = async () => {
    const sessionID = params.id
    if (!sessionID) return Promise.resolve()
    const queued = pending.get(sessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
      return Promise.resolve()
    }
    return sdk.client.session
      .abort({
        sessionID,
      })
      .catch(() => {})
  }

  const addToHistory = (prompt: Prompt, mode: "normal" | "shell") => {
    const text = prompt
      .map((p) => ("content" in p ? p.content : ""))
      .join("")
      .trim()
    const hasImages = prompt.some((part) => part.type === "image")
    if (!text && !hasImages) return

    const entry = clonePromptParts(prompt)
    const currentHistory = mode === "shell" ? shellHistory : history
    const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
    const lastEntry = currentHistory.entries[0]
    if (lastEntry && isPromptEqual(lastEntry, entry)) return

    setCurrentHistory("entries", (entries) => [entry, ...entries].slice(0, MAX_HISTORY))
  }

  const navigateHistory = (direction: "up" | "down") => {
    const entries = store.mode === "shell" ? shellHistory.entries : history.entries
    const current = store.historyIndex

    if (direction === "up") {
      if (entries.length === 0) return false
      if (current === -1) {
        setStore("savedPrompt", clonePromptParts(prompt.current()))
        setStore("historyIndex", 0)
        applyHistoryPrompt(entries[0], "start")
        return true
      }
      if (current < entries.length - 1) {
        const next = current + 1
        setStore("historyIndex", next)
        applyHistoryPrompt(entries[next], "start")
        return true
      }
      return false
    }

    if (current > 0) {
      const next = current - 1
      setStore("historyIndex", next)
      applyHistoryPrompt(entries[next], "end")
      return true
    }
    if (current === 0) {
      setStore("historyIndex", -1)
      const saved = store.savedPrompt
      if (saved) {
        applyHistoryPrompt(saved, "end")
        setStore("savedPrompt", null)
        return true
      }
      applyHistoryPrompt(DEFAULT_PROMPT, "end")
      return true
    }

    return false
  }

  const handleKeyDown = (event: KeyboardEvent) => {
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
        setStore("popover", null)
        event.preventDefault()
        return
      }
    }
    if (store.mode === "shell") {
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (event.key === "Escape") {
        setStore("mode", "normal")
        event.preventDefault()
        return
      }
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

    if (store.popover) {
      if (event.key === "Tab") {
        selectPopoverActive()
        event.preventDefault()
        return
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter") {
        if (store.popover === "at") {
          atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "slash") {
          slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (ctrl && event.code === "KeyG") {
      if (store.popover) {
        setStore("popover", null)
        event.preventDefault()
        return
      }
      if (working()) {
        abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(editorRef)
      const textLength = promptLength(prompt.current())
      const textContent = prompt
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const isEmpty = textContent.trim() === "" || textLength <= 1
      const hasNewlines = textContent.includes("\n")
      const inHistory = store.historyIndex >= 0
      const atStart = cursorPosition <= (isEmpty ? 1 : 0)
      const atEnd = cursorPosition >= (isEmpty ? textLength - 1 : textLength)
      const allowUp = isEmpty || atStart || (!hasNewlines && !inHistory) || (inHistory && atEnd)
      const allowDown = isEmpty || atEnd || (!hasNewlines && !inHistory) || (inHistory && atStart)

      if (event.key === "ArrowUp") {
        if (!allowUp) return
        if (navigateHistory("up")) {
          event.preventDefault()
        }
        return
      }

      if (!allowDown) return
      if (navigateHistory("down")) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      handleSubmit(event)
    }
    if (event.key === "Escape") {
      if (store.popover) {
        setStore("popover", null)
      } else if (working()) {
        abort()
      }
    }
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = imageAttachments().slice()
    const mode = store.mode

    if (text.trim().length === 0 && images.length === 0) {
      if (working()) abort()
      return
    }

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    const errorMessage = (err: unknown) => {
      if (err && typeof err === "object" && "data" in err) {
        const data = (err as { data?: { message?: string } }).data
        if (data?.message) return data.message
      }
      if (err instanceof Error) return err.message
      return language.t("common.requestFailed")
    }

    addToHistory(currentPrompt, mode)
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)

    const projectDirectory = sdk.directory
    const isNewSession = !params.id
    const worktreeSelection = props.newSessionWorktree ?? "main"

    let sessionDirectory = projectDirectory
    let client = sdk.client

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = createOpencodeClient({
          baseUrl: sdk.url,
          fetch: platform.fetch,
          directory: sessionDirectory,
          throwOnError: true,
        })
        globalSync.child(sessionDirectory)
      }

      props.onNewSessionWorktreeReset?.()
    }

    let session = info()
    if (!session && isNewSession) {
      session = await client.session
        .create()
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (session) navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
    }
    if (!session) return

    props.onSubmit?.()

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const variant = local.model.variant.current()

    const clearInput = () => {
      prompt.reset()
      setStore("mode", "normal")
      setStore("popover", null)
    }

    const restoreInput = () => {
      prompt.set(currentPrompt, promptLength(currentPrompt))
      setStore("mode", mode)
      setStore("popover", null)
      requestAnimationFrame(() => {
        editorRef.focus()
        setCursorPosition(editorRef, promptLength(currentPrompt))
        queueScroll()
      })
    }

    if (mode === "shell") {
      clearInput()
      client.session
        .shell({
          sessionID: session.id,
          agent,
          model,
          command: text,
        })
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        clearInput()
        client.session
          .command({
            sessionID: session.id,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: images.map((attachment) => ({
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: attachment.mime,
              url: attachment.dataUrl,
              filename: attachment.filename,
            })),
          })
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: errorMessage(err),
            })
            restoreInput()
          })
        return
      }
    }

    const toAbsolutePath = (path: string) =>
      path.startsWith("/") ? path : (sessionDirectory + "/" + path).replace("//", "/")

    const fileAttachments = currentPrompt.filter((part) => part.type === "file") as FileAttachmentPart[]
    const agentAttachments = currentPrompt.filter((part) => part.type === "agent") as AgentPart[]

    const fileAttachmentParts = fileAttachments.map((attachment) => {
      const absolute = toAbsolutePath(attachment.path)
      const query = attachment.selection
        ? `?start=${attachment.selection.startLine}&end=${attachment.selection.endLine}`
        : ""
      return {
        id: Identifier.ascending("part"),
        type: "file" as const,
        mime: "text/plain",
        url: `file://${absolute}${query}`,
        filename: getFilename(attachment.path),
        source: {
          type: "file" as const,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
          path: absolute,
        },
      }
    })

    const agentAttachmentParts = agentAttachments.map((attachment) => ({
      id: Identifier.ascending("part"),
      type: "agent" as const,
      name: attachment.name,
      source: {
        value: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    }))

    const usedUrls = new Set(fileAttachmentParts.map((part) => part.url))

    const context = prompt.context.items().slice()

    const commentItems = context.filter((item) => item.type === "file" && !!item.comment?.trim())

    const contextParts: Array<
      | {
          id: string
          type: "text"
          text: string
          synthetic?: boolean
        }
      | {
          id: string
          type: "file"
          mime: string
          url: string
          filename?: string
        }
    > = []

    const commentNote = (path: string, selection: FileSelection | undefined, comment: string) => {
      const start = selection ? Math.min(selection.startLine, selection.endLine) : undefined
      const end = selection ? Math.max(selection.startLine, selection.endLine) : undefined
      const range =
        start === undefined || end === undefined
          ? "this file"
          : start === end
            ? `line ${start}`
            : `lines ${start} through ${end}`

      return `The user made the following comment regarding ${range} of ${path}: ${comment}`
    }

    const addContextFile = (input: { path: string; selection?: FileSelection; comment?: string }) => {
      const absolute = toAbsolutePath(input.path)
      const query = input.selection ? `?start=${input.selection.startLine}&end=${input.selection.endLine}` : ""
      const url = `file://${absolute}${query}`

      const comment = input.comment?.trim()
      if (!comment && usedUrls.has(url)) return
      usedUrls.add(url)

      if (comment) {
        contextParts.push({
          id: Identifier.ascending("part"),
          type: "text",
          text: commentNote(input.path, input.selection, comment),
          synthetic: true,
        })
      }

      contextParts.push({
        id: Identifier.ascending("part"),
        type: "file",
        mime: "text/plain",
        url,
        filename: getFilename(input.path),
      })
    }

    for (const item of context) {
      if (item.type !== "file") continue
      addContextFile({ path: item.path, selection: item.selection, comment: item.comment })
    }

    const imageAttachmentParts = images.map((attachment) => ({
      id: Identifier.ascending("part"),
      type: "file" as const,
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    }))

    const messageID = Identifier.ascending("message")
    const textPart = {
      id: Identifier.ascending("part"),
      type: "text" as const,
      text,
    }
    const requestParts = [
      textPart,
      ...fileAttachmentParts,
      ...contextParts,
      ...agentAttachmentParts,
      ...imageAttachmentParts,
    ]

    const optimisticParts = requestParts.map((part) => ({
      ...part,
      sessionID: session.id,
      messageID,
    })) as unknown as Part[]

    const optimisticMessage: Message = {
      id: messageID,
      sessionID: session.id,
      role: "user",
      time: { created: Date.now() },
      agent,
      model,
    }

    const addOptimisticMessage = () => {
      if (sessionDirectory === projectDirectory) {
        sync.set(
          produce((draft) => {
            const messages = draft.message[session.id]
            if (!messages) {
              draft.message[session.id] = [optimisticMessage]
            } else {
              const result = Binary.search(messages, messageID, (m) => m.id)
              messages.splice(result.index, 0, optimisticMessage)
            }
            draft.part[messageID] = optimisticParts
              .filter((p) => !!p?.id)
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id))
          }),
        )
        return
      }

      globalSync.child(sessionDirectory)[1](
        produce((draft) => {
          const messages = draft.message[session.id]
          if (!messages) {
            draft.message[session.id] = [optimisticMessage]
          } else {
            const result = Binary.search(messages, messageID, (m) => m.id)
            messages.splice(result.index, 0, optimisticMessage)
          }
          draft.part[messageID] = optimisticParts
            .filter((p) => !!p?.id)
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id))
        }),
      )
    }

    const removeOptimisticMessage = () => {
      if (sessionDirectory === projectDirectory) {
        sync.set(
          produce((draft) => {
            const messages = draft.message[session.id]
            if (messages) {
              const result = Binary.search(messages, messageID, (m) => m.id)
              if (result.found) messages.splice(result.index, 1)
            }
            delete draft.part[messageID]
          }),
        )
        return
      }

      globalSync.child(sessionDirectory)[1](
        produce((draft) => {
          const messages = draft.message[session.id]
          if (messages) {
            const result = Binary.search(messages, messageID, (m) => m.id)
            if (result.found) messages.splice(result.index, 1)
          }
          delete draft.part[messageID]
        }),
      )
    }

    for (const item of commentItems) {
      prompt.context.remove(item.key)
    }

    clearInput()
    addOptimisticMessage()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()

      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync.set("session_status", session.id, { type: "idle" })
        }
        removeOptimisticMessage()
        for (const item of commentItems) {
          prompt.context.add({
            type: "file",
            path: item.path,
            selection: item.selection,
            comment: item.comment,
            commentID: item.commentID,
            commentOrigin: item.commentOrigin,
            preview: item.preview,
          })
        }
        restoreInput()
      }

      pending.set(session.id, { abort: controller, cleanup })

      const abort = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({ status: "failed", message: language.t("workspace.error.stillPreparing") })
        }, timeoutMs)
      })

      const result = await Promise.race([WorktreeState.wait(sessionDirectory), abort, timeout]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(session.id)
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    const send = async () => {
      const ok = await waitForWorktree()
      if (!ok) return
      await client.session.prompt({
        sessionID: session.id,
        agent,
        model,
        messageID,
        parts: requestParts,
        variant,
      })
    }

    void send().catch((err) => {
      pending.delete(session.id)
      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      for (const item of commentItems) {
        prompt.context.add({
          type: "file",
          path: item.path,
          selection: item.selection,
          comment: item.comment,
          commentID: item.commentID,
          commentOrigin: item.commentOrigin,
          preview: item.preview,
        })
      }
      restoreInput()
    })
  }

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-3">
      <Show when={store.popover}>
        <div
          ref={(el) => {
            if (store.popover === "slash") slashPopoverRef = el
          }}
          class="absolute inset-x-0 -top-3 -translate-y-full origin-bottom-left max-h-80 min-h-10
                 overflow-auto no-scrollbar flex flex-col p-2 rounded-md
                 border border-border-base bg-surface-raised-stronger-non-alpha shadow-md"
          onMouseDown={(e) => e.preventDefault()}
        >
          <Switch>
            <Match when={store.popover === "at"}>
              <Show
                when={atFlat().length > 0}
                fallback={<div class="text-text-weak px-2 py-1">{language.t("prompt.popover.emptyResults")}</div>}
              >
                <For each={atFlat().slice(0, 10)}>
                  {(item) => (
                    <button
                      classList={{
                        "w-full flex items-center gap-x-2 rounded-md px-2 py-0.5": true,
                        "bg-surface-raised-base-hover": atActive() === atKey(item),
                      }}
                      onClick={() => handleAtSelect(item)}
                      onMouseEnter={() => setAtActive(atKey(item))}
                    >
                      <Show
                        when={item.type === "agent"}
                        fallback={
                          <>
                            <FileIcon
                              node={{ path: (item as { type: "file"; path: string }).path, type: "file" }}
                              class="shrink-0 size-4"
                            />
                            <div class="flex items-center text-14-regular min-w-0">
                              <span class="text-text-weak whitespace-nowrap truncate min-w-0">
                                {(() => {
                                  const path = (item as { type: "file"; path: string }).path
                                  return path.endsWith("/") ? path : getDirectory(path)
                                })()}
                              </span>
                              <Show when={!(item as { type: "file"; path: string }).path.endsWith("/")}>
                                <span class="text-text-strong whitespace-nowrap">
                                  {getFilename((item as { type: "file"; path: string }).path)}
                                </span>
                              </Show>
                            </div>
                          </>
                        }
                      >
                        <Icon name="brain" size="small" class="text-icon-info-active shrink-0" />
                        <span class="text-14-regular text-text-strong whitespace-nowrap">
                          @{(item as { type: "agent"; name: string }).name}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </Match>
            <Match when={store.popover === "slash"}>
              <Show
                when={slashFlat().length > 0}
                fallback={<div class="text-text-weak px-2 py-1">{language.t("prompt.popover.emptyCommands")}</div>}
              >
                <For each={slashFlat()}>
                  {(cmd) => (
                    <button
                      data-slash-id={cmd.id}
                      classList={{
                        "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                        "bg-surface-raised-base-hover": slashActive() === cmd.id,
                      }}
                      onClick={() => handleSlashSelect(cmd)}
                      onMouseEnter={() => setSlashActive(cmd.id)}
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-14-regular text-text-strong whitespace-nowrap">/{cmd.trigger}</span>
                        <Show when={cmd.description}>
                          <span class="text-14-regular text-text-weak truncate">{cmd.description}</span>
                        </Show>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <Show when={cmd.type === "custom"}>
                          <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                            {language.t("prompt.slash.badge.custom")}
                          </span>
                        </Show>
                        <Show when={command.keybind(cmd.id)}>
                          <span class="text-12-regular text-text-subtle">{command.keybind(cmd.id)}</span>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </Show>
            </Match>
          </Switch>
        </div>
      </Show>
      <form
        onSubmit={handleSubmit}
        classList={{
          "group/prompt-input": true,
          "bg-surface-raised-stronger-non-alpha shadow-xs-border relative": true,
          "rounded-[14px] overflow-clip focus-within:shadow-xs-border": true,
          "border-icon-info-active border-dashed": store.dragging,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <Show when={store.dragging}>
          <div class="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised-stronger-non-alpha/90 pointer-events-none">
            <div class="flex flex-col items-center gap-2 text-text-weak">
              <Icon name="photo" class="size-8" />
              <span class="text-14-regular">{language.t("prompt.dropzone.label")}</span>
            </div>
          </div>
        </Show>
        <Show when={prompt.context.items().length > 0}>
          <div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
            <For each={prompt.context.items()}>
              {(item) => {
                const active = () => {
                  const a = comments.active()
                  return !!item.commentID && item.commentID === a?.id && item.path === a?.file
                }
                return (
                  <Tooltip
                    value={
                      <span class="flex max-w-[300px]">
                        <span class="text-text-invert-base truncate-start [unicode-bidi:plaintext] min-w-0">
                          {getDirectory(item.path)}
                        </span>
                        <span class="shrink-0">{getFilename(item.path)}</span>
                      </span>
                    }
                    placement="top"
                    openDelay={2000}
                  >
                    <div
                      classList={{
                        "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[200px] h-12 transition-all transition-transform shadow-xs-border hover:shadow-xs-border-hover": true,
                        "cursor-pointer hover:bg-surface-interactive-weak": !!item.commentID && !active(),
                        "cursor-pointer bg-surface-interactive-hover hover:bg-surface-interactive-hover shadow-xs-border-hover":
                          active(),
                        "bg-background-stronger": !active(),
                      }}
                      onClick={() => {
                        openComment(item)
                      }}
                    >
                      <div class="flex items-center gap-1.5">
                        <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-3.5" />
                        <div class="flex items-center text-11-regular min-w-0 font-medium">
                          <span class="text-text-strong whitespace-nowrap">{getFilenameTruncated(item.path, 14)}</span>
                          <Show when={item.selection}>
                            {(sel) => (
                              <span class="text-text-weak whitespace-nowrap shrink-0">
                                {sel().startLine === sel().endLine
                                  ? `:${sel().startLine}`
                                  : `:${sel().startLine}-${sel().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <IconButton
                          type="button"
                          icon="close-small"
                          variant="ghost"
                          class="ml-auto h-5 w-5 opacity-0 group-hover:opacity-100 transition-all"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (item.commentID) comments.remove(item.path, item.commentID)
                            prompt.context.remove(item.key)
                          }}
                          aria-label={language.t("prompt.context.removeFile")}
                        />
                      </div>
                      <Show when={item.comment}>
                        {(comment) => (
                          <div class="text-12-regular text-text-strong ml-5 pr-1 truncate">{comment()}</div>
                        )}
                      </Show>
                    </div>
                  </Tooltip>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={imageAttachments().length > 0}>
          <div class="flex flex-wrap gap-2 px-3 pt-3">
            <For each={imageAttachments()}>
              {(attachment) => (
                <div class="relative group">
                  <Show
                    when={attachment.mime.startsWith("image/")}
                    fallback={
                      <div class="size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base">
                        <Icon name="folder" class="size-6 text-text-weak" />
                      </div>
                    }
                  >
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.filename}
                      class="size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
                      onClick={() =>
                        dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
                      }
                    />
                  </Show>
                  <button
                    type="button"
                    onClick={() => removeImageAttachment(attachment.id)}
                    class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
                    aria-label={language.t("prompt.attachment.remove")}
                  >
                    <Icon name="close" class="size-3 text-text-weak" />
                  </button>
                  <div class="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md">
                    <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <div class="relative max-h-[240px] overflow-y-auto" ref={(el) => (scrollRef = el)}>
          <div
            data-component="prompt-input"
            ref={(el) => {
              editorRef = el
              props.ref?.(el)
            }}
            role="textbox"
            aria-multiline="true"
            aria-label={
              store.mode === "shell"
                ? language.t("prompt.placeholder.shell")
                : commentCount() > 1
                  ? language.t("prompt.placeholder.summarizeComments")
                  : commentCount() === 1
                    ? language.t("prompt.placeholder.summarizeComment")
                    : language.t("prompt.placeholder.normal", { example: language.t(EXAMPLES[store.placeholder]) })
            }
            contenteditable="true"
            onInput={handleInput}
            onPaste={handlePaste}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={handleKeyDown}
            classList={{
              "select-text": true,
              "w-full p-3 pr-12 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
              "[&_[data-type=file]]:text-syntax-property": true,
              "[&_[data-type=agent]]:text-syntax-type": true,
              "font-mono!": store.mode === "shell",
            }}
          />
          <Show when={!prompt.dirty()}>
            <div class="absolute top-0 inset-x-0 p-3 pr-12 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate">
              {store.mode === "shell"
                ? language.t("prompt.placeholder.shell")
                : commentCount() > 1
                  ? language.t("prompt.placeholder.summarizeComments")
                  : commentCount() === 1
                    ? language.t("prompt.placeholder.summarizeComment")
                    : language.t("prompt.placeholder.normal", { example: language.t(EXAMPLES[store.placeholder]) })}
            </div>
          </Show>
        </div>
        <div class="relative p-3 flex items-center justify-between">
          <div class="flex items-center justify-start gap-0.5">
            <Switch>
              <Match when={store.mode === "shell"}>
                <div class="flex items-center gap-2 px-2 h-6">
                  <Icon name="console" size="small" class="text-icon-primary" />
                  <span class="text-12-regular text-text-primary">{language.t("prompt.mode.shell")}</span>
                  <span class="text-12-regular text-text-weak">{language.t("prompt.mode.shell.exit")}</span>
                </div>
              </Match>
              <Match when={store.mode === "normal"}>
                <TooltipKeybind
                  placement="top"
                  title={language.t("command.agent.cycle")}
                  keybind={command.keybind("agent.cycle")}
                >
                  <Select
                    options={local.agent.list().map((agent) => agent.name)}
                    current={local.agent.current()?.name ?? ""}
                    onSelect={local.agent.set}
                    class="capitalize"
                    variant="ghost"
                  />
                </TooltipKeybind>
                <Show
                  when={providers.paid().length > 0}
                  fallback={
                    <TooltipKeybind
                      placement="top"
                      title={language.t("command.model.choose")}
                      keybind={command.keybind("model.choose")}
                    >
                      <Button as="div" variant="ghost" onClick={() => dialog.show(() => <DialogSelectModelUnpaid />)}>
                        <Show when={local.model.current()?.provider?.id}>
                          <ProviderIcon id={local.model.current()!.provider.id as IconName} class="size-4 shrink-0" />
                        </Show>
                        {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                        <Icon name="chevron-down" size="small" />
                      </Button>
                    </TooltipKeybind>
                  }
                >
                  <TooltipKeybind
                    placement="top"
                    title={language.t("command.model.choose")}
                    keybind={command.keybind("model.choose")}
                  >
                    <ModelSelectorPopover triggerAs={Button} triggerProps={{ variant: "ghost" }}>
                      <Show when={local.model.current()?.provider?.id}>
                        <ProviderIcon id={local.model.current()!.provider.id as IconName} class="size-4 shrink-0" />
                      </Show>
                      {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                      <Icon name="chevron-down" size="small" />
                    </ModelSelectorPopover>
                  </TooltipKeybind>
                </Show>
                <Show when={local.model.variant.list().length > 0}>
                  <TooltipKeybind
                    placement="top"
                    title={language.t("command.model.variant.cycle")}
                    keybind={command.keybind("model.variant.cycle")}
                  >
                    <Button
                      variant="ghost"
                      class="text-text-base _hidden group-hover/prompt-input:inline-block capitalize text-12-regular"
                      onClick={() => local.model.variant.cycle()}
                    >
                      {local.model.variant.current() ?? language.t("common.default")}
                    </Button>
                  </TooltipKeybind>
                </Show>
                <Show when={permission.permissionsEnabled() && params.id}>
                  <TooltipKeybind
                    placement="top"
                    title={language.t("command.permissions.autoaccept.enable")}
                    keybind={command.keybind("permissions.autoaccept")}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => permission.toggleAutoAccept(params.id!, sdk.directory)}
                      classList={{
                        "_hidden group-hover/prompt-input:flex size-6 items-center justify-center": true,
                        "text-text-base": !permission.isAutoAccepting(params.id!, sdk.directory),
                        "hover:bg-surface-success-base": permission.isAutoAccepting(params.id!, sdk.directory),
                      }}
                      aria-label={
                        permission.isAutoAccepting(params.id!, sdk.directory)
                          ? language.t("command.permissions.autoaccept.disable")
                          : language.t("command.permissions.autoaccept.enable")
                      }
                      aria-pressed={permission.isAutoAccepting(params.id!, sdk.directory)}
                    >
                      <Icon
                        name="chevron-double-right"
                        size="small"
                        classList={{ "text-icon-success-base": permission.isAutoAccepting(params.id!, sdk.directory) }}
                      />
                    </Button>
                  </TooltipKeybind>
                </Show>
              </Match>
            </Switch>
          </div>
          <div class="flex items-center gap-3 absolute right-3 bottom-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES.join(",")}
              class="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                if (file) addImageAttachment(file)
                e.currentTarget.value = ""
              }}
            />
            <div class="flex items-center gap-2">
              <SessionContextUsage />
              <Show when={store.mode === "normal"}>
                <Tooltip placement="top" value={language.t("prompt.action.attachFile")}>
                  <Button
                    type="button"
                    variant="ghost"
                    class="size-6"
                    onClick={() => fileInputRef.click()}
                    aria-label={language.t("prompt.action.attachFile")}
                  >
                    <Icon name="photo" class="size-4.5" />
                  </Button>
                </Tooltip>
              </Show>
            </div>
            <Tooltip
              placement="top"
              inactive={!prompt.dirty() && !working()}
              value={
                <Switch>
                  <Match when={working()}>
                    <div class="flex items-center gap-2">
                      <span>{language.t("prompt.action.stop")}</span>
                      <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
                    </div>
                  </Match>
                  <Match when={true}>
                    <div class="flex items-center gap-2">
                      <span>{language.t("prompt.action.send")}</span>
                      <Icon name="enter" size="small" class="text-icon-base" />
                    </div>
                  </Match>
                </Switch>
              }
            >
              <IconButton
                type="submit"
                disabled={!prompt.dirty() && !working()}
                icon={working() ? "stop" : "arrow-up"}
                variant="primary"
                class="h-6 w-4.5"
                aria-label={working() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
              />
            </Tooltip>
          </div>
        </div>
      </form>
    </div>
  )
}

function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const segments = content.split("\n")
  segments.forEach((segment, index) => {
    if (segment) {
      fragment.appendChild(document.createTextNode(segment))
    } else if (segments.length > 1) {
      fragment.appendChild(document.createTextNode("\u200B"))
    }
    if (index < segments.length - 1) {
      fragment.appendChild(document.createElement("br"))
    }
  })
  return fragment
}

function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  return (node.textContent ?? "").replace(/\u200B/g, "").length
}

function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let length = 0
  for (const child of Array.from(node.childNodes)) {
    length += getTextLength(child)
  }
  return length
}

function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      }
      if (remaining > 0 && isPill) {
        range.setStartAfter(node)
      }
      if (remaining > 0 && isBreak) {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) {
          range.setStart(next, 0)
        }
        if (!next || next.nodeType !== Node.TEXT_NODE) {
          range.setStartAfter(node)
        }
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}
