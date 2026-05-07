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
 *
 * `traits.capture` prevents key categories from propagating to session-level
 * global handlers while the textarea is focused. "navigate" must always be
 * captured in normal mode so that Home/End move the cursor instead of
 * triggering the session's messages_first/messages_last scroll handlers.
 * When autocomplete is visible, "escape" and "submit" are also captured so
 * Escape closes the dropdown and Enter selects a completion item rather than
 * bubbling up.
 */
export function computePromptTraits(input: PromptTraitsInput): EditorTraits {
  const capture =
    input.mode === "normal"
      ? input.autocompleteVisible
        ? (["escape", "navigate", "submit", "tab"] as const)
        : (["navigate", "tab"] as const)
      : undefined
  return {
    capture,
    suspend: input.disabled,
    status: input.mode === "shell" ? "SHELL" : undefined,
  }
}
