import { createEffect, createSignal, on } from "solid-js"
import { useFilteredList } from "@opencode-ai/ui/hooks"
import {
  canNavigateAtCursor,
  cloneParts,
  navigateEntry,
  normalizeEntry,
  partText,
  prependEntry,
  type HistoryEntry,
} from "./history"
import {
  createPill,
  createTextFragment,
  getCursorPosition,
  isImeComposing,
  parseEditorParts,
  parseEditorText,
  setCursorPosition,
  setRangeEdge,
} from "./editor-utils"
import type { AtOption, ComposerHistoryItem, ComposerMode, ComposerPart, ComposerSource, SlashCommand } from "./types"

interface Props {
  value?: string
  onValueChange?: (value: string) => void
  onSubmit?: (input: {
    source: ComposerSource
    mode: ComposerMode
    text: string
    parts: ComposerPart[]
  }) => void | Promise<void>
  onAbort?: () => void | Promise<void>
  onAuto?: () => void | Promise<void>
  onPick?: () => void | Promise<void>
  onModel?: () => void | Promise<void>
  onAgent?: () => void | Promise<void>
  onVariant?: () => void | Promise<void>
  modelKeybind?: string
  agentKeybind?: string
  variantKeybind?: string
  onSlash?: (cmd: SlashCommand) => boolean | Promise<boolean>
  historyRead?: (mode: ComposerMode) => Array<string | ComposerHistoryItem>
  historyWrite?: (mode: ComposerMode, list: ComposerHistoryItem[]) => void
  working?: () => boolean
  atOptions: AtOption[] | ((filter: string) => AtOption[] | Promise<AtOption[]>)
  slashCommands: SlashCommand[] | ((filter: string) => SlashCommand[] | Promise<SlashCommand[]>)
  editor: () => HTMLDivElement | undefined
  measure: () => void
}

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

