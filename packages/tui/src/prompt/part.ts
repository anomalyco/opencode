import type { TextareaRenderable } from "@opentui/core"
import { displaySlice } from "./display"

export function stripPromptPartIDs<Part extends { id: string; messageID: string; sessionID: string }>(part: Part) {
  const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = part
  return rest
}

export function expandPastedTextPlaceholders(text: string, parts: readonly unknown[]) {
  return parts.reduce<string>((result, part) => {
    if (!isPastedTextPart(part)) return result
    return result.replace(part.source.text.value, part.text)
  }, text)
}

function isPastedTextPart(part: unknown): part is { type: "text"; text: string; source: { text: { value: string } } } {
  if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text") return false
  if (!("text" in part) || typeof part.text !== "string" || !("source" in part)) return false
  const source = part.source
  if (!source || typeof source !== "object" || !("text" in source)) return false
  const text = source.text
  return Boolean(text && typeof text === "object" && "value" in text && typeof text.value === "string")
}

export function expandTrackedPastedText(text: string, ranges: { start: number; end: number; text: string }[]) {
  return ranges
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((result, part) => displaySlice(result, 0, part.start) + part.text + displaySlice(result, part.end), text)
}

// Cursor lands on a placeholder's [start, end] range or right after it
// (the trailing space pasteText inserts means end + 1 too)
export function pastedTextExtmarkAtOffset<T extends { start: number; end: number }>(offset: number, ranges: T[]) {
  return ranges.find((range) => offset >= range.start && offset <= range.end + 1)
}

// Expands a collapsed paste placeholder ([Pasted ~N lines]) at the cursor back
// into the original text, returning true when an expansion happened.
export function expandPastedTextPlaceholder(
  input: Pick<TextareaRenderable, "cursorOffset" | "editBuffer" | "extmarks" | "insertText">,
  typeId: number,
  pastedTextFor: (extmarkId: number) => string | undefined,
) {
  const extmark = pastedTextExtmarkAtOffset(
    input.cursorOffset,
    input.extmarks.getAllForTypeId(typeId).flatMap((candidate) => {
      const text = pastedTextFor(candidate.id)
      if (text === undefined) return []
      return [{ start: candidate.start, end: candidate.end, id: candidate.id, text }]
    }),
  )
  if (!extmark) return false
  const start = input.editBuffer.offsetToPosition(extmark.start)
  const end = input.editBuffer.offsetToPosition(extmark.end)
  if (!start || !end) return false
  input.extmarks.delete(extmark.id)
  input.editBuffer.deleteRange(start.row, start.col, end.row, end.col)
  input.editBuffer.setCursor(start.row, start.col)
  input.insertText(extmark.text)
  return true
}
