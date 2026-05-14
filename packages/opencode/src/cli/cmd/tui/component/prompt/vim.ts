import type { KeyBinding as TextareaKeyBinding } from "@opentui/core"
import { isFindKey, reverseFind, vimKeyName } from "./vim-keys"
import {
  clampOffset,
  findCharacter,
  firstNonBlankInLine,
  aroundWordRange,
  innerWordRange,
  lineBounds,
  lineOffset,
  nextWordStart,
  operatorFindRange,
  operatorMotionRange,
  prevWordStart,
  wordEnd,
  type OperatorMotion,
  type TextRange,
} from "./vim-motion"
import type { PromptKeyEvent, VimMode, VimOperator, VimRuntime } from "./vim-types"

export type { PromptKeyEvent, VimFindType, VimLastFind, VimMode, VimOperator, VimPendingFind, VimPendingOperator, VimRuntime } from "./vim-types"
export { lineBounds } from "./vim-motion"

export function createVimTextareaBindings(enabled: boolean, mode: VimMode): TextareaKeyBinding[] {
  if (!enabled || mode !== "normal") return []
  return [{ name: "return", action: "submit" }]
}

function clearPendingG(runtime: VimRuntime) {
  if (runtime.pendingG) runtime.setPendingG(false)
}

function clearPending(runtime: VimRuntime) {
  clearPendingG(runtime)
  if (runtime.pendingOperator) runtime.setPendingOperator(undefined)
  if (runtime.pendingFind) runtime.setPendingFind(undefined)
}

function moveCursorLine(runtime: VimRuntime, delta: number) {
  runtime.moveCursor(lineOffset(runtime.text, runtime.cursor, delta))
}

function applyOperator(runtime: VimRuntime, op: VimOperator, range: TextRange) {
  const from = clampOffset(runtime.text, Math.min(range.start, range.end))
  const to = clampOffset(runtime.text, Math.max(range.start, range.end))
  if (from === to) return

  const nextText = `${runtime.text.slice(0, from)}${runtime.text.slice(to)}`
  runtime.replaceText(nextText)
  runtime.moveCursor(Math.min(from, nextText.length))
  runtime.syncPromptInput()
  clearPending(runtime)

  if (op === "change") {
    runtime.setMode("insert")
    runtime.writeMarker("change")
  }
}

function handlePendingOperator(event: PromptKeyEvent, runtime: VimRuntime) {
  const pending = runtime.pendingOperator
  if (!pending || event.ctrl || event.meta) return false

  const name = vimKeyName(event)
  event.preventDefault()

  if (name === "escape") {
    clearPending(runtime)
    return true
  }

  if (pending.find) {
    const range = operatorFindRange(runtime.text, runtime.cursor, name, pending.find)
    if (range) {
      applyOperator(runtime, pending.op, range)
      runtime.setLastFind({ find: pending.find, char: name })
    } else {
      clearPending(runtime)
    }
    return true
  }

  if (!pending.textObjectScope && (name === "i" || name === "a")) {
    runtime.setPendingOperator({ op: pending.op, textObjectScope: name === "i" ? "inner" : "around" })
    runtime.writeMarker(`pending-${pending.op}-${name}`)
    return true
  }

  if (pending.textObjectScope && name === "w") {
    const range = pending.textObjectScope === "around" ? aroundWordRange(runtime.text, runtime.cursor) : innerWordRange(runtime.text, runtime.cursor)
    if (range) applyOperator(runtime, pending.op, range)
    else clearPending(runtime)
    return true
  }

  if (!pending.textObjectScope && isOperatorMotion(name)) {
    const range = operatorMotionRange(runtime.text, runtime.cursor, name)
    if (range) applyOperator(runtime, pending.op, range)
    else clearPending(runtime)
    return true
  }

  if (!pending.textObjectScope && isFindKey(name)) {
    runtime.setPendingOperator({ op: pending.op, find: name })
    runtime.writeMarker(`pending-${pending.op}-${name}`)
    return true
  }

  clearPending(runtime)
  return true
}

