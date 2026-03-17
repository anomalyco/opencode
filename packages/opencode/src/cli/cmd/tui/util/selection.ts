import { Clipboard } from "./clipboard"

/**
 * Toast interface for displaying notifications.
 */
type Toast = {
  /** Shows a toast notification with the specified message and variant */
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  /** Displays an error toast from an unknown error value */
  error: (err: unknown) => void
}

/**
 * Renderer interface for text selection operations.
 */
type Renderer = {
  /** Gets the current text selection, or null if none */
  getSelection: () => { getSelectedText: () => string } | null
  /** Clears the current selection */
  clearSelection: () => void
}

/**
 * Selection namespace providing clipboard copy functionality for selected text.
 *
 * Integrates with the renderer's selection API to copy selected text to the
 * system clipboard and provide user feedback via toast notifications.
 *
 * @example
 * ```typescript
 * const copied = Selection.copy(renderer, toast)
 * if (copied) {
 *   console.log("Text copied to clipboard")
 * }
 * ```
 */
export namespace Selection {
  /**
   * Copies the currently selected text to the clipboard.
   *
   * Retrieves the selected text from the renderer, copies it to the system
   * clipboard, shows a confirmation toast, and clears the selection.
   *
   * @param renderer - The renderer instance providing selection functionality
   * @param toast - The toast interface for showing notifications
   * @returns True if text was copied, false if no text was selected
   */
  export function copy(renderer: Renderer, toast: Toast): boolean {
    const text = renderer.getSelection()?.getSelectedText()
    if (!text) return false

    Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
    return true
  }
}
