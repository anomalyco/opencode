import type { TextareaRenderable } from "@opentui/core"

// Deletes the document cells [start, end) and leaves the cursor at start.
export function deleteCells(input: TextareaRenderable, start: number, end: number) {
  const from = input.editBuffer.offsetToPosition(start)
  const to = input.editBuffer.offsetToPosition(end)
  if (from && to) input.deleteRange(from.row, from.col, to.row, to.col)
}

export function normalizePromptContent(content: string) {
  if (content.endsWith("\r\n")) {
    const body = content.slice(0, -2)
    return !body.includes("\n") && !body.includes("\r") ? body : content
  }

  if (content.endsWith("\n")) {
    const body = content.slice(0, -1)
    return !body.includes("\n") && !body.includes("\r") ? body : content
  }

  return content
}
