/** A comment split into plain text and the `@path` mentions that travel with the prompt as attached files. */
export function commentSegments(text: string) {
  return text
    .split(/(@\S+)/)
    .map((part, index) => ({ text: part, mention: index % 2 === 1 }))
    .filter((part) => part.text !== "")
}

/** `:118-124` for a line range, `:42` for one line, nothing for a whole file. */
export function selectionLabel(selection: { startLine: number; endLine: number } | undefined) {
  if (!selection) return ""

  if (selection.startLine === selection.endLine) return `:${selection.startLine}`

  return `:${selection.startLine}-${selection.endLine}`
}
