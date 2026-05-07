import type { EditorTraits } from "@opentui/core"

export type PromptMode = "normal" | "shell"

export interface PromptTraitsInput {
  mode: PromptMode
  disabled: boolean
  autocompleteVisible: boolean
}

/**
 * Compute the textarea editor traits for the prompt.
 *
 * `traits.suspend` gates the textarea's keybinding actions (backspace,
 * delete-word, arrow movement, undo/redo, etc.). Shell mode is an active
 * editing mode — only `disabled` should suspend the textarea, otherwise
 * users can type in shell mode but cannot delete or move the cursor.
 */
export function computePromptTraits(input: PromptTraitsInput): EditorTraits {
  const capture =
    input.mode === "normal"
      ? input.autocompleteVisible
        ? (["escape", "navigate", "submit", "tab"] as const)
        : (["tab"] as const)
      : undefined
  return {
    capture,
    suspend: input.disabled,
    status: input.mode === "shell" ? "SHELL" : undefined,
  }
}
