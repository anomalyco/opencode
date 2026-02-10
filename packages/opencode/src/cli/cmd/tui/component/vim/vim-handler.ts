import type { Accessor } from "solid-js"
import type { createVimState } from "./vim-state"
import type { TextareaRenderable } from "@opentui/core"
import { vimScroll, type VimScroll } from "./vim-scroll"
import { vimJump, type VimJump } from "./vim-motion-jump"
import {
  appendAfterCursor,
  appendLineEnd,
  deleteLine,
  deleteUnderCursor,
  deleteWord,
  insertLineStart,
  moveBigWordEnd,
  moveBigWordNext,
  moveBigWordPrev,
  moveFirstNonWhitespace,
  moveLeft,
  moveLineBeginning,
  moveLineDown,
  moveLineUp,
  moveRight,
  moveLineEnd,
  moveWordEnd,
  moveWordNext,
  moveWordPrev,
  openLineAbove,
  openLineBelow,
  substituteLine,
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
  scroll: (action: VimScroll) => void
  jump: (action: VimJump) => void
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

      const scroll = vimScroll(event)
      if (scroll) {
        input.state.clearPending()
        input.scroll(scroll)
        event.preventDefault()
        return true
      }

      const jump = vimJump(event, input.state)
      if (jump.handled) {
        if (jump.action) {
          input.state.clearPending()
          input.jump(jump.action)
        }
        event.preventDefault()
        return true
      }

      if (key === "escape") {
        if (!input.state.pending()) return false
        input.state.clearPending()
        event.preventDefault()
        return true
      }

      if (input.state.pending() === "c") {
        if (key === "c" && !event.shift && !hasModifier(event)) {
          substituteLine(input.textarea())
          input.state.clearPending()
          input.state.setMode("insert")
          event.preventDefault()
          return true
        }

        if (key === "w" && !event.shift && !hasModifier(event)) {
          deleteWord(input.textarea())
          input.state.clearPending()
          input.state.setMode("insert")
          event.preventDefault()
          return true
        }

        if (hasModifier(event)) {
          input.state.clearPending()
          return false
        }

        input.state.clearPending()
      }

      if (input.state.pending() === "d") {
        if (key === "d" && !event.shift && !hasModifier(event)) {
          deleteLine(input.textarea())
          input.state.clearPending()
          event.preventDefault()
          return true
        }

        if (key === "w" && !event.shift && !hasModifier(event)) {
          deleteWord(input.textarea())
          input.state.clearPending()
          event.preventDefault()
          return true
        }

        if (hasModifier(event)) {
          input.state.clearPending()
          return false
        }

        input.state.clearPending()
      }

      if (key === "return" && !hasModifier(event)) {
        input.submit()
        input.state.clearPending()
        event.preventDefault()
        return true
      }

      if (key === "c" && !event.shift && !hasModifier(event)) {
        input.state.setPending("c")
        event.preventDefault()
        return true
      }

      if (key === "d" && !event.shift && !hasModifier(event)) {
        input.state.setPending("d")
        event.preventDefault()
        return true
      }

      if (isShifted(event, "s") && !hasModifier(event)) {
        input.state.clearPending()
        substituteLine(input.textarea())
        input.state.setMode("insert")
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

      if (key === "0" && !event.shift && !hasModifier(event)) {
        moveLineBeginning(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "^" && !hasModifier(event)) {
        moveFirstNonWhitespace(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "$" && !hasModifier(event)) {
        moveLineEnd(input.textarea())
        event.preventDefault()
        return true
      }

      if (key === "x" && !event.shift && !hasModifier(event)) {
        deleteUnderCursor(input.textarea())
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
