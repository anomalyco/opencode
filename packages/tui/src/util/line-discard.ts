import type { EditBufferRenderable } from "@opentui/core"

export type LineDiscard = "bash" | "zsh"

// input_delete_to_line_start (ctrl+u) in every text field. 'bash' deletes from
// the caret back to the start of its logical line, as readline's
// unix-line-discard does; 'zsh' deletes that whole line wherever the caret is,
// as zsh's kill-whole-line does. Either way the line itself stays: a press at
// the start of a line ('bash'), or on an empty one ('zsh'), joins it to the
// previous line, as opentui's deleteToLineStart does. The deletion goes
// through the edit buffer, so input_undo restores it.
export function discardLine(editor: EditBufferRenderable, mode: LineDiscard | undefined) {
  if (mode === "zsh") editor.setCursor(editor.logicalCursor.row, editor.editBuffer.getEOL().col)
  return editor.deleteToLineStart()
}
