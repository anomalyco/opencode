import type { PromptInfo } from "./history"

export function createPastePlaceholder(text: string): string {
  const lineCount = (text.match(/\n/g)?.length ?? 0) + 1
  return `[Pasted ~${lineCount} lines]`
}

export function shiftRange(extmark: { start: number; end: number }, delta: number): { start: number; end: number } {
  return {
    start: extmark.start + delta,
    end: extmark.end + delta,
  }
}

export function rewriteRange(
  text: string,
  start: number,
  end: number,
  replacement: string,
): { nextText: string; diff: number } {
  const nextText = text.slice(0, start) + replacement + text.slice(end)
  const diff = replacement.length - (end - start)
  return { nextText, diff }
}

export function cursorAfterNonText(cursor: number, start: number, end: number): number {
  if (cursor <= start) return cursor
  if (cursor >= end) return cursor
  return start + 1
}

export function cursorAfterReplacement(
  cursor: number,
  start: number,
  end: number,
  diff: number,
  replacementLength: number,
): number {
  if (cursor <= start) return cursor
  if (cursor >= end) return cursor + diff
  return start + replacementLength
}

export function updateTextPart(
  part: PromptInfo["parts"][number],
  content: string,
  start: number,
  replacement: string,
): PromptInfo["parts"][number] {
  if (part.type !== "text" || !part.source?.text) return part
  return {
    ...part,
    text: content,
    source: {
      ...part.source,
      text: {
        ...part.source.text,
        start,
        end: start + replacement.length,
        value: replacement,
      },
    },
  }
}

export function shiftFilePart(
  part: PromptInfo["parts"][number],
  start: number,
  end: number,
): PromptInfo["parts"][number] {
  if (part.type !== "file" || !part.source?.text) return part
  return {
    ...part,
    source: {
      ...part.source,
      text: {
        ...part.source.text,
        start,
        end,
      },
    },
  }
}

export function shiftAgentPart(
  part: PromptInfo["parts"][number],
  start: number,
  end: number,
): PromptInfo["parts"][number] {
  if (part.type !== "agent" || !part.source) return part
  return {
    ...part,
    source: {
      ...part.source,
      start,
      end,
    },
  }
}

export function replacePart(
  parts: PromptInfo["parts"],
  index: number,
  nextPart: PromptInfo["parts"][number],
): PromptInfo["parts"] {
  if (parts[index] === nextPart) return parts
  const nextParts = parts.slice()
  nextParts[index] = nextPart
  return nextParts
}
