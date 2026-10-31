import type { EditorSelection } from "../context/editor"

export function hasEditorRangeSelection(selection: EditorSelection["ranges"][number]) {
  return (
    selection.selection.start.line !== selection.selection.end.line ||
    selection.selection.start.character !== selection.selection.end.character
  )
}

// Claude-Code-protocol WebSocket selections carry 0-based editor positions
// while the Zed integration produces 1-based lines. Line labels feed the
// status-bar label, the synthetic editor-context reminder, and file
// attachment ranges — all 1-based — so convert at this boundary.
export function editorLineOffset(source: EditorSelection["source"]) {
  return source === "websocket" ? 1 : 0
}

export function getEditorRangeLabel(selection: EditorSelection["ranges"][number], offset = 0) {
  if (!hasEditorRangeSelection(selection)) return
  const start = selection.selection.start.line + offset
  const end = selection.selection.end.line + offset
  if (start === end) return `#${start}`
  return `#${start}-${end}`
}

export function formatEditorContext(selection: EditorSelection) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  if (selected.length === 0)
    return `<system-reminder>Note: The user opened the file "${selection.filePath}". This may or may not be relevant to the current task.</system-reminder>\n`

  const ranges = selected.map((range, index) => {
    const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
    return `Note: The user selected ${prefix}${getEditorRangeLabel(range, editorLineOffset(selection.source))} from "${selection.filePath}". \`\`\`${range.text}\`\`\`\n\n`
  })

  return `<system-reminder>${ranges.join("\n")} This may or may not be relevant to the current task.</system-reminder>\n`
}
