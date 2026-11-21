import { createSignal } from "solid-js"

/**
 * Undo and redo for Settings and Design mode (session only). Each store records the keys it saved
 * with their values before and after; undo and redo hand the values back to the store to apply and
 * save. Changes to the same keys while the pointer is down or within `merge` ms (a slider drag, a
 * run of clicks) become one step.
 */

/** `path` points into an object value, for the toast. */
export type HistoryChange = { key: string; label: string; before: unknown; after: unknown; path?: string[] }

/** A store that history can write back to. */
export type HistoryTarget = {
  apply: (values: { key: string; value: unknown }[]) => void
  /** How a value reads in the toast ("on", "alt 2"), or "" to show only the label. */
  describe: (change: HistoryChange, value: unknown) => string
}

type Entry = {
  target: HistoryTarget
  changes: HistoryChange[]
  label?: string
  group?: string
  at: number
  sealed: boolean
}

const limit = 100
const merge = 500
const undoStack: Entry[] = []
const redoStack: Entry[] = []
const pointer = { down: false }
// Set while a group (several saves that make one step) is open.
const open: { entries?: Entry[]; label?: string } = {}

export const [historyNotice, setHistoryNotice] = createSignal<{ text: string; id: number }>()

/** Records changes from one save. `group` names the keys, so the same keys saved again can merge. */
export function recordHistory(
  target: HistoryTarget,
  changes: HistoryChange[],
  options: { label?: string; group?: string } = {},
) {
  const real = changes.filter((change) => !same(change.before, change.after))
  if (real.length === 0) return
  const now = performance.now()
  if (open.entries) {
    open.entries.push({ target, changes: real, label: options.label, at: now, sealed: true })
    return
  }
  redoStack.length = 0
  const last = undoStack[undoStack.length - 1]
  if (
    last &&
    options.group &&
    last.group === options.group &&
    last.target === target &&
    !last.sealed &&
    (pointer.down || now - last.at < merge)
  ) {
    last.changes = mergeChanges(last.changes, real)
    last.at = now
    if (last.changes.length === 0) undoStack.pop()
    return
  }
  undoStack.push({ target, changes: real, label: options.label, group: options.group, at: now, sealed: false })
  if (undoStack.length > limit) undoStack.shift()
}

/** Runs `run` and records every save inside it as one step. */
export function historyGroup<T>(run: () => T, label?: string) {
  if (open.entries) return run()
  open.entries = []
  open.label = label
  try {
    return run()
  } finally {
    const entries = open.entries
    open.entries = undefined
    if (entries.length > 0) {
      redoStack.length = 0
      undoStack.push({
        target: groupTarget(entries),
        changes: entries.flatMap((entry, index) =>
          entry.changes.map((change) => ({ ...change, key: `${index} ${change.key}` })),
        ),
        label: open.label ?? entries[0].label,
        at: performance.now(),
        sealed: true,
      })
      if (undoStack.length > limit) undoStack.shift()
    }
  }
}

export function undo() {
  const entry = undoStack.pop()
  if (!entry) return false
  entry.target.apply(entry.changes.map((change) => ({ key: change.key, value: change.before })))
  redoStack.push({ ...entry, sealed: true })
  notify("Undid", entry)
  return true
}

export function redo() {
  const entry = redoStack.pop()
  if (!entry) return false
  entry.target.apply(entry.changes.map((change) => ({ key: change.key, value: change.after })))
  undoStack.push({ ...entry, sealed: true })
  notify("Redid", entry)
  return true
}

/** ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redoes, except in text fields (native undo). */
export function historyKey(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return
  const key = event.key.toLowerCase()
  const redoKey = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey)
  if (key !== "z" && !redoKey) return
  if (editable(event.target) || editable(document.activeElement)) return
  const done = redoKey ? redo() : undo()
  if (done) event.preventDefault()
}

/** Tracks the pointer so a drag stays one step, and seals the step when it is released. */
export function historyPointer(event: PointerEvent) {
  pointer.down = event.type === "pointerdown"
  if (pointer.down) return
  const last = undoStack[undoStack.length - 1]
  if (last) last.sealed = true
}

// The toast names the value the step moved to: the old one after undo, the new one after redo.
function notify(verb: "Undid" | "Redid", entry: Entry) {
  const first = entry.changes[0]
  const value = entry.target.describe(first, verb === "Undid" ? first.before : first.after)
  const more = entry.changes.length > 1 ? ` (+${entry.changes.length - 1} more)` : ""
  const text = entry.label ?? `${first.label}${value ? ` → ${value}` : ""}${more}`
  setHistoryNotice({ text: `${verb}: ${text}`, id: performance.now() })
}

function mergeChanges(older: HistoryChange[], newer: HistoryChange[]) {
  const keys = [...new Set([...older, ...newer].map((change) => change.key))]
  return keys
    .map((key) => {
      const first = older.find((change) => change.key === key) ?? newer.find((change) => change.key === key)!
      const latest = newer.find((change) => change.key === key) ?? first
      return { ...first, after: latest.after }
    })
    .filter((change) => !same(change.before, change.after))
}

// A group can span stores, so each change's key is prefixed with its entry's index.
function groupTarget(entries: Entry[]): HistoryTarget {
  const split = (key: string) => {
    const at = key.indexOf(" ")
    return { index: Number(key.slice(0, at)), key: key.slice(at + 1) }
  }
  return {
    apply: (values) =>
      entries.forEach((entry, index) =>
        entry.target.apply(
          values.map((value) => ({ ...split(value.key), value: value.value })).filter((value) => value.index === index),
        ),
      ),
    describe: (change, value) => {
      const part = split(change.key)
      return entries[part.index].target.describe({ ...change, key: part.key }, value)
    },
  }
}

function editable(node: EventTarget | null) {
  if (!(node instanceof HTMLElement)) return false
  if (node.isContentEditable) return true
  if (node instanceof HTMLTextAreaElement) return true
  if (!(node instanceof HTMLInputElement)) return false
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(node.type)
}

function same(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