function handlePendingFind(event: PromptKeyEvent, runtime: VimRuntime) {
  const pending = runtime.pendingFind
  if (!pending || event.ctrl || event.meta) return false

  const name = vimKeyName(event)
  event.preventDefault()

  if (name === "escape") {
    clearPending(runtime)
    return true
  }

  const target = findCharacter(runtime.text, runtime.cursor, name, pending.find)
  if (target !== undefined) {
    runtime.moveCursor(target)
    runtime.setLastFind({ find: pending.find, char: name })
  }
  clearPending(runtime)
  return true
}

function repeatFind(runtime: VimRuntime, reverse: boolean) {
  const lastFind = runtime.lastFind
  if (!lastFind) return
  const find = reverse ? reverseFind(lastFind.find) : lastFind.find
  const cursor = find === "t" ? runtime.cursor + 1 : find === "T" ? runtime.cursor - 1 : runtime.cursor
  const target = findCharacter(runtime.text, cursor, lastFind.char, find)
  if (target !== undefined) runtime.moveCursor(target)
}

function enterInsert(runtime: VimRuntime, kind: "insert" | "append") {
  clearPending(runtime)
  if (kind === "append" && runtime.cursor < runtime.text.length) runtime.moveCursor(runtime.cursor + 1)
  runtime.setMode("insert")
  runtime.writeMarker(kind === "append" ? "append" : "insert")
}

function exitInsert(runtime: VimRuntime) {
  clearPending(runtime)
  if (runtime.cursor > 0) runtime.moveCursor(runtime.cursor - 1)
  runtime.setMode("normal")
  runtime.writeMarker("normal")
}

function openLine(runtime: VimRuntime, direction: "above" | "below") {
  const bounds = lineBounds(runtime.text, runtime.cursor)
  const insertAt = direction === "below" ? bounds.end : bounds.start
  const prefix = runtime.text.slice(0, insertAt)
  const suffix = runtime.text.slice(insertAt)
  const newline = direction === "below" ? "\n" : ""
  const nextText = direction === "below" ? `${prefix}${newline}${suffix}` : `${prefix}\n${suffix}`
  runtime.replaceText(nextText)
  runtime.moveCursor(direction === "below" ? insertAt + 1 : insertAt)
  runtime.syncPromptInput()
  enterInsert(runtime, "insert")
}

function deleteCharacter(runtime: VimRuntime) {
  if (runtime.cursor >= runtime.text.length) return
  const nextText = `${runtime.text.slice(0, runtime.cursor)}${runtime.text.slice(runtime.cursor + 1)}`
  runtime.replaceText(nextText)
  runtime.moveCursor(Math.min(runtime.cursor, nextText.length))
  runtime.syncPromptInput()
}

function isOperatorMotion(name: string): name is OperatorMotion {
  return name === "b" || name === "e" || name === "w" || name === "0" || name === "$"
}

function startOperator(runtime: VimRuntime, op: VimOperator) {
  runtime.setPendingOperator({ op })
  runtime.writeMarker(op === "delete" ? "pending-delete" : "pending-change")
}

