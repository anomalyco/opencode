/**
 * vscode-editor-state.ts
 *
 * Production `EditorState` implementation that reads live state from VS Code's
 * `window.activeTextEditor`. This file is the only place in the MCP-server
 * subsystem that imports the `vscode` module, which keeps the rest of the
 * server code testable under Bun (where the `vscode` module is not available).
 */

import * as vscode from "vscode"
import type { EditorContext, EditorState } from "./mcp-server"

/**
 * Returns a snapshot of the current editor context by reading from
 * `vscode.window.activeTextEditor`. Passed to `createMcpServer` when
 * the extension activates.
 */
export const vscodeEditorState: EditorState = (): EditorContext => {
  const editor = vscode.window.activeTextEditor
  if (!editor) return {}

  const result: EditorContext = {
    uri: editor.document.uri.toString(),
  }

  const sel = editor.selection
  // isEmpty means start === end (no text highlighted). We omit the selection
  // entirely so callers don't have to special-case zero-length selections.
  if (!sel.isEmpty) {
    result.selection = {
      start: { line: sel.start.line, column: sel.start.character },
      end: { line: sel.end.line, column: sel.end.character },
      text: editor.document.getText(sel),
    }
  }

  return result
}
