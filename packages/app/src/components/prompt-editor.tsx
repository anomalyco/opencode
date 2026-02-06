import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, Switch, Match } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { createFocusSignal } from "@solid-primitives/active-element"
import { useFilteredList } from "@opencode-ai/ui/hooks"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useLanguage } from "@/context/language"
import { DEFAULT_PROMPT, type AgentPart, type FileAttachmentPart, type Prompt } from "@/context/prompt"

export type SlashCommand = {
  id: string
  trigger: string
  title: string
  description?: string
  keybind?: string
  type: "builtin" | "custom"
  source?: "command" | "mcp" | "skill"
}

export type TemplateOption = {
  value: string
  label: string
  description?: string
}

type AtOption =
  | { type: "agent"; name: string; display: string }
  | { type: "file"; path: string; display: string; recent?: boolean }

export function promptText(parts: Prompt) {
  return parts.map((part) => ("content" in part ? part.content : "")).join("")
}

export function PromptEditor(props: {
  value: Prompt
  placeholder: string
  class?: string
  editorClass?: string
  showPlaceholder?: boolean
  portal?: boolean
  portalMount?: HTMLElement
  mode?: "normal" | "shell"
  onChange: (value: Prompt, cursor: number) => void
  onKeyDown?: (event: KeyboardEvent, state: { popover: "at" | "slash" | "template" | null }) => boolean | void
  onPaste?: (event: ClipboardEvent) => boolean | void | Promise<boolean | void>
  ref?: (el: HTMLDivElement) => void
  scrollRef?: (el: HTMLDivElement) => void
  slash: {
    commands: SlashCommand[]
    keybind?: (id: string) => string | undefined
    onSelect?: (command: SlashCommand) => boolean | void
  }
  at: {
    agents?: { name: string; hidden?: boolean; mode?: string }[]
    recent?: string[]
    search?: (query: string) => Promise<string[]>
  }
  templates?: {
    items: TemplateOption[]
    onSelect?: (option: TemplateOption) => boolean | void
  }
}) {
  const language = useLanguage()
  let editorRef!: HTMLDivElement
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement
  const mirror = { input: false }
  const mode = () => props.mode ?? "normal"

  const [store, setStore] = createStore<{ popover: "at" | "slash" | "template" | null }>({ popover: null })
  const [rect, setRect] = createStore({ left: 0, top: 0, width: 0 })
  const [composing, setComposing] = createSignal(false)

  const isFocused = createFocusSignal(() => editorRef)

  createEffect(() => {
    if (isFocused()) return
    setStore("popover", null)
  })

  createEffect(() => {
    if (!props.portal) return
    if (!store.popover) return
    const update = () => {
      const bounds = editorRef.getBoundingClientRect()
      setRect({ left: bounds.left, top: bounds.top - 12, width: bounds.width })
    }

    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    onCleanup(() => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    })
  })

  // Safety: reset composing state on focus change to prevent stuck state
  createEffect(() => {
    if (isFocused()) return
    setComposing(false)
  })

  const agentList = createMemo(() =>
    (props.at.agents ?? [])
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent): AtOption => ({ type: "agent", name: agent.name, display: agent.name })),
  )
  const recent = createMemo(() => props.at.recent ?? [])
  const templateItems = createMemo(() => props.templates?.items ?? [])
  const templateMatch = (value: string) => value.match(/\{\{([^\s}]*)$/)

  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    if (option.type === "agent") {
      addPart({ type: "agent", name: option.name, content: "@" + option.name, start: 0, end: 0 })
      return
    }
    addPart({ type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 })
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
      if (!props.at.search) return [...agents, ...pinned]
      const paths = await props.at.search(query)
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

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    setStore("popover", null)
    if (props.slash.onSelect?.(cmd)) return

    const text = `/${cmd.trigger} `
    editorRef.innerHTML = ""
    editorRef.textContent = text
    mirror.input = true
    props.onChange([{ type: "text", content: text, start: 0, end: text.length }], text.length)
    requestAnimationFrame(() => {
      editorRef.focus()
      const range = document.createRange()
      const sel = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
    refetch: slashRefetch,
  } = useFilteredList<SlashCommand>({
    items: () => props.slash.commands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title", "description"],
    onSelect: handleSlashSelect,
  })

  createEffect(
    on(
      () => props.slash.commands,
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

    if (store.popover === "template") {
      const items = templateFlat()
      if (items.length === 0) return
      const active = templateActive()
      const item = items.find((entry) => entry.value === active) ?? items[0]
      handleTemplateSelect(item)
    }
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
      () => props.value,
      (currentParts) => {
        if (mirror.input) {
          mirror.input = false
          if (isNormalizedEditor()) return

          const selection = window.getSelection()
          let cursorPosition: number | null = null
          if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
            cursorPosition = getCursorPosition(editorRef)
          }

          renderEditor(currentParts)

          if (cursorPosition !== null) {
            setCursorPosition(editorRef, cursorPosition)
          }
          return
        }

        const domParts = parseFromDOM()
        if (isNormalizedEditor() && isPromptEqual(currentParts, domParts)) return

        const selection = window.getSelection()
        let cursorPosition: number | null = null
        if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
          cursorPosition = getCursorPosition(editorRef)
        }

        renderEditor(currentParts)

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
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const trimmed = rawText.replace(/\u200B/g, "").trim()
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const shouldReset = trimmed.length === 0 && !hasNonText

    if (shouldReset) {
      setStore("popover", null)
      mirror.input = true
      props.onChange(DEFAULT_PROMPT, 0)
      return
    }

    if (mode() === "shell") {
      setStore("popover", null)
    }

    if (mode() !== "shell") {
      const textBeforeCursor = rawText.substring(0, cursorPosition)
      const templateResult = templateItems().length > 0 ? templateMatch(textBeforeCursor) : null
      const atMatch = textBeforeCursor.match(/@(\S*)$/)
      const slashMatch = rawText.match(/^\/(\S*)$/)

      if (templateResult) {
        templateOnInput(templateResult[1])
        setStore("popover", "template")
      }
      if (!templateResult && atMatch) {
        atOnInput(atMatch[1])
        setStore("popover", "at")
      }
      if (!templateResult && !atMatch && slashMatch) {
        slashOnInput(slashMatch[1])
        setStore("popover", "slash")
      }
      if (!templateResult && !atMatch && !slashMatch) {
        setStore("popover", null)
      }
    }

    mirror.input = true
    props.onChange(rawParts, cursorPosition)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && store.popover) {
      setStore("popover", null)
      event.preventDefault()
      return
    }

    const handled = props.onKeyDown?.(event, { popover: store.popover })
    if (handled) return
    if (event.defaultPrevented) return

    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && (event.isComposing || composing() || event.keyCode === 229)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (ctrl && event.code === "KeyG" && store.popover) {
      setStore("popover", null)
      event.preventDefault()
      return
    }

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
        }
        if (store.popover === "template") {
          templateOnKeyDown(event)
        }
        event.preventDefault()
      }
    }
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const handled = await props.onPaste?.(event)
    if (handled) return
    if (event.defaultPrevented) return

    const clipboardData = event.clipboardData
    if (!clipboardData) return

    const plainText = clipboardData.getData("text/plain") ?? ""
    if (!plainText) return

    event.preventDefault()
    event.stopPropagation()
    addPart({ type: "text", content: plainText, start: 0, end: 0 })
  }

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

  const insertText = (content: string, replace?: { start: number; end: number }) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (replace) {
      setRangeEdge(range, "start", replace.start)
      setRangeEdge(range, "end", replace.end)
      range.deleteContents()
    }

    const fragment = createTextFragment(content)
    const last = fragment.lastChild
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

  const handleTemplateSelect = (option: TemplateOption | undefined) => {
    if (!option) return
    setStore("popover", null)
    if (props.templates?.onSelect?.(option)) return

    const cursorPosition = getCursorPosition(editorRef)
    const currentPrompt = parseFromDOM()
    const rawText = promptText(currentPrompt)
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const match = templateMatch(textBeforeCursor)
    const replace = match
      ? {
          start: match.index ?? cursorPosition - match[0].length,
          end: cursorPosition,
        }
      : undefined
    insertText(option.value, replace)
    handleInput()
  }

  const {
    flat: templateFlat,
    active: templateActive,
    setActive: setTemplateActive,
    onInput: templateOnInput,
    onKeyDown: templateOnKeyDown,
  } = useFilteredList<TemplateOption>({
    items: () => templateItems(),
    key: (x) => x?.value,
    filterKeys: ["label", "description", "value"],
    onSelect: handleTemplateSelect,
  })

  const addPart = (part: Prompt[number]) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const cursorPosition = getCursorPosition(editorRef)
    const currentPrompt = parseFromDOM()
    const rawText = promptText(currentPrompt)
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
    }

    if (part.type === "text") {
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
  }

  const popover = () => (
    <div
      ref={(el) => {
        if (store.popover === "slash") slashPopoverRef = el
      }}
      classList={{
        "origin-bottom-left max-h-80 min-h-10 overflow-auto no-scrollbar flex flex-col p-2 rounded-md z-50": true,
        "border border-border-base bg-surface-raised-stronger-non-alpha shadow-md": true,
        "absolute inset-x-0 -top-3 -translate-y-full": !props.portal,
        fixed: !!props.portal,
      }}
      style={
        props.portal
          ? {
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              transform: "translateY(-100%)",
            }
          : undefined
      }
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
                    <Show when={cmd.type === "custom" && cmd.source !== "command"}>
                      <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                        {cmd.source === "skill"
                          ? language.t("prompt.slash.badge.skill")
                          : cmd.source === "mcp"
                            ? language.t("prompt.slash.badge.mcp")
                            : language.t("prompt.slash.badge.custom")}
                      </span>
                    </Show>
                    <Show when={props.slash.keybind?.(cmd.id)}>
                      <span class="text-12-regular text-text-subtle">{props.slash.keybind?.(cmd.id)}</span>
                    </Show>
                  </div>
                </button>
              )}
            </For>
          </Show>
        </Match>
        <Match when={store.popover === "template"}>
          <Show
            when={templateFlat().length > 0}
            fallback={<div class="text-text-weak px-2 py-1">{language.t("prompt.popover.emptyResults")}</div>}
          >
            <For each={templateFlat()}>
              {(item) => (
                <button
                  classList={{
                    "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                    "bg-surface-raised-base-hover": templateActive() === item.value,
                  }}
                  onClick={() => handleTemplateSelect(item)}
                  onMouseEnter={() => setTemplateActive(item.value)}
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-14-regular text-text-strong whitespace-nowrap">{item.label}</span>
                    <Show when={item.description}>
                      <span class="text-14-regular text-text-weak truncate">{item.description}</span>
                    </Show>
                  </div>
                  <span class="text-12-regular text-text-subtle shrink-0">{item.value}</span>
                </button>
              )}
            </For>
          </Show>
        </Match>
      </Switch>
    </div>
  )

  return (
    <div class={props.class}>
      <Show when={store.popover}>
        <Switch>
          <Match when={props.portal}>
            <Portal mount={props.portalMount}>{popover()}</Portal>
          </Match>
          <Match when={!props.portal}>{popover()}</Match>
        </Switch>
      </Show>
      <div
        class="relative max-h-[240px] overflow-y-auto"
        ref={(el) => {
          scrollRef = el
          props.scrollRef?.(el)
        }}
      >
        <div
          data-component="prompt-input"
          ref={(el) => {
            editorRef = el
            props.ref?.(el)
          }}
          role="textbox"
          aria-multiline="true"
          aria-label={props.placeholder}
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
            "font-mono!": mode() === "shell",
            [props.editorClass ?? ""]: !!props.editorClass,
          }}
        />
        <Show when={props.showPlaceholder ?? !promptText(props.value).trim()}>
          <div class="absolute top-0 inset-x-0 p-3 pr-12 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate">
            {props.placeholder}
          </div>
        </Show>
      </div>
    </div>
  )
}

function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as { content: string }).content) return false
    if (partA.type === "file" && partA.path !== (partB as FileAttachmentPart).path) return false
    if (partA.type === "agent" && partA.name !== (partB as AgentPart).name) return false
  }
  return true
}

export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const segments = content.split("\n")
  segments.forEach((segment, index) => {
    if (segment) {
      fragment.appendChild(document.createTextNode(segment))
    }
    if (!segment && segments.length > 1) {
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

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

export function setCursorPosition(parent: HTMLElement, position: number) {
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
