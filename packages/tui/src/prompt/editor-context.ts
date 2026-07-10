import type { EditorSelection } from "../context/editor"

const metadataKey = "tui.editorContext"

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

export function withEditorContext(selection: EditorSelection, text: string) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  const context =
    selected.length === 0
      ? `<system-reminder>Note: The user opened the file "${selection.filePath}". This may or may not be relevant to the current task.</system-reminder>\n`
      : `<system-reminder>${selected
          .map((range, index) => {
            const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
            return `Note: The user selected ${prefix}${getEditorRangeLabel(range)} from "${selection.filePath}". \`\`\`${range.text}\`\`\`\n\n`
          })
          .join("\n")} This may or may not be relevant to the current task.</system-reminder>\n`

  return {
    text: [context, text].filter(Boolean).join("\n\n"),
    metadata: { [metadataKey]: { text } },
  }
}

export function userPromptText(message: { text: string; metadata?: Record<string, unknown> }) {
  const metadata = message.metadata?.[metadataKey]
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return message.text
  if (!("text" in metadata) || typeof metadata.text !== "string") return message.text
  return metadata.text
}
