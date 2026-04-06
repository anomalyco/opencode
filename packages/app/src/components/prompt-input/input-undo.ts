import type { Prompt } from "@/context/prompt"
import { clonePromptParts, promptLength } from "./history"

export const INPUT_UNDO_LIMIT = 100
export const INPUT_UNDO_WINDOW = 800

export type InputUndoEntry = {
  prompt: Prompt
  cursor: number
}

export type InputUndoState = {
  entries: InputUndoEntry[]
  index: number
}

type InputUndoRecordInput = {
  state: InputUndoState
  next: InputUndoEntry
  prev: InputUndoEntry
  time: number
  last: number
}

function clone(entry: InputUndoEntry): InputUndoEntry {
  return {
    prompt: clonePromptParts(entry.prompt),
    cursor: entry.cursor,
  }
}

function equal(a: Prompt, b: Prompt) {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (!x || !y || x.type !== y.type) return false
    if (x.type === "text" && x.content !== (y.type === "text" ? y.content : "")) return false
    if (x.type === "agent" && x.name !== (y.type === "agent" ? y.name : "")) return false
    if (x.type === "image" && x.id !== (y.type === "image" ? y.id : "")) return false
    if (x.type === "file") {
      if (y.type !== "file" || x.path !== y.path) return false
      const aSel = x.selection
      const bSel = y.selection
      const same =
        (!aSel && !bSel) ||
        (!!aSel &&
          !!bSel &&
          aSel.startLine === bSel.startLine &&
          aSel.startChar === bSel.startChar &&
          aSel.endLine === bSel.endLine &&
          aSel.endChar === bSel.endChar)
      if (!same) return false
    }
  }

  return true
}

function text(prompt: Prompt) {
  return prompt.map((part) => ("content" in part ? part.content : "")).join("")
}

function diff(prev: string, next: string) {
  if (prev === next) return { start: prev.length, prev: "", next: "" }

  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) {
    start += 1
  }

  let prevEnd = prev.length
  let nextEnd = next.length
  while (prevEnd > start && nextEnd > start && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd -= 1
    nextEnd -= 1
  }

  return {
    start,
    prev: prev.slice(start, prevEnd),
    next: next.slice(start, nextEnd),
  }
}

function mergeable(prev: InputUndoEntry, next: InputUndoEntry, time: number, last: number) {
  if (time - last > INPUT_UNDO_WINDOW) return false
  if (prev.prompt.some((part) => part.type !== "text")) return false
  if (next.prompt.some((part) => part.type !== "text")) return false

  const a = text(prev.prompt)
  const b = text(next.prompt)
  const change = diff(a, b)

  if (change.prev.length === 0 && change.next.length === 1) {
    return next.cursor === change.start + change.next.length
  }

  if (change.next.length === 0 && change.prev.length === 1) {
    return next.cursor === change.start
  }

  return false
}

export function createInputUndoEntry(prompt: Prompt, cursor = promptLength(prompt)): InputUndoEntry {
  return {
    prompt: clonePromptParts(prompt),
    cursor,
  }
}

export function createInputUndoState(entry: InputUndoEntry): InputUndoState {
  return {
    entries: [clone(entry)],
    index: 0,
  }
}

export function recordInputUndo(input: InputUndoRecordInput) {
  const current = input.state.entries[input.state.index]
  if (current && equal(current.prompt, input.next.prompt) && current.cursor === input.next.cursor) {
    return input.state
  }

  const entries = input.state.entries.slice(0, input.state.index + 1)
  if (entries.length > 1 && mergeable(input.prev, input.next, input.time, input.last)) {
    entries[entries.length - 1] = clone(input.next)
    return {
      entries,
      index: entries.length - 1,
    } satisfies InputUndoState
  }

  const next = [...entries, clone(input.next)].slice(-INPUT_UNDO_LIMIT)
  return {
    entries: next,
    index: next.length - 1,
  } satisfies InputUndoState
}

export function stepInputUndo(state: InputUndoState, dir: "undo" | "redo") {
  const delta = dir === "undo" ? -1 : 1
  const index = state.index + delta
  const entry = state.entries[index]
  if (!entry) return
  return {
    state: {
      entries: state.entries,
      index,
    } satisfies InputUndoState,
    entry: clone(entry),
  }
}
