import type { Prompt } from "@/context/prompt"

const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export const MAX_HISTORY = 100

export function canNavigateHistoryAtCursor(direction: "up" | "down", text: string, cursor: number) {
  if (!text.includes("\n")) return true
  const position = Math.max(0, Math.min(cursor, text.length))
  if (direction === "up") return !text.slice(0, position).includes("\n")
  return !text.slice(position).includes("\n")
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

export function promptLength(prompt: Prompt) {
  return prompt.reduce((len, part) => len + ("content" in part ? part.content.length : 0), 0)
}

export function prependHistoryEntry(entries: Prompt[], prompt: Prompt, max = MAX_HISTORY) {
  const text = prompt
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
    .trim()
  const hasImages = prompt.some((part) => part.type === "image")
  if (!text && !hasImages) return entries

  const entry = clonePromptParts(prompt)
  const last = entries[0]
  if (last && isPromptEqual(last, entry)) return entries
  return [entry, ...entries].slice(0, max)
}

function isPromptEqual(promptA: Prompt, promptB: Prompt) {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
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
  return true
}

type HistoryNavInput = {
  direction: "up" | "down"
  entries: Prompt[]
  historyIndex: number
  currentPrompt: Prompt
  savedPrompt: Prompt | null
}

type HistoryNavResult =
  | {
      handled: false
      historyIndex: number
      savedPrompt: Prompt | null
    }
  | {
      handled: true
      historyIndex: number
      savedPrompt: Prompt | null
      prompt: Prompt
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
      return {
        handled: true,
        historyIndex: 0,
        savedPrompt: clonePromptParts(input.currentPrompt),
        prompt: input.entries[0],
        cursor: "start",
      }
    }

    if (input.historyIndex < input.entries.length - 1) {
      const next = input.historyIndex + 1
      return {
        handled: true,
        historyIndex: next,
        savedPrompt: input.savedPrompt,
        prompt: input.entries[next],
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
    return {
      handled: true,
      historyIndex: next,
      savedPrompt: input.savedPrompt,
      prompt: input.entries[next],
      cursor: "end",
    }
  }

  if (input.historyIndex === 0) {
    if (input.savedPrompt) {
      return {
        handled: true,
        historyIndex: -1,
        savedPrompt: null,
        prompt: input.savedPrompt,
        cursor: "end",
      }
    }

    return {
      handled: true,
      historyIndex: -1,
      savedPrompt: null,
      prompt: DEFAULT_PROMPT,
      cursor: "end",
    }
  }

  return {
    handled: false,
    historyIndex: input.historyIndex,
    savedPrompt: input.savedPrompt,
  }
}
