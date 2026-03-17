import { createMemo, type Accessor } from "solid-js"
import { matchKeybind, parseKeybind } from "@/context/command"
import { useSettings } from "@/context/settings"
import { canNavigateHistoryAtCursor } from "./history"

const ATTACH = "mod+u"
const ABORT = "ctrl+g"

type Caret = {
  collapsed: boolean
  cursorPosition: number
  textLength: number
}

type Input = {
  mode: Accessor<"normal" | "shell">
  popover: Accessor<"at" | "slash" | null>
  historyIndex: Accessor<number>
  working: Accessor<boolean>
  escBlur: () => boolean
  pick: () => void
  closePopover: () => void
  setMode: (mode: "normal" | "shell") => void
  blur: () => void
  abort: () => void
  addLine: () => void
  submit: (event: KeyboardEvent) => void
  isIme: (event: KeyboardEvent) => boolean
  getCaret: () => Caret
  getCursor: () => number
  getText: () => string
  pickPopover: () => void
  atKey: (event: KeyboardEvent) => void
  slashKey: (event: KeyboardEvent) => void
  history: (direction: "up" | "down") => boolean
}

export function usePromptTextareaKeybindings() {
  const settings = useSettings()

  const binds = createMemo(() => ({
    attach: parseKeybind(settings.keybinds.get("file.attach") ?? ATTACH),
    abort: parseKeybind(ABORT),
  }))

  const ctrl = (event: KeyboardEvent) => event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

  return {
    attach: (event: KeyboardEvent) => matchKeybind(binds().attach, event),
    abort: (event: KeyboardEvent) => matchKeybind(binds().abort, event),
    close: (event: KeyboardEvent) => event.key === "Escape",
    shell: (event: KeyboardEvent) => event.key === "!" && !event.metaKey && !event.ctrlKey && !event.altKey,
    submit: (event: KeyboardEvent) => event.key === "Enter" && !event.shiftKey,
    newline: (event: KeyboardEvent) => event.key === "Enter" && event.shiftKey,
    tab: (event: KeyboardEvent) => event.key === "Tab",
    history: (event: KeyboardEvent) => event.key === "ArrowUp" || event.key === "ArrowDown",
    popover: (event: KeyboardEvent) =>
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      (ctrl(event) && (event.key === "n" || event.key === "p")),
    historyEnabled: () => settings.general.historyArrows(),
  }
}

export function createPromptInputKeydown(input: Input) {
  const key = usePromptTextareaKeybindings()

  const handleKeyDown = (event: KeyboardEvent) => {
    if (key.attach(event)) {
      event.preventDefault()
      if (input.mode() !== "normal") return
      input.pick()
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

    if (key.shell(event) && input.mode() === "normal") {
      if (input.getCursor() === 0) {
        input.setMode("shell")
        input.closePopover()
        event.preventDefault()
        return
      }
    }

    if (key.close(event)) {
      if (input.popover()) {
        input.closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (input.mode() === "shell") {
        input.setMode("normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (input.working()) {
        input.abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (input.escBlur()) {
        input.blur()
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    if (input.mode() === "shell") {
      const state = input.getCaret()
      if (event.key === "Backspace" && state.collapsed && state.cursorPosition === 0 && state.textLength === 0) {
        input.setMode("normal")
        event.preventDefault()
        return
      }
    }

    if (key.newline(event)) {
      input.addLine()
      event.preventDefault()
      return
    }

    if (key.submit(event) && input.isIme(event)) {
      return
    }

    if (input.popover()) {
      if (key.tab(event)) {
        input.pickPopover()
        event.preventDefault()
        return
      }

      if (key.popover(event)) {
        if (input.popover() === "at") {
          input.atKey(event)
          event.preventDefault()
          return
        }
        if (input.popover() === "slash") {
          input.slashKey(event)
        }
        event.preventDefault()
        return
      }
    }

    if (key.abort(event)) {
      if (input.popover()) {
        input.closePopover()
        event.preventDefault()
        return
      }
      if (input.working()) {
        input.abort()
        event.preventDefault()
      }
      return
    }

    if (key.historyEnabled() && key.history(event)) {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (!input.getCaret().collapsed) return

      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, input.getText(), input.getCursor(), input.historyIndex() >= 0)) return
      if (input.history(direction)) {
        event.preventDefault()
      }
      return
    }

    if (key.submit(event)) {
      input.submit(event)
    }
  }

  return { handleKeyDown }
}
