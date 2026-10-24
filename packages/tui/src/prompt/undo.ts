import type { PromptInfo } from "./history"

export type PromptUndoState = {
  input: string
  parts: PromptInfo["parts"]
  mode: "normal" | "shell"
  cursor: number
}

export const PromptUndoDepthDefault = 500
export const PromptUndoPauseMs = 1000

type Change = "insert" | "delete" | "bulk"

// The prompt's undo history. Each entry is the prompt as it was before a group of edits.
//
// Typing coalesces into groups that end where a new word starts, after a pause, when the caret
// moves, or when typing switches between inserting and deleting. Anything else - a paste, a word
// or line delete, a newline, clearing or submitting the prompt, recalling history - is a group of
// its own. A long paragraph comes back a word at a time, and one ctrl+u comes back in one step.
//
// It lives outside any one prompt component, because the prompt is remounted when the route
// changes, and undo after a submit brings back what was sent.
export function createPromptUndo(options?: { depth?: () => number; now?: () => number }) {
  const depth = () => options?.depth?.() ?? PromptUndoDepthDefault
  const now = options?.now ?? Date.now
  const undoStack: PromptUndoState[] = []
  const redoStack: PromptUndoState[] = []
  let last: PromptUndoState | undefined
  let lastChange: Change | undefined
  let lastTime = 0
  let breakNext = true

  function push(state: PromptUndoState) {
    undoStack.push(state)
    if (undoStack.length > depth()) undoStack.splice(0, undoStack.length - depth())
    redoStack.length = 0
  }

  function restart(state: PromptUndoState) {
    last = state
    lastChange = undefined
    breakNext = true
  }

  return {
    // The prompt after an edit or a caret move.
    observe(state: PromptUndoState) {
      if (!last) return restart(state)
      if (state.input === last.input && state.mode === last.mode) {
        if (!sameParts(state.parts, last.parts)) {
          push(last)
          return restart(state)
        }
        if (state.cursor !== last.cursor) breakNext = true
        last = state
        return
      }
      const change = classify(last.input, state.input, state.mode !== last.mode)
      const time = now()
      if (
        breakNext ||
        change.kind === "bulk" ||
        change.kind !== lastChange ||
        time - lastTime > PromptUndoPauseMs ||
        change.wordStart ||
        change.newline
      )
        push(last)
      last = state
      lastChange = change.kind
      lastTime = time
      breakNext = change.kind === "bulk" || change.newline
    },
    // The prompt as it is now, without recording a change, after it was set by undo or redo.
    sync: restart,
    undo(current: PromptUndoState) {
      const target = undoStack.pop()
      if (!target) return
      redoStack.push(current)
      restart(target)
      return target
    },
    redo(current: PromptUndoState) {
      const target = redoStack.pop()
      if (!target) return
      undoStack.push(current)
      restart(target)
      return target
    },
    get size() {
      return { undo: undoStack.length, redo: redoStack.length }
    },
  }
}

export type PromptUndo = ReturnType<typeof createPromptUndo>

// Keys that arrive in one read, when typing outpaces a busy event loop, are recorded together.
// Up to this many characters inserted at once still count as typing; a paste is usually longer.
const TypingBurst = 16

// Typing is one character deleted, or a short run inserted, at one point; any other difference is
// a bulk change.
function classify(before: string, after: string, modeChanged: boolean) {
  const bulk = { kind: "bulk" as const, wordStart: false, newline: false }
  if (modeChanged) return bulk
  const limit = Math.min(before.length, after.length)
  let start = 0
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (end < limit - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end))
    end++
  const inserted = after.slice(start, after.length - end)
  const deleted = before.slice(start, before.length - end)
  if (inserted && deleted) return bulk
  if (deleted) {
    if (Array.from(deleted).length !== 1) return bulk
    return { kind: "delete" as const, wordStart: false, newline: deleted === "\n" }
  }
  if (inserted === "\n") return { kind: "insert" as const, wordStart: false, newline: true }
  if (inserted.includes("\n") || Array.from(inserted).length > TypingBurst) return bulk
  const chars = Array.from(inserted)
  // A character that starts a word, after whitespace, begins a new group.
  const wordStart = chars.some((char, index) => {
    const previous = index === 0 ? after[start - 1] : chars[index - 1]
    return !/\s/.test(char) && previous !== undefined && /\s/.test(previous)
  })
  return { kind: "insert" as const, wordStart, newline: false }
}

function sameParts(a: PromptInfo["parts"], b: PromptInfo["parts"]) {
  if (a.length !== b.length) return false
  return a.every((part, index) => {
    const other = b[index]
    if (part.type !== other.type) return false
    if (part.type === "text" && other.type === "text") return part.text === other.text
    if (part.type === "file" && other.type === "file") return part.url === other.url
    if (part.type === "agent" && other.type === "agent") return part.name === other.name
    return true
  })
}

// A copy of the parts the store cannot change later. Positions are rewritten in place as the
// text moves; the pasted text and file data are strings and are shared, not copied.
export function copyPromptParts(parts: PromptInfo["parts"]): PromptInfo["parts"] {
  return parts.map((part) => {
    if (part.type === "agent") return part.source ? { ...part, source: { ...part.source } } : { ...part }
    if (part.type === "file")
      return part.source ? { ...part, source: { ...part.source, text: { ...part.source.text } } } : { ...part }
    return part.source ? { ...part, source: { ...part.source, text: { ...part.source.text } } } : { ...part }
  })
}
