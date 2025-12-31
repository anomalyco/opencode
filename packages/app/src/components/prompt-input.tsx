import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, on, Component, Show, For, onMount, onCleanup, Switch, Match, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createFocusSignal } from "@solid-primitives/active-element"
import { useLocal } from "@/context/local"
import { ContentPart, DEFAULT_PROMPT, isPromptEqual, Prompt, usePrompt, ImageAttachmentPart } from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectModelUnpaid } from "@/components/dialog-select-model-unpaid"
import { useProviders } from "@/hooks/use-providers"
import { useCommand } from "@/context/command"
import { persisted } from "@/utils/persist"
import { Identifier } from "@/utils/id"
import { SessionContextUsage } from "@/components/session-context-usage"

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
}

const PLACEHOLDERS = [
  "Fix a TODO in the codebase",
  "What is the tech stack of this project?",
  "Fix broken tests",
  "Explain how authentication works",
  "Find and fix security vulnerabilities",
  "Add unit tests for the user service",
  "Refactor this function to be more readable",
  "What does this error mean?",
  "Help me debug this issue",
  "Generate API documentation",
  "Optimize database queries",
  "Add input validation",
  "Create a new component for...",
  "How do I deploy this project?",
  "Review my code for best practices",
  "Add error handling to this function",
  "Explain this regex pattern",
  "Convert this to TypeScript",
  "Add logging throughout the codebase",
  "What dependencies are outdated?",
  "Help me write a migration script",
  "Implement caching for this endpoint",
  "Add pagination to this list",
  "Create a CLI command for...",
  "How do environment variables work here?",
]

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
  const local = useLocal()
  const prompt = usePrompt()
  const layout = useLayout()
  const params = useParams()
  const dialog = useDialog()
  const providers = useProviders()
  const command = useCommand()
  let editorRef!: HTMLDivElement
  let fileInputRef!: HTMLInputElement
  let scrollRef!: HTMLDivElement

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
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const status = createMemo(
    () =>
      sync.data.session_status[params.id ?? ""] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status()?.type !== "idle")

  const [store, setStore] = createStore<{
    popover: "file" | "slash" | null
    historyIndex: number
    savedPrompt: Prompt | null
    placeholder: number
    dragging: boolean
    imageAttachments: ImageAttachmentPart[]
    mode: "normal" | "shell"
    applyingHistory: boolean
    killBuffer: string
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null,
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    dragging: false,
    imageAttachments: [],
    mode: "normal",
    applyingHistory: false,
    killBuffer: "",
  })

  const MAX_HISTORY = 100
  const [history, setHistory] = persisted(
    "prompt-history.v1",
    createStore<{
      entries: Prompt[]
    }>({
      entries: [],
    }),
  )
  const [shellHistory, setShellHistory] = persisted(
    "prompt-history-shell.v1",
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

  createEffect(() => {
    params.id
    editorRef.focus()
    if (params.id) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % PLACEHOLDERS.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  const isFocused = createFocusSignal(() => editorRef)

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
      setStore(
        produce((draft) => {
          draft.imageAttachments.push(attachment)
        }),
      )
    }
    reader.readAsDataURL(file)
  }

  const removeImageAttachment = (id: string) => {
    setStore(
      produce((draft) => {
        draft.imageAttachments = draft.imageAttachments.filter((a) => a.id !== id)
      }),
    )
  }

  const handlePaste = async (event: ClipboardEvent) => {
    if (!isFocused()) return
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    const items = Array.from(clipboardData.items)
    const imageItems = items.filter((item) => ACCEPTED_FILE_TYPES.includes(item.type))

    if (imageItems.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) await addImageAttachment(file)
      }
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const plainText = clipboardData.getData("text/plain") ?? ""
    addPart({ type: "text", content: plainText, start: 0, end: 0 })
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    if (hasFiles) {
      setStore("dragging", true)
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    // relatedTarget is null when leaving the document window
    if (!event.relatedTarget) {
      setStore("dragging", false)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    event.preventDefault()
    setStore("dragging", false)

    const files = event.dataTransfer?.files
    if (!files) return

    for (const file of Array.from(files)) {
      if (ACCEPTED_FILE_TYPES.includes(file.type)) {
        await addImageAttachment(file)
      }
    }
  }

  onMount(() => {
    editorRef.addEventListener("paste", handlePaste)
    document.addEventListener("dragover", handleGlobalDragOver)
    document.addEventListener("dragleave", handleGlobalDragLeave)
    document.addEventListener("drop", handleGlobalDrop)
  })
  onCleanup(() => {
    editorRef.removeEventListener("paste", handlePaste)
    document.removeEventListener("dragover", handleGlobalDragOver)
    document.removeEventListener("dragleave", handleGlobalDragLeave)
    document.removeEventListener("drop", handleGlobalDrop)
  })

  createEffect(() => {
    if (!isFocused()) setStore("popover", null)
  })

  const handleFileSelect = (path: string | undefined) => {
    if (!path) return
    addPart({ type: "file", path, content: "@" + path, start: 0, end: 0 })
  }

  const { flat, active, onInput, onKeyDown } = useFilteredList<string>({
    items: local.file.searchFilesAndDirectories,
    key: (x) => x,
    onSelect: handleFileSelect,
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
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title", "description"],
    onSelect: handleSlashSelect,
  })

  createEffect(
    on(
      () => prompt.current(),
      (currentParts) => {
        const domParts = parseFromDOM()
        const normalized = Array.from(editorRef.childNodes).every((node) => {
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
          return el.tagName === "BR"
        })
        if (normalized && isPromptEqual(currentParts, domParts)) return

        const selection = window.getSelection()
        let cursorPosition: number | null = null
        if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
          cursorPosition = getCursorPosition(editorRef)
        }

        editorRef.innerHTML = ""
        currentParts.forEach((part) => {
          if (part.type === "text") {
            editorRef.appendChild(createTextFragment(part.content))
          } else if (part.type === "file") {
            const pill = document.createElement("span")
            pill.textContent = part.content
            pill.setAttribute("data-type", "file")
            pill.setAttribute("data-path", part.path)
            pill.setAttribute("contenteditable", "false")
            pill.style.userSelect = "text"
            pill.style.cursor = "default"
            editorRef.appendChild(pill)
          }
        })

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
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const trimmed = rawText.replace(/\u200B/g, "").trim()
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const shouldReset = trimmed.length === 0 && !hasNonText

    if (shouldReset) {
      setStore("popover", null)
      if (store.historyIndex >= 0 && !store.applyingHistory) {
        setStore("historyIndex", -1)
        setStore("savedPrompt", null)
      }
      if (prompt.dirty()) {
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
        onInput(atMatch[1])
        setStore("popover", "file")
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

    prompt.set(rawParts, cursorPosition)
    queueScroll()
  }

  const addPart = (part: ContentPart) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const cursorPosition = getCursorPosition(editorRef)
    const currentPrompt = prompt.current()
    const rawText = currentPrompt.map((p) => ("content" in p ? p.content : "")).join("")
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (part.type === "file") {
      const pill = document.createElement("span")
      pill.textContent = part.content
      pill.setAttribute("data-type", "file")
      pill.setAttribute("data-path", part.path)
      pill.setAttribute("contenteditable", "false")
      pill.style.userSelect = "text"
      pill.style.cursor = "default"

      const gap = document.createTextNode(" ")
      const range = selection.getRangeAt(0)

      const setEdge = (edge: "start" | "end", offset: number) => {
        let remaining = offset
        const nodes = Array.from(editorRef.childNodes)

        for (const node of nodes) {
          const length = getNodeLength(node)
          const isText = node.nodeType === Node.TEXT_NODE
          const isFile = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"
          const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

          if (isText && remaining <= length) {
            if (edge === "start") range.setStart(node, remaining)
            if (edge === "end") range.setEnd(node, remaining)
            return
          }

          if ((isFile || isBreak) && remaining <= length) {
            if (edge === "start" && remaining === 0) range.setStartBefore(node)
            if (edge === "start" && remaining > 0) range.setStartAfter(node)
            if (edge === "end" && remaining === 0) range.setEndBefore(node)
            if (edge === "end" && remaining > 0) range.setEndAfter(node)
            return
          }

          remaining -= length
        }
      }

      if (atMatch) {
        const start = atMatch.index ?? cursorPosition - atMatch[0].length
        setEdge("start", start)
        setEdge("end", cursorPosition)
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

  const setSelectionOffsets = (start: number, end: number) => {
    const selection = window.getSelection()
    if (!selection) return false

    const length = promptLength(prompt.current())
    const a = Math.max(0, Math.min(start, length))
    const b = Math.max(0, Math.min(end, length))
    const rangeStart = Math.min(a, b)
    const rangeEnd = Math.max(a, b)

    const range = document.createRange()
    range.selectNodeContents(editorRef)

    const setEdge = (edge: "start" | "end", offset: number) => {
      let remaining = offset
      const nodes = Array.from(editorRef.childNodes)

      for (const node of nodes) {
        const length = getNodeLength(node)
        const isText = node.nodeType === Node.TEXT_NODE
        const isFile = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"
        const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

        if (isText && remaining <= length) {
          if (edge === "start") range.setStart(node, remaining)
          if (edge === "end") range.setEnd(node, remaining)
          return
        }

        if ((isFile || isBreak) && remaining <= length) {
          if (edge === "start" && remaining === 0) range.setStartBefore(node)
          if (edge === "start" && remaining > 0) range.setStartAfter(node)
          if (edge === "end" && remaining === 0) range.setEndBefore(node)
          if (edge === "end" && remaining > 0) range.setEndAfter(node)
          return
        }

        remaining -= length
      }

      const last = editorRef.lastChild
      if (!last) {
        if (edge === "start") range.setStart(editorRef, 0)
        if (edge === "end") range.setEnd(editorRef, 0)
        return
      }
      if (edge === "start") range.setStartAfter(last)
      if (edge === "end") range.setEndAfter(last)
    }

    setEdge("start", rangeStart)
    setEdge("end", rangeEnd)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  const replaceOffsets = (start: number, end: number, content: string) => {
    if (!setSelectionOffsets(start, end)) return false
    addPart({ type: "text", content, start: 0, end: 0 })
    return true
  }

  const killText = (start: number, end: number) => {
    if (start === end) return
    const current = prompt.current()
    if (!current.every((part) => part.type === "text")) return
    const text = current.map((part) => part.content).join("")
    setStore("killBuffer", text.slice(start, end))
  }

  const abort = () =>
    sdk.client.session
      .abort({
        sessionID: params.id!,
      })
      .catch(() => {})

  const addToHistory = (prompt: Prompt, mode: "normal" | "shell") => {
    const text = prompt
      .map((p) => ("content" in p ? p.content : ""))
      .join("")
      .trim()
    if (!text) return

    const entry = clonePromptParts(prompt)
    const currentHistory = mode === "shell" ? shellHistory : history
    const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
    const lastEntry = currentHistory.entries[0]
    if (lastEntry) {
      const lastText = lastEntry.map((p) => ("content" in p ? p.content : "")).join("")
      if (lastText === text) return
    }

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

    if (store.popover && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
      if (store.popover === "file") {
        onKeyDown(event)
      } else {
        slashOnKeyDown(event)
      }
      event.preventDefault()
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    const alt = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey

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

    if (ctrl || alt) {
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (collapsed) {
        const current = prompt.current()
        const text = current.map((part) => ("content" in part ? part.content : "")).join("")

        if (ctrl) {
          if (event.code === "KeyA") {
            const pos = text.lastIndexOf("\n", cursorPosition - 1) + 1
            setCursorPosition(editorRef, pos)
            event.preventDefault()
            queueScroll()
            return
          }

          if (event.code === "KeyE") {
            const next = text.indexOf("\n", cursorPosition)
            const pos = next === -1 ? textLength : next
            setCursorPosition(editorRef, pos)
            event.preventDefault()
            queueScroll()
            return
          }

          if (event.code === "KeyB") {
            const pos = Math.max(0, cursorPosition - 1)
            setCursorPosition(editorRef, pos)
            event.preventDefault()
            queueScroll()
            return
          }

          if (event.code === "KeyF") {
            const pos = Math.min(textLength, cursorPosition + 1)
            setCursorPosition(editorRef, pos)
            event.preventDefault()
            queueScroll()
            return
          }

          if (event.code === "KeyD") {
            if (store.mode === "shell" && cursorPosition === 0 && textLength === 0) {
              setStore("mode", "normal")
              event.preventDefault()
              return
            }
            if (cursorPosition >= textLength) return
            replaceOffsets(cursorPosition, cursorPosition + 1, "")
            event.preventDefault()
            return
          }

          if (event.code === "KeyK") {
            const next = text.indexOf("\n", cursorPosition)
            const lineEnd = next === -1 ? textLength : next
            const end = lineEnd === cursorPosition && lineEnd < textLength ? lineEnd + 1 : lineEnd
            if (end === cursorPosition) return
            killText(cursorPosition, end)
            replaceOffsets(cursorPosition, end, "")
            event.preventDefault()
            return
          }

          if (event.code === "KeyU") {
            const start = text.lastIndexOf("\n", cursorPosition - 1) + 1
            if (start === cursorPosition) return
            killText(start, cursorPosition)
            replaceOffsets(start, cursorPosition, "")
            event.preventDefault()
            return
          }

          if (event.code === "KeyW") {
            let start = cursorPosition
            while (start > 0 && /\s/.test(text[start - 1])) start -= 1
            while (start > 0 && !/\s/.test(text[start - 1])) start -= 1
            if (start === cursorPosition) return
            killText(start, cursorPosition)
            replaceOffsets(start, cursorPosition, "")
            event.preventDefault()
            return
          }

          if (event.code === "KeyY") {
            if (!store.killBuffer) return
            addPart({ type: "text", content: store.killBuffer, start: 0, end: 0 })
            event.preventDefault()
            return
          }

          if (event.code === "KeyT") {
            if (!current.every((part) => part.type === "text")) return
            if (textLength < 2) return
            if (cursorPosition === 0) return

            const atEnd = cursorPosition === textLength
            const first = atEnd ? cursorPosition - 2 : cursorPosition - 1
            const second = atEnd ? cursorPosition - 1 : cursorPosition

            if (text[first] === "\n" || text[second] === "\n") return

            replaceOffsets(first, second + 1, `${text[second]}${text[first]}`)
            event.preventDefault()
            return
          }
        }

        if (alt) {
          if (event.code === "KeyB") {
            let pos = cursorPosition
            while (pos > 0 && /\s/.test(text[pos - 1])) pos -= 1
            while (pos > 0 && !/\s/.test(text[pos - 1])) pos -= 1
            setCursorPosition(editorRef, pos)
            event.preventDefault()
            queueScroll()
            return
          }

          if (event.code === "KeyF") {
            let pos = cursorPosition
            while (pos < textLength && /\s/.test(text[pos])) pos += 1
            while (pos < textLength && !/\s/.test(text[pos])) pos += 1
            setCursorPosition(editorRef, pos)
            event.preventDefault()
            queueScroll()
            return
          }

          if (event.code === "KeyD") {
            let end = cursorPosition
            while (end < textLength && /\s/.test(text[end])) end += 1
            while (end < textLength && !/\s/.test(text[end])) end += 1
            if (end === cursorPosition) return
            killText(cursorPosition, end)
            replaceOffsets(cursorPosition, end, "")
            event.preventDefault()
            return
          }
        }
      }
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

    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }
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
    const hasImageAttachments = store.imageAttachments.length > 0
    if (text.trim().length === 0 && !hasImageAttachments) {
      if (working()) abort()
      return
    }

    addToHistory(currentPrompt, store.mode)
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)

    let existing = info()
    if (!existing) {
      const created = await sdk.client.session.create()
      existing = created.data ?? undefined
      if (existing) navigate(existing.id)
    }
    if (!existing) return

    const toAbsolutePath = (path: string) => (path.startsWith("/") ? path : sync.absolute(path))
    const attachments = currentPrompt.filter(
      (part) => part.type === "file",
    ) as import("@/context/prompt").FileAttachmentPart[]

    const fileAttachmentParts = attachments.map((attachment) => {
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

    const imageAttachmentParts = store.imageAttachments.map((attachment) => ({
      id: Identifier.ascending("part"),
      type: "file" as const,
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    }))

    const isShellMode = store.mode === "shell"
    tabs().setActive(undefined)
    editorRef.innerHTML = ""
    prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    setStore("imageAttachments", [])
    setStore("mode", "normal")

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    if (!currentModel || !currentAgent) {
      console.warn("No agent or model available for prompt submission")
      return
    }
    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const variant = local.model.variant.current()

    if (isShellMode) {
      sdk.client.session
        .shell({
          sessionID: existing.id,
          agent,
          model,
          command: text,
        })
        .catch((e) => {
          console.error("Failed to send shell command", e)
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        sdk.client.session
          .command({
            sessionID: existing.id,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
          })
          .catch((e) => {
            console.error("Failed to send command", e)
          })
        return
      }
    }

    const messageID = Identifier.ascending("message")
    const textPart = {
      id: Identifier.ascending("part"),
      type: "text" as const,
      text,
    }
    const requestParts = [textPart, ...fileAttachmentParts, ...imageAttachmentParts]
    const optimisticParts = requestParts.map((part) => ({
      ...part,
      sessionID: existing.id,
      messageID,
    }))

    sync.session.addOptimisticMessage({
      sessionID: existing.id,
      messageID,
      parts: optimisticParts,
      agent,
      model,
    })

    sdk.client.session
      .prompt({
        sessionID: existing.id,
        agent,
        model,
        messageID,
        parts: requestParts,
        variant,
      })
      .catch((e) => {
        console.error("Failed to send prompt", e)
      })
  }

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-3">
      <Show when={store.popover}>
        <div
          class="absolute inset-x-0 -top-3 -translate-y-full origin-bottom-left max-h-80 min-h-10
                 overflow-auto no-scrollbar flex flex-col p-2 rounded-md
                 border border-border-base bg-surface-raised-stronger-non-alpha shadow-md"
        >
          <Switch>
            <Match when={store.popover === "file"}>
              <Show when={flat().length > 0} fallback={<div class="text-text-weak px-2 py-1">No matching files</div>}>
                <For each={flat()}>
                  {(i) => (
                    <button
                      classList={{
                        "w-full flex items-center gap-x-2 rounded-md px-2 py-0.5": true,
                        "bg-surface-raised-base-hover": active() === i,
                      }}
                      onClick={() => handleFileSelect(i)}
                    >
                      <FileIcon node={{ path: i, type: "file" }} class="shrink-0 size-4" />
                      <div class="flex items-center text-14-regular min-w-0">
                        <span class="text-text-weak whitespace-nowrap truncate min-w-0">{getDirectory(i)}</span>
                        <Show when={!i.endsWith("/")}>
                          <span class="text-text-strong whitespace-nowrap">{getFilename(i)}</span>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </Show>
            </Match>
            <Match when={store.popover === "slash"}>
              <Show
                when={slashFlat().length > 0}
                fallback={<div class="text-text-weak px-2 py-1">No matching commands</div>}
              >
                <For each={slashFlat()}>
                  {(cmd) => (
                    <button
                      classList={{
                        "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                        "bg-surface-raised-base-hover": slashActive() === cmd.id,
                      }}
                      onClick={() => handleSlashSelect(cmd)}
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
                            custom
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
          "bg-surface-raised-stronger-non-alpha shadow-xs-border relative": true,
          "rounded-md overflow-clip focus-within:shadow-xs-border": true,
          "border-icon-info-active border-dashed": store.dragging,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <Show when={store.dragging}>
          <div class="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised-stronger-non-alpha/90 pointer-events-none">
            <div class="flex flex-col items-center gap-2 text-text-weak">
              <Icon name="photo" class="size-8" />
              <span class="text-14-regular">Drop images or PDFs here</span>
            </div>
          </div>
        </Show>
        <Show when={store.imageAttachments.length > 0}>
          <div class="flex flex-wrap gap-2 px-3 pt-3">
            <For each={store.imageAttachments}>
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
                      class="size-16 rounded-md object-cover border border-border-base"
                    />
                  </Show>
                  <button
                    type="button"
                    onClick={() => removeImageAttachment(attachment.id)}
                    class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
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
            contenteditable="true"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            classList={{
              "select-text": true,
              "w-full px-5 py-3 pr-12 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
              "[&_[data-type=file]]:text-icon-info-active": true,
              "font-mono!": store.mode === "shell",
            }}
          />
          <Show when={!prompt.dirty() && store.imageAttachments.length === 0}>
            <div class="absolute top-0 inset-x-0 px-5 py-3 pr-12 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate">
              {store.mode === "shell"
                ? "Enter shell command..."
                : `Ask anything... "${PLACEHOLDERS[store.placeholder]}"`}
            </div>
          </Show>
          <div class="absolute top-4.5 right-4">
            <SessionContextUsage />
          </div>
        </div>
        <div class="relative p-3 flex items-center justify-between">
          <div class="flex items-center justify-start gap-1">
            <Switch>
              <Match when={store.mode === "shell"}>
                <div class="flex items-center gap-2 px-2 h-6">
                  <Icon name="console" size="small" class="text-icon-primary" />
                  <span class="text-12-regular text-text-primary">Shell</span>
                  <span class="text-12-regular text-text-weak">esc to exit</span>
                </div>
              </Match>
              <Match when={store.mode === "normal"}>
                <Tooltip
                  placement="top"
                  value={
                    <div class="flex items-center gap-2">
                      <span>Cycle agent</span>
                      <span class="text-icon-base text-12-medium">{command.keybind("agent.cycle")}</span>
                    </div>
                  }
                >
                  <Select
                    options={local.agent.list().map((agent) => agent.name)}
                    current={local.agent.current()?.name ?? ""}
                    onSelect={local.agent.set}
                    class="capitalize"
                    variant="ghost"
                  />
                </Tooltip>
                <Tooltip
                  placement="top"
                  value={
                    <div class="flex flex-col gap-1">
                      <div class="flex items-center gap-2">
                        <span>Choose model</span>
                        <span class="text-icon-base text-12-medium">{command.keybind("model.choose")}</span>
                      </div>
                      <Show when={local.model.current()?.provider.name}>
                        <span class="text-text-weak">{local.model.current()?.provider.name}</span>
                      </Show>
                    </div>
                  }
                >
                  <Button
                    as="div"
                    variant="ghost"
                    onClick={() =>
                      dialog.show(() =>
                        providers.paid().length > 0 ? <DialogSelectModel /> : <DialogSelectModelUnpaid />,
                      )
                    }
                  >
                    {local.model.current()?.name ?? "Select model"}
                    <Icon name="chevron-down" size="small" />
                  </Button>
                </Tooltip>
                <Show when={local.model.variant.list().length > 0}>
                  <Tooltip placement="top" value="Cycle effort level">
                    <Button
                      variant="ghost"
                      onClick={() => local.model.variant.cycle()}
                      classList={{
                        "text-icon-warning": !!local.model.variant.current(),
                      }}
                    >
                      <Icon name="brain" size="small" />
                      <Show when={local.model.variant.current()}>
                        <span class="text-12-regular">{local.model.variant.current()}</span>
                      </Show>
                    </Button>
                  </Tooltip>
                </Show>
              </Match>
            </Switch>
          </div>
          <div class="flex items-center gap-1 absolute right-2 bottom-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              class="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                if (file) addImageAttachment(file)
                e.currentTarget.value = ""
              }}
            />
            <Show when={store.mode === "normal"}>
              <Tooltip placement="top" value="Attach image">
                <IconButton
                  type="button"
                  icon="photo"
                  variant="ghost"
                  class="h-10 w-8"
                  onClick={() => fileInputRef.click()}
                />
              </Tooltip>
            </Show>
            <Tooltip
              placement="top"
              inactive={!prompt.dirty() && !working()}
              value={
                <Switch>
                  <Match when={working()}>
                    <div class="flex items-center gap-2">
                      <span>Stop</span>
                      <span class="text-icon-base text-12-medium text-[10px]!">ESC</span>
                    </div>
                  </Match>
                  <Match when={true}>
                    <div class="flex items-center gap-2">
                      <span>Send</span>
                      <Icon name="enter" size="small" class="text-icon-base" />
                    </div>
                  </Match>
                </Switch>
              }
            >
              <IconButton
                type="submit"
                disabled={!prompt.dirty() && store.imageAttachments.length === 0 && !working()}
                icon={working() ? "stop" : "arrow-up"}
                variant="primary"
                class="h-10 w-8"
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
    const isFile = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"
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

    if ((isFile || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      }
      if (remaining > 0 && isFile) {
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
