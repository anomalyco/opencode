import type { ComposerHistoryItem, ComposerPart } from "./types"

export type HistoryEntry = {
  text: string
  parts: ComposerPart[]
}

export type HistoryStored = string | ComposerHistoryItem

export type NavInput = {
  direction: "up" | "down"
  entries: HistoryStored[]
  historyIndex: number
  current: HistoryEntry
  saved: HistoryEntry | null
}

export type NavResult =
  | {
      handled: false
      historyIndex: number
      saved: HistoryEntry | null
    }
  | {
      handled: true
      historyIndex: number
      saved: HistoryEntry | null
      entry: HistoryEntry
      cursor: "start" | "end"
    }

export const MAX_HISTORY = 50

export const EMPTY_ENTRY: HistoryEntry = {
  text: "",
  parts: [{ type: "text", content: "" }],
}

const clonePart = (part: ComposerPart): ComposerPart => {
  if (part.type === "text") return { ...part }
  if (part.type === "file") return { ...part }
  return { ...part }
}

export const cloneParts = (parts: ComposerPart[]) => parts.map(clonePart)

const cloneEntry = (entry: HistoryEntry): HistoryEntry => ({
  text: entry.text,
  parts: cloneParts(entry.parts),
})

export const partText = (parts: ComposerPart[]) => parts.map((part) => part.content).join("")

export const normalizeEntry = (item: HistoryStored): HistoryEntry => {
  if (typeof item === "string") {
    return {
      text: item,
      parts: [{ type: "text", content: item }],
    }
  }

  if (!item.parts || item.parts.length === 0) {
    return {
      text: item.text,
      parts: [{ type: "text", content: item.text }],
    }
  }

  const parts = cloneParts(item.parts)
  return {
    text: partText(parts),
    parts,
  }
}

const samePart = (a: ComposerPart, b: ComposerPart) => {
  if (a.type !== b.type) return false
  if (a.type === "text" && b.type === "text") return a.content === b.content
  if (a.type === "file" && b.type === "file") return a.path === b.path && a.content === b.content
  if (a.type === "agent" && b.type === "agent") return a.name === b.name && a.content === b.content
  return false
}

export const sameEntry = (a: HistoryEntry | undefined, b: HistoryEntry) => {
  if (!a) return false
  if (a.text !== b.text) return false
  if (a.parts.length !== b.parts.length) return false

  for (let i = 0; i < a.parts.length; i++) {
    const x = a.parts[i]
    const y = b.parts[i]
    if (!x || !y || !samePart(x, y)) return false
  }

  return true
}

export const prependEntry = (entries: HistoryEntry[], item: HistoryEntry, max = MAX_HISTORY) => {
  if (!item.text.trim()) return entries

  const next = normalizeEntry(item)
  if (sameEntry(entries[0], next)) return entries
  return [next, ...entries].slice(0, max)
}

export const canNavigateAtCursor = (direction: "up" | "down", text: string, cursor: number, inHistory = false) => {
  const pos = Math.max(0, Math.min(cursor, text.length))
  const start = pos === 0
  const end = pos === text.length
  if (inHistory) return start || end
  if (direction === "up") return start
  return end
}

export const navigateEntry = (input: NavInput): NavResult => {
  if (input.direction === "up") {
    if (input.entries.length === 0) {
      return {
        handled: false,
        historyIndex: input.historyIndex,
        saved: input.saved,
      }
    }

    if (input.historyIndex === -1) {
      return {
        handled: true,
        historyIndex: 0,
        saved: cloneEntry(input.current),
        entry: normalizeEntry(input.entries[0] ?? EMPTY_ENTRY),
        cursor: "start",
      }
    }

    if (input.historyIndex < input.entries.length - 1) {
      const next = input.historyIndex + 1
      return {
        handled: true,
        historyIndex: next,
        saved: input.saved,
        entry: normalizeEntry(input.entries[next] ?? EMPTY_ENTRY),
        cursor: "start",
      }
    }

    return {
      handled: false,
      historyIndex: input.historyIndex,
      saved: input.saved,
    }
  }

  if (input.historyIndex > 0) {
    const next = input.historyIndex - 1
    return {
      handled: true,
      historyIndex: next,
      saved: input.saved,
      entry: normalizeEntry(input.entries[next] ?? EMPTY_ENTRY),
      cursor: "end",
    }
  }

  if (input.historyIndex === 0) {
    if (input.saved) {
      return {
        handled: true,
        historyIndex: -1,
        saved: null,
        entry: cloneEntry(input.saved),
        cursor: "end",
      }
    }

    return {
      handled: true,
      historyIndex: -1,
      saved: null,
      entry: normalizeEntry(EMPTY_ENTRY),
      cursor: "end",
    }
  }

  return {
    handled: false,
    historyIndex: input.historyIndex,
    saved: input.saved,
  }
}