type Keybind = {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

const normalize = (key: string, code?: string) => {
  if (code === "Quote") return "'"
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  if (key === "Dead" && code === "Quote") return "'"
  return key.toLowerCase()
}

const parse = (config: string | undefined): Keybind[] => {
  if (!config || config === "none") return []
  return config.split(",").map((combo) => {
    const out: Keybind = {
      key: "",
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
    }
    for (const part of combo.trim().toLowerCase().split("+")) {
      if (part === "ctrl" || part === "control") {
        out.ctrl = true
        continue
      }
      if (part === "meta" || part === "cmd" || part === "command") {
        out.meta = true
        continue
      }
      if (part === "mod") {
        if (IS_MAC) out.meta = true
        else out.ctrl = true
        continue
      }
      if (part === "alt" || part === "option") {
        out.alt = true
        continue
      }
      if (part === "shift") {
        out.shift = true
        continue
      }
      out.key = part
    }
    return out
  })
}

const match = (config: string | undefined, event: KeyboardEvent) => {
  const key = normalize(event.key, event.code)
  return parse(config).some((kb) => {
    return (
      kb.key === key &&
      kb.ctrl === !!event.ctrlKey &&
      kb.meta === !!event.metaKey &&
      kb.shift === !!event.shiftKey &&
      kb.alt === !!event.altKey
    )
  })
}

export function useEditor(props: Props) {
  const [value, setValue] = createSignal(props.value ?? "")
  const [mode, setMode] = createSignal<ComposerMode>("normal")
  const [popover, setPopover] = createSignal<"at" | "slash" | null>(null)
  const [composing, setComposing] = createSignal(false)

  const readList = (kind: ComposerMode) => {
    const list = props.historyRead?.(kind) ?? []
    return list.map(normalizeEntry)
  }

  const [history, setHistory] = createSignal<Record<ComposerMode, HistoryEntry[]>>({
    normal: readList("normal"),
    shell: readList("shell"),
  })
  const [index, setIndex] = createSignal(-1)
  const [saved, setSaved] = createSignal<HistoryEntry | null>(null)

  const setList = (next: HistoryEntry[]) => {
    const kind = mode()
    setHistory((prev) => ({ ...prev, [kind]: next }))
    props.historyWrite?.(
      kind,
      next.map((item) => ({
        text: item.text,
        parts: cloneParts(item.parts),
      })),
    )
  }

  const getList = () => history()[mode()]

  const setEditorMode = (next: ComposerMode) => {
    if (next !== mode() && props.historyRead) {
      setHistory((prev) => ({ ...prev, [next]: readList(next) }))
    }
    setMode(next)
    setIndex(-1)
    setSaved(null)
    setPopover(null)
  }

  const atKey = (item: AtOption) => (item.type === "file" ? item.path : `agent:${item.name}`)
  const at = useFilteredList<AtOption>({
    items: props.atOptions,
    key: atKey,
    filterKeys: ["display", "name", "path"],
    onSelect: (item) => {
      if (!item) return
      insertAt(item)
    },
  })

  const slash = useFilteredList<SlashCommand>({
    items: props.slashCommands,
    key: (x) => x.id,
    filterKeys: ["trigger", "title"],
    onSelect: (item) => {
      if (!item) return
      insertSlash(item)
    },
  })

  createEffect(
    on(
      () => props.value,
      (next) => {
        if (next === undefined || next === value()) return
        setText(next)
      },
      { defer: true },
    ),
  )

  const keepCursor = () => {
    const el = props.editor()
    if (!el) return
    const viewport = el.parentElement
    if (!(viewport instanceof HTMLElement)) return
    if (el.scrollHeight <= viewport.clientHeight + 2) return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!el.contains(range.startContainer)) return

    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
    const box = viewport.getBoundingClientRect()
    const pad = Math.max(4, Math.min(12, Math.floor(viewport.clientHeight * 0.25)))
    const top = box.top + pad
    const bottom = box.bottom - pad

    if (rect.top < top) {
      viewport.scrollTop -= top - rect.top
      return
    }

    if (rect.bottom > bottom) {
      viewport.scrollTop += rect.bottom - bottom
    }
  }

  const handleInput = () => {
    const el = props.editor()
    if (!el) return
    const text = parseEditorText(el)
    setValue(text)
    props.onValueChange?.(text)
    props.measure()

    if (mode() !== "shell") {
      const cursor = getCursorPosition(el)
      const head = text.substring(0, cursor)
      const atMatch = head.match(/@(\S*)$/)
      const slashMatch = text.match(/^\/(\S*)$/)

      if (atMatch) {
        at.onInput(atMatch[1] ?? "")
        setPopover("at")
      } else if (slashMatch) {
        slash.onInput(slashMatch[1] ?? "")
        setPopover("slash")
      } else {
        setPopover(null)
      }
    }

    if (mode() === "shell") setPopover(null)

    setIndex(-1)
    setSaved(null)
  }

  const setParts = (parts: ComposerPart[], cursor?: number) => {
    const el = props.editor()
    if (!el) return

    el.textContent = ""

    for (const part of parts) {
      if (part.type === "text") {
        if (!part.content) continue
        el.appendChild(createTextFragment(part.content))
        continue
      }

      if (part.type === "file") {
        el.appendChild(createPill("file", part.content || `@${part.path}`, part.path))
        continue
      }

      el.appendChild(createPill("agent", part.content || `@${part.name}`))
    }

    const text = partText(parts)
    if (cursor === undefined) {
      setCursorPosition(el, text.length)
    } else {
      setCursorPosition(el, cursor)
    }

    setValue(text)
    props.onValueChange?.(text)
    props.measure()
    requestAnimationFrame(keepCursor)
  }

  const setText = (text: string) => {
    setParts([{ type: "text", content: text }], text.length)
  }

  const setEntry = (item: HistoryEntry, cursor: "start" | "end" = "end") => {
    setParts(item.parts, cursor === "start" ? 0 : partText(item.parts).length)
  }

  const deleteSelection = () => {
    const el = props.editor()
    if (!el) return false
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return false
    if (selection.isCollapsed) return false

    const range = selection.getRangeAt(0)
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return false

    range.deleteContents()
    selection.removeAllRanges()
    selection.addRange(range)
    handleInput()
    return true
  }

  const deleteSpan = (start: number, end: number) => {
    const el = props.editor()
    if (!el) return false
    if (start >= end) return false

    const range = document.createRange()
    range.selectNodeContents(el)
    setRangeEdge(el, range, "start", start)
    setRangeEdge(el, range, "end", end)
    range.deleteContents()
    range.collapse(true)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    handleInput()
    return true
  }

  const lineStart = (text: string, cursor: number) => {
    const i = text.lastIndexOf("\n", Math.max(0, cursor - 1))
    if (i < 0) return 0
    return i + 1
  }

  const lineEnd = (text: string, cursor: number) => {
    const i = text.indexOf("\n", cursor)
    if (i < 0) return text.length
    return i
  }

  const deleteWordBackward = () => {
    const el = props.editor()
    if (!el) return false
    const text = parseEditorText(el)
    const cursor = getCursorPosition(el)
    if (cursor <= 0) return false

    let i = cursor
    while (i > 0 && /\s/.test(text[i - 1] ?? "")) i -= 1
    while (i > 0 && !/\s/.test(text[i - 1] ?? "")) i -= 1
    if (i === cursor) i = cursor - 1

    return deleteSpan(i, cursor)
  }

  const deleteLineForward = () => {
    const el = props.editor()
    if (!el) return false
    const text = parseEditorText(el)
    const cursor = getCursorPosition(el)
    if (cursor >= text.length) return false

    let i = lineEnd(text, cursor)
    if (i === cursor && text[i] === "\n") i += 1
    return deleteSpan(cursor, Math.min(i, text.length))
  }

  const deleteLineBackward = () => {
    const el = props.editor()
    if (!el) return false
    const text = parseEditorText(el)
    const cursor = getCursorPosition(el)
    if (cursor <= 0) return false
    return deleteSpan(lineStart(text, cursor), cursor)
  }

  const insertAt = (item: AtOption) => {
    const el = props.editor()
    if (!el) return

    const getRange = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      if (!el.contains(range.startContainer)) return null
      return { selection, range }
    }

    let current = getRange()
    if (!current) {
      el.focus()
      setCursorPosition(el, parseEditorText(el).length)
      current = getRange()
    }
    if (!current) return

    const selection = current.selection
    const range = current.range

    const cursor = getCursorPosition(el)
    const text = parseEditorText(el)
    const head = text.substring(0, cursor)
    const match = head.match(/@(\S*)$/)

    const label = item.type === "file" ? item.path : `@${item.name}`
    const pill = createPill(item.type, label, item.type === "file" ? item.path : undefined)
    const gap = document.createTextNode(" ")

    if (match) {
      const start = match.index ?? cursor - match[0].length
      setRangeEdge(el, range, "start", start)
      setRangeEdge(el, range, "end", cursor)
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

  const applySlash = (cmd: SlashCommand) => {
    const el = props.editor()
    if (!el) return
    el.textContent = ""
    el.appendChild(document.createTextNode(`/${cmd.trigger} `))
    setCursorPosition(el, cmd.trigger.length + 2)
    handleInput()
    setPopover(null)
  }

  const insertSlash = (cmd: SlashCommand) => {
    const run = props.onSlash?.(cmd)
    if (run instanceof Promise) {
      void run
        .then((ok) => {
          if (ok) {
            setText("")
            setPopover(null)
            return
          }
          applySlash(cmd)
        })
        .catch(() => {
          applySlash(cmd)
        })
      return
    }

    if (run) {
      setText("")
      setPopover(null)
      return
    }

    applySlash(cmd)
  }

  const insertFile = (path: string) => {
    insertAt({
      type: "file",
      path,
      display: path,
    })
  }

  const parts = (): ComposerPart[] => {
    const el = props.editor()
    if (!el) return []
    return parseEditorParts(el)
  }

  const submit = (source: ComposerSource) => {
    const el = props.editor()
    if (!el) return

    const text = parseEditorText(el)
    const clean = text.trim()
    const parsed = parseEditorParts(el)
    if (clean) {
      const list = getList()
      const next = {
        text,
        parts: cloneParts(parsed),
      } satisfies HistoryEntry
      const out = prependEntry(list, next)
      if (out !== list) setList(out)
    }

    void props.onSubmit?.({ source, mode: mode(), text, parts: parsed })
  }

  const abort = () => {
    if (!props.working?.()) return
    void props.onAbort?.()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const el = props.editor()
    if (!el) return

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    const cmd = event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    const mod = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey

    if (ctrl && event.key.toLowerCase() === "w") {
      event.preventDefault()
      if (deleteSelection()) return
      deleteWordBackward()
      return
    }

    if (ctrl && event.key === "Backspace") {
      event.preventDefault()
      if (deleteSelection()) return
      deleteWordBackward()
      return
    }

    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.key === "Backspace" && event.altKey) {
      event.preventDefault()
      if (deleteSelection()) return
      deleteWordBackward()
      return
    }

    if (ctrl && event.key.toLowerCase() === "k") {
      event.preventDefault()
      if (deleteSelection()) return
      deleteLineForward()
      return
    }

    if (cmd && event.key === "Backspace") {
      event.preventDefault()
      if (deleteSelection()) return
      deleteLineBackward()
      return
    }

    if (cmd && event.key === "Delete") {
      event.preventDefault()
      if (deleteSelection()) return
      deleteLineForward()
      return
    }

    if (match(props.modelKeybind ?? "mod+'", event)) {
      event.preventDefault()
      event.stopPropagation()
      void props.onModel?.()
      return
    }

    if (match(props.variantKeybind ?? "shift+mod+d", event)) {
      event.preventDefault()
      event.stopPropagation()
      void props.onVariant?.()
      return
    }

    if (match(props.agentKeybind ?? "mod+.", event)) {
      event.preventDefault()
      event.stopPropagation()
      void props.onAgent?.()
      return
    }

    if (mod && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (mode() !== "normal") return
      void props.onPick?.()
      return
    }

    if (event.key === "!" && mode() === "normal") {
      const cursor = getCursorPosition(el)
      if (cursor === 0) {
        setEditorMode("shell")
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (popover()) {
        setPopover(null)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (mode() === "shell") {
        setEditorMode("normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (props.working?.()) {
        abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (mode() === "shell" && event.key === "Backspace") {
      if (!parseEditorText(el).trim()) {
        setEditorMode("normal")
        event.preventDefault()
        return
      }
    }

    if (event.key === "Enter" && event.shiftKey) return
    if (event.key === "Enter" && isImeComposing(event)) return

    if (popover()) {
      if (event.key === "Tab") {
        if (popover() === "at") {
          const selected = at.flat().find((x) => atKey(x) === at.active())
          if (selected) insertAt(selected)
        } else {
          const selected = slash.flat().find((x) => x.id === slash.active())
          if (selected) insertSlash(selected)
        }
        event.preventDefault()
        return
      }

      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (popover() === "at") at.onKeyDown(event)
        else slash.onKeyDown(event)
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (popover()) {
        setPopover(null)
        event.preventDefault()
        return
      }
      abort()
      event.preventDefault()
      return
    }

    const up = event.key === "ArrowUp" || (ctrl && event.key === "p")
    const down = event.key === "ArrowDown" || (ctrl && event.key === "n")
    if (up || down) {
      if (event.altKey || event.metaKey) return
      if (event.ctrlKey && !(event.key === "n" || event.key === "p")) return
      if (popover()) return

      const text = parseEditorText(el)
      const cursor = getCursorPosition(el)
      const list = getList()

      const dir = up ? "up" : "down"
      if (!canNavigateAtCursor(dir, text, cursor, index() >= 0)) return

      const out = navigateEntry({
        direction: dir,
        entries: list,
        historyIndex: index(),
        current: {
          text,
          parts: cloneParts(parseEditorParts(el)),
        },
        saved: saved(),
      })

      if (!out.handled) return
      setIndex(out.historyIndex)
      setSaved(out.saved)
      setEntry(out.entry, out.cursor)
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit("enter")
    }
  }

  return {
    value,
    setValue,
    popover,
    setPopover,
    mode,
    setMode: setEditorMode,
    composing,
    setComposing,
    atKey,
    at,
    slash,
    handleInput,
    handleKeyDown,
    setText,
    submit,
    parts,
    insertAt,
    insertFile,
    insertSlash,
  }
}
