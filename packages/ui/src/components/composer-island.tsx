import { type Component, createSignal, createEffect, on, onMount, onCleanup, For, Show, createMemo, Index, Switch, Match } from "solid-js"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { useElementHeight, useFilteredList } from "@opencode-ai/ui/hooks"
import { Button } from "./button"
import { IconButton } from "./icon-button"
import { Icon } from "./icon"
import { RadioGroup } from "./radio-group"
import { AnimatedNumber } from "./animated-number"
import { TextReveal } from "./text-reveal"
import { Checkbox } from "./checkbox"
import { TextStrikethrough } from "./text-strikethrough"

/**
 * Composer Island — Storybook-only dynamic island composer
 *
 * Feature parity tracking vs real prompt-input:
 * ✅ contentEditable editor with natural height growth
 * ✅ Placeholder overlay
 * ✅ Max height (200px) + hidden scrollbar
 * ✅ Enter to submit, Shift+Enter for newline
 * ✅ Question mode with option selection + crossfade
 * ✅ Todo tray with collapse/expand + spring animations
 * ✅ Shell height spring animation
 * ✅ @-mention popover (file/agent items with filtered list)
 * ✅ /-slash command popover
 * ✅ Inline file/agent pills in contentEditable
 * ✅ Shell mode (! prefix, monospace font)
 * ✅ Prompt history (up/down arrow navigation)
 * ✅ IME composition handling
 * ✅ Image attachments (paste/drag with thumbnail bar)
 * TODO: Context items bar (attached files above editor)
 * TODO: Drag overlay for file drops (visual indicator)
 * TODO: Cursor scroll-into-view management
 */
export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

export type AtOption =
  | { type: "agent"; name: string; display: string }
  | { type: "file"; path: string; display: string }

export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  type: "builtin" | "custom"
}

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export interface ComposerIslandProps {
  mode?: "input" | "question"
  questionText?: string
  questionOptions?: Array<{ label: string; description?: string }>
  questionMultiple?: boolean
  placeholder?: string
  value?: string
  onValueChange?: (value: string) => void
  onSubmit?: () => void
  agentName?: string
  modelName?: string
  variant?: string
  todos?: TodoItem[]
  showTodos?: boolean
  todoCollapsed?: boolean
  onTodoCollapseChange?: (collapsed: boolean) => void
  heightSpring?: { visualDuration: number; bounce: number }
  morphSpring?: { visualDuration: number; bounce: number }
  atOptions?: AtOption[]
  slashCommands?: SlashCommand[]
}

const COLLAPSED_HEIGHT = 78
const SUBTITLE = { duration: 600, travel: 25, edge: 17 }
const COUNT = { duration: 600, mask: 18, maskHeight: 0, widthDuration: 560 }

// Default mock data
const DEFAULT_AT_OPTIONS: AtOption[] = [
  { type: "file", path: "src/auth.ts", display: "src/auth.ts" },
  { type: "file", path: "src/middleware.ts", display: "src/middleware.ts" },
  { type: "file", path: "src/routes/login.ts", display: "src/routes/login.ts" },
  { type: "file", path: "src/utils/token.ts", display: "src/utils/token.ts" },
  { type: "file", path: "src/config/database.ts", display: "src/config/database.ts" },
  { type: "agent", name: "coder", display: "coder" },
  { type: "agent", name: "reviewer", display: "reviewer" },
  { type: "agent", name: "planner", display: "planner" },
]

const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { id: "help", trigger: "help", title: "Help", description: "Show available commands", type: "builtin" },
  { id: "clear", trigger: "clear", title: "Clear", description: "Clear conversation", type: "builtin" },
  { id: "compact", trigger: "compact", title: "Compact", description: "Compact conversation history", type: "builtin" },
  { id: "init", trigger: "init", title: "Init", description: "Initialize CLAUDE.md", type: "builtin" },
  { id: "review", trigger: "review", title: "Review", description: "Review code changes", type: "custom" },
  { id: "test", trigger: "test", title: "Test", description: "Run tests", type: "custom" },
]

// ─── Editor DOM utilities (simplified from packages/app) ────────────────

function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const segments = content.split("\n")
  segments.forEach((segment, index) => {
    if (segment) fragment.appendChild(document.createTextNode(segment))
    if (index < segments.length - 1) fragment.appendChild(document.createElement("br"))
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
  for (const child of Array.from(node.childNodes)) length += getTextLength(child)
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
      if (remaining === 0) range.setStartBefore(node)
      else if (isPill) range.setStartAfter(node)
      else {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) range.setStart(next, 0)
        else range.setStartAfter(node)
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= length
    node = node.nextSibling
  }
  // Fallback: end
  const fallbackRange = document.createRange()
  fallbackRange.selectNodeContents(parent)
  fallbackRange.collapse(false)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(fallbackRange)
}