function handleNormalCommand(name: string, event: PromptKeyEvent, runtime: VimRuntime) {
  if (event.ctrl && event.name === "d") return prevent(event, () => moveCursorLine(runtime, 3))
  if (event.ctrl && event.name === "u") return prevent(event, () => moveCursorLine(runtime, -3))
  if (event.name === "escape") return prevent(event, () => clearPending(runtime))
  if (!event.ctrl && !event.meta && name === "g") return prevent(event, () => handleG(runtime))
  if (!event.ctrl && !event.meta && name === "G") return prevent(event, () => runtime.moveCursor(runtime.text.length))

  clearPending(runtime)

  if (!event.ctrl && !event.meta && name === "d") return prevent(event, () => startOperator(runtime, "delete"))
  if (!event.ctrl && !event.meta && name === "c") return prevent(event, () => startOperator(runtime, "change"))
  if (!event.ctrl && !event.meta && name === "i") return prevent(event, () => enterInsert(runtime, "insert"))
  if (!event.ctrl && !event.meta && name === "I") return prevent(event, () => enterInsertAt(runtime, firstNonBlankInLine(runtime.text, runtime.cursor)))
  if (!event.ctrl && !event.meta && name === "a") return prevent(event, () => enterInsert(runtime, "append"))
  if (!event.ctrl && !event.meta && name === "A") return prevent(event, () => enterInsertAt(runtime, lineBounds(runtime.text, runtime.cursor).end))
  if (!event.ctrl && !event.meta && name === "h") return prevent(event, () => runtime.moveCursor(runtime.cursor - 1))
  if (!event.ctrl && !event.meta && name === "l") return prevent(event, () => runtime.moveCursor(runtime.cursor + 1))
  if (!event.ctrl && !event.meta && name === "j") return prevent(event, () => moveCursorLine(runtime, 1))
  if (!event.ctrl && !event.meta && name === "k") return prevent(event, () => moveCursorLine(runtime, -1))
  if (!event.ctrl && !event.meta && name === "0") return prevent(event, () => runtime.moveCursor(lineBounds(runtime.text, runtime.cursor).start))
  if (!event.ctrl && !event.meta && name === "$") return prevent(event, () => runtime.moveCursor(lineBounds(runtime.text, runtime.cursor).end))
  if (!event.ctrl && !event.meta && name === "^") return prevent(event, () => runtime.moveCursor(firstNonBlankInLine(runtime.text, runtime.cursor)))
  if (!event.ctrl && !event.meta && (name === "w" || name === "W")) return prevent(event, () => runtime.moveCursor(nextWordStart(runtime.text, runtime.cursor)))
  if (!event.ctrl && !event.meta && (name === "b" || name === "B")) return prevent(event, () => runtime.moveCursor(prevWordStart(runtime.text, runtime.cursor)))
  if (!event.ctrl && !event.meta && (name === "e" || name === "E")) return prevent(event, () => runtime.moveCursor(wordEnd(runtime.text, runtime.cursor)))
  if (!event.ctrl && !event.meta && name === "x") return prevent(event, () => deleteCharacter(runtime))
  if (!event.ctrl && !event.meta && name === "o") return prevent(event, () => openLine(runtime, "below"))
  if (!event.ctrl && !event.meta && name === "O") return prevent(event, () => openLine(runtime, "above"))
  if (!event.ctrl && !event.meta && isFindKey(name)) return prevent(event, () => startFind(runtime, name))
  if (!event.ctrl && !event.meta && (name === ";" || name === ",")) return prevent(event, () => repeatFind(runtime, name === ","))

  event.preventDefault()
}

function prevent(event: PromptKeyEvent, action: () => void) {
  event.preventDefault()
  action()
}

function handleG(runtime: VimRuntime) {
  if (runtime.pendingG) {
    runtime.setPendingG(false)
    runtime.moveCursor(0)
    return
  }
  runtime.setPendingG(true)
  runtime.writeMarker("pending-g")
}

function enterInsertAt(runtime: VimRuntime, offset: number) {
  runtime.moveCursor(offset)
  enterInsert(runtime, "insert")
}

function startFind(runtime: VimRuntime, find: "f" | "F" | "t" | "T") {
  runtime.setPendingFind({ find })
  runtime.writeMarker(`pending-${find}`)
}

export function handleVimPromptKeyDown(event: PromptKeyEvent, runtime: VimRuntime) {
  if (!runtime.enabled) {
    clearPending(runtime)
    return
  }

  if (runtime.mode === "insert") {
    if (event.name === "escape") {
      event.preventDefault()
      exitInsert(runtime)
    }
    return
  }

  if (event.name === "return" && !event.ctrl && !event.meta && !event.shift) {
    clearPending(runtime)
    return
  }

  if (handlePendingOperator(event, runtime)) return
  if (handlePendingFind(event, runtime)) return

  handleNormalCommand(vimKeyName(event), event, runtime)
}
