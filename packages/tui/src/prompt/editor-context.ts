import type { EditorSelection } from "../context/editor"

export function editorSelectionKey(selection: EditorSelection | undefined) {
  if (!selection) return ""
  return [
    selection.filePath,
    ...selection.ranges.flatMap((range) => [
      range.selection.start.line,
      range.selection.start.character,
      range.selection.end.line,
      range.selection.end.character,
      range.text,
    ]),
  ].join("\0")
}

/**
 * The one place that decides which editor selection is attached to the composer. The footer and
 * the sent context both read it, so they cannot drift apart.
 */
export function attachedEditorSelection(input: {
  selection: EditorSelection | undefined
  enabled: boolean
  dismissed: string | undefined
}): EditorSelection | undefined {
  if (!input.enabled || !input.selection) return
  if (editorSelectionKey(input.selection) === input.dismissed) return
  return input.selection
}

/** The attached selection that a request should carry: an already-sent one is not resent. */
export function pendingEditorSelection(input: {
  selection: EditorSelection | undefined
  enabled: boolean
  sent: boolean
  dismissed: string | undefined
}): EditorSelection | undefined {
  if (input.sent) return
  return attachedEditorSelection(input)
}

export function hasEditorRangeSelection(selection: EditorSelection["ranges"][number]) {
  return (
    selection.selection.start.line !== selection.selection.end.line ||
    selection.selection.start.character !== selection.selection.end.character
  )
}

export function getEditorRangeLabel(selection: EditorSelection["ranges"][number]) {
  if (!hasEditorRangeSelection(selection)) return
  if (selection.selection.start.line === selection.selection.end.line) return `#${selection.selection.start.line}`
  return `#${selection.selection.start.line}-${selection.selection.end.line}`
}

export function formatEditorContext(selection: EditorSelection) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  if (selected.length === 0)
    return `<system-reminder>Note: The user opened the file "${selection.filePath}". This may or may not be relevant to the current task.</system-reminder>\n`

  const ranges = selected.map((range, index) => {
    const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
    return `Note: The user selected ${prefix}${getEditorRangeLabel(range)} from "${selection.filePath}". \`\`\`${range.text}\`\`\`\n\n`
  })

  return `<system-reminder>${ranges.join("\n")} This may or may not be relevant to the current task.</system-reminder>\n`
}
