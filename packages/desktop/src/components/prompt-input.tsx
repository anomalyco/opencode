import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, on, Component, Show, For, onMount, onCleanup, Switch, Match, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { makePersisted } from "@solid-primitives/storage"
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
import { useCommand, formatKeybind } from "@/context/command"

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
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null,
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    dragging: false,
    imageAttachments: [],
  })

  const MAX_HISTORY = 100
  const [history, setHistory] = makePersisted(
    createStore<{
      entries: Prompt[]
    }>({
      entries: [],
    }),
    {
      name: "prompt-history.v1",
    },
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
    prompt.set(p, length)
    requestAnimationFrame(() => {
      editorRef.focus()
      setCursorPosition(editorRef, length)
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

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    if (hasFiles) {
      setStore("dragging", true)
    }
  }

  const handleDragLeave = (event: DragEvent) => {
    const related = event.relatedTarget as Node | null
    const form = event.currentTarget as HTMLElement
    if (!related || !form.contains(related)) {
      setStore("dragging", false)
    }
  }

  const handleDrop = async (event: DragEvent) => {
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
  })
  onCleanup(() => {
    editorRef.removeEventListener("paste", handlePaste)
  })

  createEffect(() => {
    if (isFocused()) {
      handleInput()
    } else {
      setStore("popover", null)
    }
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
        if (isPromptEqual(currentParts, domParts)) return

        const selection = window.getSelection()
        let cursorPosition: number | null = null
        if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
          cursorPosition = getCursorPosition(editorRef)
        }

        editorRef.innerHTML = ""
        currentParts.forEach((part) => {
          if (part.type === "text") {
            editorRef.appendChild(document.createTextNode(part.content))
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
    const newParts: Prompt = []
    let position = 0
    editorRef.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) {
          const content = node.textContent
          newParts.push({ type: "text", content, start: position, end: position + content.length })
          position += content.length
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type) {
        switch ((node as HTMLElement).dataset.type) {
          case "file":
            const content = node.textContent!
            newParts.push({
              type: "file",
              path: (node as HTMLElement).dataset.path!,
              content,
              start: position,
              end: position + content.length,
            })
            position += content.length
            break
          default:
            break
        }
      }
    })
    if (newParts.length === 0) newParts.push(...DEFAULT_PROMPT)
    return newParts
  }

  const handleInput = () => {
    const rawParts = parseFromDOM()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = rawParts.map((p) => ("content" in p ? p.content : "")).join("")

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

    if (store.historyIndex >= 0) {
      setStore("historyIndex", -1)
      setStore("savedPrompt", null)
    }

    prompt.set(rawParts, cursorPosition)
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

      if (atMatch) {
        let runningLength = 0

        const walker = document.createTreeWalker(editorRef, NodeFilter.SHOW_TEXT, null)
        let currentNode = walker.nextNode()
        while (currentNode) {
          const textContent = currentNode.textContent || ""
          if (runningLength + textContent.length >= atMatch.index!) {
            const localStart = atMatch.index! - runningLength
            const localEnd = cursorPosition - runningLength
            if (currentNode === range.startContainer || runningLength + textContent.length >= cursorPosition) {
              range.setStart(currentNode, localStart)
              range.setEnd(currentNode, Math.min(localEnd, textContent.length))
              break
            }
          }
          runningLength += textContent.length
          currentNode = walker.nextNode()
        }
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } else if (part.type === "text") {
      const textNode = document.createTextNode(part.content)
      const range = selection.getRangeAt(0)
      range.deleteContents()
      range.insertNode(textNode)
      range.setStartAfter(textNode)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    setStore("popover", null)
  }

  const abort = () =>
    sdk.client.session.abort({
      sessionID: params.id!,
    })

  const addToHistory = (prompt: Prompt) => {
    const text = prompt
      .map((p) => ("content" in p ? p.content : ""))
      .join("")
      .trim()
    if (!text) return

    const entry = clonePromptParts(prompt)
    const lastEntry = history.entries[0]
    if (lastEntry) {
      const lastText = lastEntry.map((p) => ("content" in p ? p.content : "")).join("")
      if (lastText === text) return
    }

    setHistory("entries", (entries) => [entry, ...entries].slice(0, MAX_HISTORY))
  }

  const navigateHistory = (direction: "up" | "down") => {
    const entries = history.entries
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
    if (store.popover && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
      if (store.popover === "file") {
        onKeyDown(event)
      } else {
        slashOnKeyDown(event)
      }
      event.preventDefault()
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (!collapsed) return
      const inHistory = store.historyIndex >= 0
      const atAbsoluteStart = cursorPosition === 0
      const atAbsoluteEnd = cursorPosition === textLength
      const allowUp = (inHistory && atAbsoluteEnd) || atAbsoluteStart
      const allowDown = (inHistory && atAbsoluteStart) || atAbsoluteEnd

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

    addToHistory(currentPrompt)
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
      type: "file" as const,
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    }))

    tabs().setActive(undefined)
    editorRef.innerHTML = ""
    prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    setStore("imageAttachments", [])

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        sdk.client.session.command({
          sessionID: existing.id,
          command: commandName,
          arguments: args.join(" "),
          agent: local.agent.current()!.name,
          model: `${local.model.current()!.provider.id}/${local.model.current()!.id}`,
        })
        return
      }
    }

    sdk.client.session.prompt({
      sessionID: existing.id,
      agent: local.agent.current()!.name,
      model: {
        modelID: local.model.current()!.id,
        providerID: local.model.current()!.provider.id,
      },
      parts: [
        {
          type: "text",
          text,
        },
        ...fileAttachmentParts,
        ...imageAttachmentParts,
      ],
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
                        <Show when={cmd.keybind}>
                          <span class="text-12-regular text-text-subtle">{formatKeybind(cmd.keybind!)}</span>
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
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
        <div class="relative max-h-[240px] overflow-y-auto">
          <div
            ref={(el) => {
              editorRef = el
              props.ref?.(el)
            }}
            contenteditable="true"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            classList={{
              "w-full px-5 py-3 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
              "[&>[data-type=file]]:text-icon-info-active": true,
            }}
          />
          <Show when={!prompt.dirty() && store.imageAttachments.length === 0}>
            <div class="absolute top-0 left-0 px-5 py-3 text-14-regular text-text-weak pointer-events-none">
              Ask anything... "{PLACEHOLDERS[store.placeholder]}"
            </div>
          </Show>
        </div>
        <div class="relative p-3 flex items-center justify-between">
          <div class="flex items-center justify-start gap-1">
            <Select
              options={local.agent.list().map((agent) => agent.name)}
              current={local.agent.current().name}
              onSelect={local.agent.set}
              class="capitalize"
              variant="ghost"
            />
            <Button
              as="div"
              variant="ghost"
              onClick={() =>
                dialog.show(() => (providers.paid().length > 0 ? <DialogSelectModel /> : <DialogSelectModelUnpaid />))
              }
            >
              {local.model.current()?.name ?? "Select model"}
              <span class="ml-0.5 text-text-weak text-12-regular">{local.model.current()?.provider.name}</span>
              <Icon name="chevron-down" size="small" />
            </Button>
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
            <Tooltip placement="top" value="Attach image">
              <IconButton
                type="button"
                icon="photo"
                variant="ghost"
                class="h-10 w-8"
                onClick={() => fileInputRef.click()}
              />
            </Tooltip>
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

function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return preCaretRange.toString().length
}

function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = node.textContent ? node.textContent.length : 0
    const isText = node.nodeType === Node.TEXT_NODE
    const isFile = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if (isFile && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStartAfter(node)
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