function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  let remaining = offset
  for (const node of Array.from(parent.childNodes)) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"
    if (isText && remaining <= length) {
      if (edge === "start") range.setStart(node, remaining)
      else range.setEnd(node, remaining)
      return
    }
    if ((isPill || isBreak) && remaining <= length) {
      if (edge === "start") remaining === 0 ? range.setStartBefore(node) : range.setStartAfter(node)
      else remaining === 0 ? range.setEndBefore(node) : range.setEndAfter(node)
      return
    }
    remaining -= length
  }
}

function createPill(type: "file" | "agent", content: string, path?: string) {
  const pill = document.createElement("span")
  pill.textContent = content
  pill.setAttribute("data-type", type)
  if (type === "file" && path) pill.setAttribute("data-path", path)
  if (type === "agent") pill.setAttribute("data-name", content.replace("@", ""))
  pill.setAttribute("contenteditable", "false")
  pill.style.userSelect = "text"
  pill.style.cursor = "default"
  return pill
}

function parseEditorText(editor: HTMLElement): string {
  let text = ""
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent ?? "").replace(/\u200B/g, "")
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.dataset.type === "file" || el.dataset.type === "agent") {
      text += el.textContent ?? ""
      return
    }
    if (el.tagName === "BR") {
      text += "\n"
      return
    }
    for (const child of Array.from(el.childNodes)) visit(child)
  }
  const children = Array.from(editor.childNodes)
  children.forEach((child, index) => {
    const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
    visit(child)
    if (isBlock && index < children.length - 1) text += "\n"
  })
  return text
}

function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || (event as any).keyCode === 229
}

// ─── Component ────────────────────────────────────────────────────────

