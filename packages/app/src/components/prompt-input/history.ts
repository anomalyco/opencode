import type { Prompt } from "@/context/prompt"
import type { SelectedLineRange } from "@/context/file"

const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export const MAX_HISTORY = 100

export type PromptHistoryComment = {
  id: string
  path: string
  selection: SelectedLineRange
  comment: string
  time: number
  origin?: "review" | "file"
  preview?: string
}

export type PromptHistoryEntry = {
  prompt: Prompt
  comments: PromptHistoryComment[]
}

export type PromptHistoryStoredEntry = Prompt | PromptHistoryEntry

export function canNavigateHistoryAtCursor(direction: "up" | "down", text: string, cursor: number, inHistory = false) {
  const position = Math.max(0, Math.min(cursor, text.length))
  const atStart = position === 0
  const atEnd = position === text.length
  if (inHistory) return atStart || atEnd
  if (direction === "up") return position === 0
  return position === text.length
}

export function clonePromptParts(prompt: Prompt): Prompt {
  return prompt.map((part) => {
    if (part.type === "text") return { ...part }
    if (part.type === "image") return { ...part }
    if (part.type === "agent") return { ...part }
    return {
      ...part,
      selection: part.selection ? { ...part.selection } : undefined,
    }
  })
}

function cloneSelection(selection: SelectedLineRange): SelectedLineRange {
  return {
    start: selection.start,
    end: selection.end,
    ...(selection.side ? { side: selection.side } : {}),
    ...(selection.endSide ? { endSide: selection.endSide } : {}),
  }
}

export function clonePromptHistoryComments(comments: PromptHistoryComment[]) {
  return comments.map((comment) => ({
    ...comment,
    selection: cloneSelection(comment.selection),
  }))
}

export function normalizePromptHistoryEntry(entry: PromptHistoryStoredEntry): PromptHistoryEntry {
  if (Array.isArray(entry)) {
    return {
      prompt: clonePromptParts(entry),
      comments: [],
    }
  }
  return {
    prompt: clonePromptParts(entry.prompt),
    comments: clonePromptHistoryComments(entry.comments),
  }
}

export function promptLength(prompt: Prompt) {
  return prompt.reduce((len, part) => len + ("content" in part ? part.content.length : 0), 0)
}

export function prependHistoryEntry(
  entries: PromptHistoryStoredEntry[],
  prompt: Prompt,
  comments: PromptHistoryComment[] = [],
  max = MAX_HISTORY,
) {
  const text = prompt
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
    .trim()
  const hasImages = prompt.some((part) => part.type === "image")
  const hasComments = comments.some((comment) => !!comment.comment.trim())
  if (!text && !hasImages && !hasComments) return entries

  const entry = {
    prompt: clonePromptParts(prompt),
    comments: clonePromptHistoryComments(comments),
  } satisfies PromptHistoryEntry
  const last = entries[0]
  if (last && isPromptEqual(last, entry)) return entries
  return [entry, ...entries].slice(0, max)
}

function isCommentEqual(commentA: PromptHistoryComment, commentB: PromptHistoryComment) {
  return (
    commentA.path === commentB.path &&
    commentA.comment === commentB.comment &&
    commentA.origin === commentB.origin &&
    commentA.preview === commentB.preview &&
    commentA.selection.start === commentB.selection.start &&
    commentA.selection.end === commentB.selection.end &&
    commentA.selection.side === commentB.selection.side &&
    commentA.selection.endSide === commentB.selection.endSide
  )
}

function isPromptEqual(promptA: PromptHistoryStoredEntry, promptB: PromptHistoryStoredEntry) {
  const entryA = normalizePromptHistoryEntry(promptA)
  const entryB = normalizePromptHistoryEntry(promptB)
  if (entryA.prompt.length !== entryB.prompt.length) return false
  for (let i = 0; i < entryA.prompt.length; i++) {
    const partA = entryA.prompt[i]
    const partB = entryB.prompt[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB.type === "text" ? partB.content : "")) return false
    if (partA.type === "file") {
      if (partA.path !== (partB.type === "file" ? partB.path : "")) return false
      const a = partA.selection
      const b = partB.type === "file" ? partB.selection : undefined
      const sameSelection =
        (!a && !b) ||
        (!!a &&
          !!b &&
          a.startLine === b.startLine &&
          a.startChar === b.startChar &&
          a.endLine === b.endLine &&
          a.endChar === b.endChar)
      if (!sameSelection) return false
    }
    if (partA.type === "agent" && partA.name !== (partB.type === "agent" ? partB.name : "")) return false
    if (partA.type === "image" && partA.id !== (partB.type === "image" ? partB.id : "")) return false
  }
  if (entryA.comments.length !== entryB.comments.length) return false
  for (let i = 0; i < entryA.comments.length; i++) {
    const commentA = entryA.comments[i]
    const commentB = entryB.comments[i]
    if (!commentA || !commentB || !isCommentEqual(commentA, commentB)) return false
  }
  return true
}

type HistoryNavInput = {
  direction: "up" | "down"
  entries: PromptHistoryStoredEntry[]
  historyIndex: number
  currentPrompt: Prompt
  currentComments: PromptHistoryComment[]
  savedPrompt: PromptHistoryEntry | null
}

type HistoryNavResult =
  | {
      handled: false
      historyIndex: number
      savedPrompt: PromptHistoryEntry | null
    }
  | {
      handled: true
      historyIndex: number
      savedPrompt: PromptHistoryEntry | null
      entry: PromptHistoryEntry
      cursor: "start" | "end"
    }

export function navigatePromptHistory(input: HistoryNavInput): HistoryNavResult {
  if (input.direction === "up") {
    if (input.entries.length === 0) {
      return {
        handled: false,
        historyIndex: input.historyIndex,
        savedPrompt: input.savedPrompt,
      }
    }

    if (input.historyIndex === -1) {
      const entry = normalizePromptHistoryEntry(input.entries[0])
      return {
        handled: true,
        historyIndex: 0,
        savedPrompt: {
          prompt: clonePromptParts(input.currentPrompt),
          comments: clonePromptHistoryComments(input.currentComments),
        },
        entry,
        cursor: "start",
      }
    }

    if (input.historyIndex < input.entries.length - 1) {
      const next = input.historyIndex + 1
      const entry = normalizePromptHistoryEntry(input.entries[next])
      return {
        handled: true,
        historyIndex: next,
        savedPrompt: input.savedPrompt,
        entry,
        cursor: "start",
      }
    }

    return {
      handled: false,
      historyIndex: input.historyIndex,
      savedPrompt: input.savedPrompt,
    }
  }

  if (input.historyIndex > 0) {
    const next = input.historyIndex - 1
    const entry = normalizePromptHistoryEntry(input.entries[next])
    return {
      handled: true,
      historyIndex: next,
      savedPrompt: input.savedPrompt,
      entry,
      cursor: "end",
    }
  }

  if (input.historyIndex === 0) {
    if (input.savedPrompt) {
      return {
        handled: true,
        historyIndex: -1,
        savedPrompt: null,
        entry: input.savedPrompt,
        cursor: "end",
      }
    }

    return {
      handled: true,
      historyIndex: -1,
      savedPrompt: null,
      entry: {
        prompt: DEFAULT_PROMPT,
        comments: [],
      },
      cursor: "end",
    }
  }

  return {
    handled: false,
    historyIndex: input.historyIndex,
    savedPrompt: input.savedPrompt,
  }
}
