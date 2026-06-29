export type PromptEscapeAction = "interrupt-submit" | "interrupt"

export function promptEscapeAction(input: {
  autocompleteVisible: boolean
  disabled: boolean
  focused: boolean
  mode: "normal" | "shell"
  promptInput: string
  sessionBusy: boolean
  workspaceCreating: boolean
}): PromptEscapeAction {
  if (!input.sessionBusy) return "interrupt"
  if (!input.focused) return "interrupt"
  if (input.disabled) return "interrupt"
  if (input.workspaceCreating) return "interrupt"
  if (input.autocompleteVisible) return "interrupt"
  if (input.mode !== "normal") return "interrupt"
  if (input.promptInput.trim().length > 0) return "interrupt-submit"
  return "interrupt"
}