export const ComposerIsland: Component<ComposerIslandProps> = (props) => {
  const [value, setValue] = createSignal(props.value ?? "")
  const [selectedOptions, setSelectedOptions] = createSignal<string[]>([])
  const [customAnswer, setCustomAnswer] = createSignal("")
  const [showCustom, setShowCustom] = createSignal(false)
  const [shellMode, setShellMode] = createSignal<"shell" | "normal">("normal")
  const [editorMode, setEditorMode] = createSignal<"normal" | "shell">("normal")
  const [composing, setComposing] = createSignal(false)
  const [popover, setPopover] = createSignal<"at" | "slash" | null>(null)
  const [imageAttachments, setImageAttachments] = createSignal<ImageAttachment[]>([])
  let editorRef!: HTMLDivElement

  // History
  const [history, setHistory] = createSignal<string[]>([])
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [savedText, setSavedText] = createSignal<string | null>(null)

  const isQuestion = () => props.mode === "question"
  const isMulti = () => props.questionMultiple ?? false

  // @-mention filtered list
  const atOptions = () => props.atOptions ?? DEFAULT_AT_OPTIONS
  const atKey = (item: AtOption) => (item.type === "file" ? item.path : `agent:${item.name}`)
  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: atOptions,
    key: atKey,
    filterKeys: ["display", "name", "path"],
    onSelect: (item) => {
      if (!item) return
      insertAtMention(item)
    },
  })

  // Slash commands filtered list
  const slashCommands = () => props.slashCommands ?? DEFAULT_SLASH_COMMANDS
  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x.id,
    filterKeys: ["trigger", "title"],
    onSelect: (item) => {
      if (!item) return
      insertSlashCommand(item)
    },
  })

  // Insert @mention pill
  const insertAtMention = (item: AtOption) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const cursor = getCursorPosition(editorRef)
    const text = parseEditorText(editorRef)
    const textBefore = text.substring(0, cursor)
    const atMatch = textBefore.match(/@(\S*)$/)

    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const label = item.type === "file" ? item.path : `@${item.name}`
    const pill = createPill(item.type, label, item.type === "file" ? item.path : undefined)
    const gap = document.createTextNode(" ")

    if (atMatch) {
      const start = atMatch.index ?? cursor - atMatch[0].length
      setRangeEdge(editorRef, range, "start", start)
      setRangeEdge(editorRef, range, "end", cursor)
    }

    range.deleteContents()
    range.insertNode(gap)
    range.insertNode(pill)
    range.setStartAfter(gap)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)

    handleInput()
    setPopover(null)
  }

  // Insert slash command
  const insertSlashCommand = (cmd: SlashCommand) => {
    editorRef.textContent = ""
    editorRef.appendChild(document.createTextNode(`/${cmd.trigger} `))
    setCursorPosition(editorRef, cmd.trigger.length + 2)
    handleInput()
    setPopover(null)
  }

  // Handle editor input
  const handleInput = () => {
    const text = parseEditorText(editorRef)
    setValue(text)
    props.onValueChange?.(text)
    measureEditor()

    if (editorMode() !== "shell") {
      const cursor = getCursorPosition(editorRef)
      const textBefore = text.substring(0, cursor)
      const atMatch = textBefore.match(/@(\S*)$/)
      const slashMatch = text.match(/^\/(\S*)$/)

      if (atMatch) {
        atOnInput(atMatch[1])
        setPopover("at")
      } else if (slashMatch) {
        slashOnInput(slashMatch[1])
        setPopover("slash")
      } else {
        setPopover(null)
      }
    } else {
      setPopover(null)
    }

    // Reset history navigation on input
    setHistoryIndex(-1)
    setSavedText(null)
  }

  // Keyboard handler
  const handleKeyDown = (event: KeyboardEvent) => {
    // Shell mode toggle: ! at position 0
    if (event.key === "!" && editorMode() === "normal") {
      const cursor = getCursorPosition(editorRef)
      if (cursor === 0 && !value()) {
        setEditorMode("shell")
        event.preventDefault()
        return
      }
    }

    // Escape
    if (event.key === "Escape") {
      if (popover()) {
        setPopover(null)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (editorMode() === "shell") {
        setEditorMode("normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    // Backspace in shell mode with empty input
    if (editorMode() === "shell" && event.key === "Backspace") {
      const text = parseEditorText(editorRef)
      if (!text) {
        setEditorMode("normal")
        event.preventDefault()
        return
      }
    }

    // Shift+Enter for newline
    if (event.key === "Enter" && event.shiftKey) {
      // Let browser handle — it inserts a <br> in contentEditable
      return
    }

    // IME check
    if (event.key === "Enter" && isImeComposing(event)) return

    // Popover keyboard navigation
    if (popover()) {
      if (event.key === "Tab") {
        if (popover() === "at") {
          const selected = atFlat().find((x) => atKey(x) === atActive())
          if (selected) insertAtMention(selected)
        } else {
          const selected = slashFlat().find((x) => x.id === slashActive())
          if (selected) insertSlashCommand(selected)
        }
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      if (nav) {
        if (popover() === "at") atOnKeyDown(event)
        else slashOnKeyDown(event)
        event.preventDefault()
        return
      }
    }

    // History navigation
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (popover()) return

      const text = parseEditorText(editorRef)
      const cursor = getCursorPosition(editorRef)
      const entries = history()
      const direction = event.key === "ArrowUp" ? "up" : "down"

      if (direction === "up") {
        if (cursor !== 0 && historyIndex() < 0) return
        if (entries.length === 0) return
        if (historyIndex() < 0) {
          setSavedText(text)
          setHistoryIndex(0)
          setEditorText(entries[0])
        } else if (historyIndex() < entries.length - 1) {
          setHistoryIndex(historyIndex() + 1)
          setEditorText(entries[historyIndex()])
        }
        event.preventDefault()
        return
      } else {
        if (historyIndex() < 0) return
        if (historyIndex() > 0) {
          setHistoryIndex(historyIndex() - 1)
          setEditorText(entries[historyIndex()])
        } else {
          setHistoryIndex(-1)
          setEditorText(savedText() ?? "")
          setSavedText(null)
        }
        event.preventDefault()
        return
      }
    }

    // Enter to submit
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      const text = parseEditorText(editorRef).trim()
      if (text) {
        // Add to history
        setHistory((prev) => {
          if (prev[0] === text) return prev
          return [text, ...prev].slice(0, 50)
        })
      }
      props.onSubmit?.()
    }
  }

  const setEditorText = (text: string) => {
    editorRef.textContent = ""
    if (text) {
      editorRef.appendChild(createTextFragment(text))
      setCursorPosition(editorRef, text.length)
    }
    setValue(text)
    props.onValueChange?.(text)
    measureEditor()
  }

  // ─── Image attachment handling ─────────────────────────────────────
  let idCounter = 0
  const addImageFile = (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImageAttachments((prev) => [
        ...prev,
        {
          id: `img-${++idCounter}-${Date.now()}`,
          filename: file.name,
          mime: file.type,
          dataUrl,
        },
      ])
    }
    reader.readAsDataURL(file)
  }

  const removeImageAttachment = (id: string) => {
    setImageAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handlePaste = (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    const items = Array.from(clipboardData.items)
    const imageItems = items.filter((item) => item.kind === "file" && ACCEPTED_IMAGE_TYPES.includes(item.type))

    if (imageItems.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) addImageFile(file)
      }
      return
    }

    // For plain text paste, use execCommand to preserve contentEditable behavior
    const plainText = clipboardData.getData("text/plain")
    if (plainText) {
      event.preventDefault()
      document.execCommand("insertText", false, plainText)
    }
  }

  // Drag & drop
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    const dropped = event.dataTransfer?.files
    if (!dropped) return
    for (const file of Array.from(dropped)) {
      if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        addImageFile(file)
      }
    }
  }

  // Measure editor height directly from the contentEditable's scrollHeight
  // Editor padding: pt-2 (8px) + pb-2 (8px) = 16px
  // Max scroll container: 200px, so max content = 200 - 16 = 184px
  // Button row below scroll area: ~40px (32px button + 8px pb)
  const EDITOR_PADDING = 16
  const MAX_EDITOR_CONTENT = 200 - EDITOR_PADDING
  const BUTTON_ROW_HEIGHT = 40
  const [editorHeight, setEditorHeight] = createSignal(24)
  const measureEditor = () => {
    if (!editorRef) return
    const raw = editorRef.scrollHeight - EDITOR_PADDING
    setEditorHeight(Math.min(MAX_EDITOR_CONTENT, Math.max(24, raw)))
  }

  // Measure question sizer via hidden div
  const [questionSizerRef, setQuestionSizerRef] = createSignal<HTMLDivElement>()
  const questionHeight = useElementHeight(questionSizerRef, 280)

  // Image bar height: size-16 (64px) + pt-3 (12px) + gap = ~80px when visible, 0 when hidden
  const IMAGE_BAR_HEIGHT = 80
  const imageBarHeight = createMemo(() => (imageAttachments().length > 0 ? IMAGE_BAR_HEIGHT : 0))

  // Shell = editor content + editor padding + button row + image bar
  const shellPaddingInput = EDITOR_PADDING + BUTTON_ROW_HEIGHT
  const shellPaddingQuestion = 16
  const targetHeight = createMemo(() =>
    isQuestion() ? questionHeight() + shellPaddingQuestion : editorHeight() + shellPaddingInput + imageBarHeight(),
  )

  // Spring directly to target pixel height
  const animatedHeight = useSpring(targetHeight, () => props.heightSpring ?? { visualDuration: 0.35, bounce: 0.2 })

  // Crossfade spring 0→1
  const morphTarget = () => (isQuestion() ? 1 : 0)
  const morph = useSpring(morphTarget, () => props.morphSpring ?? { visualDuration: 0.25, bounce: 0.1 })

  // Crossfade values — overlapping so both visible simultaneously
  const inputOpacity = createMemo(() => Math.max(0, 1 - morph() * 1.5))
  const inputScale = createMemo(() => 1 + morph() * 0.15)
  const inputBlur = createMemo(() => morph() * 5)

  const questionOpacity = createMemo(() => Math.max(0, morph() * 1.5 - 0.5))
  const questionScale = createMemo(() => 0.85 + morph() * 0.15)
  const questionBlur = createMemo(() => (1 - morph()) * 5)

  const toggleOption = (label: string) => {
    if (isMulti()) {
      setSelectedOptions((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
    } else {
      setSelectedOptions([label])
    }
  }

  const isSelected = (label: string) => selectedOptions().includes(label)

  // Shared question content (used in both sizer and visible layer)
  const QuestionContent = () => (
    <>
      <div data-slot="question-content">
        <div data-slot="question-text">{props.questionText}</div>
        <Show when={isMulti()} fallback={<div data-slot="question-hint">Select an option</div>}>
          <div data-slot="question-hint">Select one or more options</div>
        </Show>
        <div data-slot="question-options">
          <For each={props.questionOptions}>
            {(opt) => {
              const picked = () => isSelected(opt.label)
              return (
                <button data-slot="question-option" data-picked={picked()} onClick={() => toggleOption(opt.label)}>
                  <span data-slot="question-option-check" aria-hidden="true">
                    <span
                      data-slot="question-option-box"
                      data-type={isMulti() ? "checkbox" : "radio"}
                      data-picked={picked()}
                    >
                      <Show when={isMulti()} fallback={<span data-slot="question-option-radio-dot" />}>
                        <Icon name="check-small" size="small" />
                      </Show>
                    </span>
                  </span>
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{opt.label}</span>
                    <Show when={opt.description}>
                      <span data-slot="option-description">{opt.description}</span>
                    </Show>
                  </span>
                </button>
              )
            }}
          </For>

          {/* Custom answer option */}
          <Show
            when={showCustom()}
            fallback={
              <button
                data-slot="question-option"
                data-custom="true"
                data-picked={false}
                onClick={() => setShowCustom(true)}
              >
                <span data-slot="question-option-check" aria-hidden="true">
                  <span
                    data-slot="question-option-box"
                    data-type={isMulti() ? "checkbox" : "radio"}
                    data-picked={false}
                  >
                    <Show when={isMulti()} fallback={<span data-slot="question-option-radio-dot" />}>
                      <Icon name="check-small" size="small" />
                    </Show>
                  </span>
                </span>
                <span data-slot="question-option-main">
                  <span data-slot="option-label">Type your own answer...</span>
                </span>
              </button>
            }
          >
            <form
              data-slot="question-option"
              data-custom="true"
              data-picked={customAnswer().trim().length > 0}
              onMouseDown={(e) => {
                if (e.target instanceof HTMLTextAreaElement) return
                const input = e.currentTarget.querySelector('[data-slot="question-custom-input"]')
                if (input instanceof HTMLTextAreaElement) input.focus()
              }}
              onSubmit={(e) => e.preventDefault()}
            >
              <span data-slot="question-option-check" aria-hidden="true">
                <span
                  data-slot="question-option-box"
                  data-type={isMulti() ? "checkbox" : "radio"}
                  data-picked={customAnswer().trim().length > 0}
                >
                  <Show when={isMulti()} fallback={<span data-slot="question-option-radio-dot" />}>
                    <Icon name="check-small" size="small" />
                  </Show>
                </span>
              </span>
              <span data-slot="question-option-main">
                <span data-slot="option-label">Type your own answer...</span>
                <textarea
                  data-slot="question-custom-input"
                  placeholder="Type your answer..."
                  value={customAnswer()}
                  onInput={(e) => setCustomAnswer(e.currentTarget.value)}
                  rows={1}
                  autofocus
                />
              </span>
            </form>
          </Show>
        </div>
      </div>
    </>
  )

  // Todo scroll state
  const [todoStuck, setTodoStuck] = createSignal(false)
  let todoScrollRef: HTMLDivElement | undefined

  // Todo tray state — controlled by props if provided
  const [todoCollapsed, _setTodoCollapsed] = createSignal(props.todoCollapsed ?? false)
  createEffect(
    on(
      () => props.todoCollapsed,
      (v) => {
        if (v !== undefined) _setTodoCollapsed(v)
      },
      { defer: true },
    ),
  )
  const setTodoCollapsed = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(todoCollapsed()) : v
    _setTodoCollapsed(next)
    props.onTodoCollapseChange?.(next)
  }
  const hasTodos = () => (props.todos?.length ?? 0) > 0 && (props.showTodos ?? false) && !isQuestion()
  const todoProgress = useSpring(() => (hasTodos() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const todoCollapseProgress = useSpring(() => (todoCollapsed() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })

  const todos = () => props.todos ?? []
  const total = createMemo(() => todos().length)
  const done = createMemo(() => todos().filter((t) => t.status === "completed").length)

  // Active todo for collapsed preview
  const active = createMemo(
    () =>
      todos().find((t) => t.status === "in_progress") ??
      todos().find((t) => t.status === "pending") ??
      todos()
        .filter((t) => t.status === "completed")
        .at(-1) ??
      todos()[0],
  )
  const preview = createMemo(() => active()?.content ?? "")

  // Measure todo content height — spring it so adding/removing todos animates
  const [todoContentRef, setTodoContentRef] = createSignal<HTMLDivElement>()
  const todoContentHeightRaw = useElementHeight(todoContentRef, 200)
  const todoContentHeight = useSpring(() => Math.max(COLLAPSED_HEIGHT, todoContentHeightRaw()), {
    visualDuration: 0.3,
    bounce: 0,
  })
  const todoFullHeight = todoContentHeight
  const todoVisibleHeight = createMemo(() => {
    const full = todoFullHeight()
    const collapsed = full - todoCollapseProgress() * (full - COLLAPSED_HEIGHT)
    return collapsed * todoProgress()
  })

  // hide = max of collapse and dock-progress-out (for blur/opacity on list)
  const shut = createMemo(() => 1 - todoProgress())
  const hide = createMemo(() => Math.max(todoCollapseProgress(), shut()))

  // Shell-todo overlap (matches real margin-top: -36px * progress)
  const todoOverlap = createMemo(() => 36 * todoProgress())

  // Measure bottom tray height
  const [trayRef, setTrayRef] = createSignal<HTMLDivElement>()
  const trayHeight = useElementHeight(trayRef, 42)
  // Tray overlaps under the shell by 14px (matches DockTray attach="top" margin-top: -0.875rem)
  const trayOverlap = 14
  const totalHeight = createMemo(
    () => todoVisibleHeight() - todoOverlap() + animatedHeight() + trayHeight() - trayOverlap,
  )

  return (
    <div
      data-component="composer-island"
      data-mode={props.mode}
      style={{
        width: "100%",
        "max-width": "720px",
        margin: "0 auto",
        position: "relative",
        height: `${totalHeight()}px`,
      }}
    >
      {/* Tray — sits behind the shell, pinned to bottom */}
      <div
        ref={setTrayRef}
        data-dock-surface="tray"
        data-dock-attach="top"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          "z-index": 0,
          height: "58px",
          "border-color": "light-dark(#dcd9d9, #3e3a3a)",
        }}
      >
        {/* Input mode tray — crossfades out */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "22px 7px 8px",
            gap: "8px",
            opacity: inputOpacity(),
            filter: `blur(${inputBlur()}px)`,
            "pointer-events": morph() > 0.5 ? "none" : "auto",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "6px", "min-width": 0, flex: 1 }}>
            <Button variant="ghost" size="normal">
              {props.agentName ?? "Ask"}
              <Icon name="chevron-down" size="small" />
            </Button>
            <Button variant="ghost" size="normal">
              <Icon name="brain" size="small" />
              {props.modelName ?? "GPT-4"}
              <Icon name="chevron-down" size="small" />
            </Button>
            <Button variant="ghost" size="normal">
              {props.variant ?? "Default"}
              <Icon name="chevron-down" size="small" />
            </Button>
          </div>
          <RadioGroup
            options={["shell", "normal"] as const}
            current={shellMode()}
            onSelect={setShellMode}
            value={(mode) => mode}
            label={(mode) => <Icon name={mode === "shell" ? "console" : "prompt"} class="size-[18px]" />}
            fill
            pad="none"
            class="w-[68px] shrink-0"
          />
        </div>

        {/* Question mode tray — crossfades in */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "22px 8px 8px",
            opacity: questionOpacity(),
            filter: `blur(${questionBlur()}px)`,
            "pointer-events": morph() < 0.5 ? "none" : "auto",
          }}
        >
          <Button variant="ghost" size="normal">
            Dismiss
          </Button>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Button variant="secondary" size="normal">
              Back
            </Button>
            <Button variant="primary" size="normal">
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Todo tray — sits above the shell */}
      <Show when={todoProgress() > 0.001}>
        <div
          data-dock-surface="tray"
          style={{
            position: "absolute",
            bottom: `${trayHeight() - trayOverlap + animatedHeight() - todoOverlap()}px`,
            left: 0,
            right: 0,
            "z-index": 5,
            "max-height": `${todoVisibleHeight()}px`,
            "overflow-x": "visible",
            "overflow-y": "hidden",
            "border-color": "light-dark(#dcd9d9, #3e3a3a)",
            "pointer-events": todoProgress() < 0.98 ? "none" : "auto",
            transform: `translateY(${(1 - todoProgress()) * 12}px)`,
          }}
        >
          <div ref={setTodoContentRef}>
            {/* Todo header */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                padding: "8px 8px 8px 12px",
                height: "40px",
                cursor: "pointer",
                overflow: "visible",
              }}
              onClick={() => setTodoCollapsed((v) => !v)}
            >
              <span
                style={{
                  "font-size": "14px",
                  color: "var(--text-strong)",
                  "white-space": "nowrap",
                  display: "inline-flex",
                  "align-items": "baseline",
                  "flex-shrink": 0,
                  overflow: "visible",
                  cursor: "default",
                  "--tool-motion-odometer-ms": `${COUNT.duration}ms`,
                  "--tool-motion-mask": `${COUNT.mask}%`,
                  "--tool-motion-mask-height": `${COUNT.maskHeight}px`,
                  "--tool-motion-spring-ms": `${COUNT.widthDuration}ms`,
                  opacity: `${1 - shut()}`,
                  filter: shut() > 0.01 ? `blur(${shut() * 2}px)` : "none",
                }}
              >
                <AnimatedNumber value={done()} />
                <span style={{ margin: "0 4px" }}>of</span>
                <AnimatedNumber value={total()} />
                <span>&nbsp;tasks completed</span>
              </span>

              {/* Collapsed preview text */}
              <div
                style={{
                  "margin-left": "4px",
                  "min-width": 0,
                  overflow: "hidden",
                  flex: "1 1 auto",
                  "max-width": "100%",
                }}
              >
                <TextReveal
                  class="text-14-regular text-text-base cursor-default"
                  text={todoCollapsed() ? preview() : undefined}
                  duration={SUBTITLE.duration}
                  travel={SUBTITLE.travel}
                  edge={SUBTITLE.edge}
                  spring="cubic-bezier(0.34, 1, 0.64, 1)"
                  springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
                  growOnly
                  truncate
                />
              </div>

              <div style={{ "margin-left": "auto" }}>
                <IconButton
                  icon="chevron-down"
                  size="normal"
                  variant="ghost"
                  style={{ transform: `rotate(${todoCollapseProgress() * 180}deg)` }}
                  onMouseDown={(e: MouseEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation()
                    setTodoCollapsed((v) => !v)
                  }}
                  aria-label={todoCollapsed() ? "Expand" : "Collapse"}
                />
              </div>
            </div>

            {/* Todo list */}
            <div
              style={{
                position: "relative",
                opacity: `${1 - hide()}`,
                filter: hide() > 0.01 ? `blur(${hide() * 2}px)` : "none",
                visibility: hide() > 0.98 ? "hidden" : "visible",
                "pointer-events": hide() > 0.1 ? "none" : "auto",
              }}
            >
              <div style={{ position: "relative" }}>
                <div
                  ref={(el) => {
                    todoScrollRef = el
                  }}
                  class="no-scrollbar"
                  style={{
                    padding: "0 12px 44px",
                    display: "flex",
                    "flex-direction": "column",
                    gap: "6px",
                    "max-height": "200px",
                    "overflow-y": "auto",
                    "overflow-anchor": "none",
                  }}
                  onScroll={(e) => setTodoStuck(e.currentTarget.scrollTop > 0)}
                >
                  <Index each={todos()}>
                    {(todo) => (
                      <Checkbox
                        readOnly
                        checked={todo().status === "completed"}
                        indeterminate={todo().status === "in_progress"}
                        data-state={todo().status}
                        style={{
                          "--checkbox-align": "flex-start",
                          "--checkbox-offset": "1px",
                          transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                          opacity: todo().status === "pending" ? "0.5" : "1",
                        }}
                      >
                        <TextStrikethrough
                          active={todo().status === "completed" || todo().status === "cancelled"}
                          text={todo().content}
                          class="text-14-regular min-w-0 break-words"
                          style={{
                            "line-height": "var(--line-height-normal)",
                            transition: "color 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                            color:
                              todo().status === "completed" || todo().status === "cancelled"
                                ? "var(--text-weak)"
                                : "var(--text-strong)",
                          }}
                        />
                      </Checkbox>
                    )}
                  </Index>
                </div>
                {/* Top fade */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "16px",
                    background: "linear-gradient(to bottom, var(--background-base), transparent)",
                    "pointer-events": "none",
                    opacity: todoStuck() ? 1 : 0,
                    transition: "opacity 150ms ease",
                    "z-index": 2,
                  }}
                />
                {/* Bottom fade */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: "56px",
                    background: "linear-gradient(to bottom, transparent, var(--background-base) 85%)",
                    "pointer-events": "none",
                    "z-index": 2,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Popover — positioned above the shell */}
      <Show when={popover()}>
        <div
          class="absolute left-0 right-0 max-h-80 min-h-10
                   overflow-auto no-scrollbar flex flex-col p-2 rounded-[12px]
                   bg-surface-raised-stronger-non-alpha shadow-[var(--shadow-lg-border-base)]"
          style={{
            bottom: `${trayHeight() - trayOverlap + animatedHeight() + 8}px`,
            "z-index": 100,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Switch>
            <Match when={popover() === "at"}>
              <Show when={atFlat().length > 0} fallback={<div class="text-text-weak px-2 py-1">No results</div>}>
                <For each={atFlat().slice(0, 10)}>
                  {(item) => {
                    const key = atKey(item)
                    return (
                      <button
                        class="w-full flex items-center gap-x-2 rounded-md px-2 py-0.5"
                        classList={{ "bg-surface-raised-base-hover": atActive() === key }}
                        onClick={() => insertAtMention(item)}
                        onMouseEnter={() => setAtActive(key)}
                      >
                        <Icon
                          name={item.type === "agent" ? "brain" : "file-tree"}
                          size="small"
                          class={item.type === "agent" ? "text-icon-info-active shrink-0" : "text-icon-base shrink-0"}
                        />
                        <span class="text-14-regular text-text-strong whitespace-nowrap">
                          {item.type === "agent" ? `@${item.name}` : item.path}
                        </span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </Match>
            <Match when={popover() === "slash"}>
              <Show when={slashFlat().length > 0} fallback={<div class="text-text-weak px-2 py-1">No commands</div>}>
                <For each={slashFlat()}>
                  {(cmd) => (
                    <button
                      classList={{
                        "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                        "bg-surface-raised-base-hover": slashActive() === cmd.id,
                      }}
                      onClick={() => insertSlashCommand(cmd)}
                      onMouseEnter={() => setSlashActive(cmd.id)}
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-14-regular text-text-strong whitespace-nowrap">/{cmd.trigger}</span>
                        <Show when={cmd.description}>
                          <span class="text-14-regular text-text-weak truncate">{cmd.description}</span>
                        </Show>
                      </div>
                      <Show when={cmd.type === "custom"}>
                        <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                          custom
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </Match>
          </Switch>
        </div>
      </Show>

      {/* Shell — main content area */}
      <div
        data-dock-surface="shell"
        style={{
          position: "absolute",
          bottom: `${trayHeight() - trayOverlap}px`,
          left: 0,
          right: 0,
          "z-index": 10,
          height: `${animatedHeight()}px`,
          "box-shadow": `0 0 0 1px light-dark(#cfcecd, #595353), 0 1px 2px -1px rgba(19,16,16,0.04), 0 1px 2px 0 rgba(19,16,16,0.06), 0 1px 3px 0 rgba(19,16,16,0.08)`,
        }}
      >
        {/* Hidden sizer for question height measurement */}
        <div
          ref={setQuestionSizerRef}
          data-component="dock-prompt"
          data-kind="question"
          aria-hidden="true"
          style={{ position: "absolute", visibility: "hidden", left: 0, right: 0, "pointer-events": "none" }}
        >
          <div data-slot="question-body" style={{ padding: "8px 8px 0" }}>
            <div data-slot="question-content">
              <div data-slot="question-text">{props.questionText}</div>
              <div data-slot="question-hint">{isMulti() ? "Select one or more options" : "Select an option"}</div>
              <div data-slot="question-options" style={{ overflow: "hidden" }}>
                <For each={props.questionOptions}>
                  {(opt) => (
                    <div data-slot="question-option" style={{ "pointer-events": "none" }}>
                      <span data-slot="question-option-main">
                        <span data-slot="option-label">{opt.label}</span>
                        <Show when={opt.description}>
                          <span data-slot="option-description">{opt.description}</span>
                        </Show>
                      </span>
                    </div>
                  )}
                </For>
                <div data-slot="question-option" style={{ "pointer-events": "none" }}>
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">Type your own answer...</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Input content layer — crossfades out */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "flex-direction": "column",
            opacity: inputOpacity(),
            transform: `scale(${inputScale()})`,
            filter: `blur(${inputBlur()}px)`,
            "pointer-events": morph() > 0.5 ? "none" : "auto",
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Image attachment thumbnails */}
          <Show when={imageAttachments().length > 0}>
            <div class="flex flex-wrap gap-2 px-3 pt-3">
              <For each={imageAttachments()}>
                {(attachment) => (
                  <div class="relative group">
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.filename}
                      class="size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => removeImageAttachment(attachment.id)}
                      class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
                      aria-label="Remove attachment"
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

          {/* Shell mode indicator */}
          <Show when={editorMode() === "shell"}>
            <div
              class="px-3 pt-1.5 pb-0 flex items-center gap-1.5"
              style={{ "font-size": "11px", color: "var(--text-weak)" }}
            >
              <Icon name="console" size="small" class="text-icon-base" />
              <span>Shell mode</span>
              <span class="text-text-subtle ml-1">ESC to exit</span>
            </div>
          </Show>

          <div class="relative max-h-[200px] overflow-y-auto no-scrollbar" style={{ flex: 1 }}>
            <div
              data-component="prompt-input"
              ref={(el) => {
                editorRef = el
                requestAnimationFrame(measureEditor)
              }}
              role="textbox"
              aria-multiline="true"
              aria-label={props.placeholder ?? "Ask anything..."}
              contentEditable={true}
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              class="select-text w-full pl-3 pr-2 pt-2 pb-2 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap"
              classList={{
                "font-mono!": editorMode() === "shell",
                "[&_[data-type=file]]:text-syntax-property": true,
                "[&_[data-type=agent]]:text-syntax-type": true,
              }}
            />
            <Show when={!value()}>
              <div
                class="absolute top-0 inset-x-0 pl-3 pr-2 pt-2 pb-2 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
                classList={{ "font-mono!": editorMode() === "shell" }}
              >
                {editorMode() === "shell" ? "Enter a shell command..." : (props.placeholder ?? "Ask anything...")}
              </div>
            </Show>
          </div>
          {/* Action buttons row */}
          <div class="flex items-center justify-between px-2 pb-2 shrink-0">
            <Button
              variant="ghost"
              class="size-6"
              style={{ display: "flex", "align-items": "center", "justify-content": "center" }}
              aria-label="Auto-accept"
            >
              <Icon name="chevron-double-right" size="small" />
            </Button>
            <div class="flex items-center gap-1">
              <Button variant="ghost" class="size-8 p-0" aria-label="Add attachment">
                <Icon name="plus" class="size-4.5" />
              </Button>
              <IconButton
                icon="arrow-up"
                variant="primary"
                class="size-8"
                disabled={value().trim().length === 0 && imageAttachments().length === 0}
                aria-label="Send"
              />
            </div>
          </div>
        </div>

        {/* Question content layer — crossfades in */}
        <div
          data-component="dock-prompt"
          data-kind="question"
          style={{
            position: "absolute",
            inset: 0,
            opacity: questionOpacity(),
            transform: `scale(${questionScale()})`,
            filter: `blur(${questionBlur()}px)`,
            "pointer-events": morph() < 0.5 ? "none" : "auto",
          }}
        >
          <div data-slot="question-body" style={{ padding: "8px 8px 0" }}>
            <QuestionContent />
          </div>
        </div>
      </div>
    </div>
  )
}
