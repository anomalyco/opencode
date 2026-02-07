import type { Accessor } from "solid-js"
import type { createVimState } from "./vim-state"
import type { TextareaRenderable } from "@opentui/core"
import {
  appendAfterCursor,
  appendLineEnd,
  insertLineStart,
  moveBigWordEnd,
  moveBigWordNext,
  moveBigWordPrev,
  moveLeft,
  moveLineDown,
  moveLineUp,
  moveRight,
  moveWordEnd,
  moveWordNext,
  moveWordPrev,
  openLineAbove,
  openLineBelow,
} from "./vim-motions"

export type VimEvent = {
  name?: string
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  super?: boolean
  preventDefault: () => void
}

export function createVimHandler(input: {
  enabled: Accessor<boolean>
  state: ReturnType<typeof createVimState>
  textarea: Accessor<TextareaRenderable>
  submit: () => void
}) {
  function hasModifier(event: VimEvent) {
    return !!event.ctrl || !!event.meta || !!event.super
  }

  function isPrintable(event: VimEvent) {
    return !!event.name && event.name.length === 1
  }

  function isShifted(event: VimEvent, key: string) {
    return event.name === key.toUpperCase() || (event.name === key && !!event.shift)
  }

  return {
    handleKey(event: VimEvent) {
      if (!input.enabled()) return false

      if (input.state.isInsert()) {
        if (event.name !== "escape") return false
        input.state.setMode("normal")
        event.preventDefault()
        return true
      }

      const key = event.name ?? ""
      if (key === "return" && !hasModifier(event)) {
        input.submit()
        event.preventDefault()
        return true
      }

      if (key === "i" && !event.shift && !hasModifier(event)) {
        input.state.setMode("insert")
        event.preventDefault()
        return true
      }

      if (isShifted(event, "i") && !hasModifier(event)) {
        insertLineStart(input.textarea())
        input.state.setMode("insert")
        event.preventDefault()
        return true
      }

      if (key === "a" && !event.shift && !hasModifier(event)) {
        appendAfterCursor(input.textarea())
        input.state.setMode("insert")
        event.preventDefault()
        return true
      }

      if (isShifted(event, "a") && !hasModifier(event)) {
        appendLineEnd(input.textarea())
        input.state.setMode("insert")
        event.preventDefault()
        return true
      }

      if (key === "o" && !event.shift && !hasModifier(event)) {
        openLineBelow(input.textarea())
        input.state.setMode("insert")
        event.preventDefault()
        return true
      }

      if (isShifted(event, "o") && !hasModifier(event)) {
        openLineAbove(input.textarea())
        input.state.setMode("insert")
        event.preventDefault()
        return true
      }

      if (key === "h" && !event.shift && !hasModifier(event)) {
        moveLeft(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "l" && !event.shift && !hasModifier(event)) {
        moveRight(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "j" && !event.shift && !hasModifier(event)) {
        moveLineDown(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "k" && !event.shift && !hasModifier(event)) {
        moveLineUp(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "w" && !event.shift && !hasModifier(event)) {
        moveWordNext(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "b" && !event.shift && !hasModifier(event)) {
        moveWordPrev(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "e" && !event.shift && !hasModifier(event)) {
        moveWordEnd(input.textarea())
        event.preventDefault()
        return true
      }

      if (isShifted(event, "w") && !hasModifier(event)) {
        moveBigWordNext(input.textarea())
        event.preventDefault()
        return true
      }

      if (isShifted(event, "b") && !hasModifier(event)) {
        moveBigWordPrev(input.textarea())
        event.preventDefault()
        return true
      }

      if (isShifted(event, "e") && !hasModifier(event)) {
        moveBigWordEnd(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "/" && !event.shift && !hasModifier(event)) {
        input.state.setMode("insert")
        return false
      }

      if (key === "backspace" || key === "delete") {
        event.preventDefault()
        return true
      }

      if (isPrintable(event) && !hasModifier(event)) {
        event.preventDefault()
        return true
      }

      return false
    },
  }
}
