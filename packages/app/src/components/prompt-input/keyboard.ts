export type PromptEnterKeyAction = "newline" | "submit" | "none"

type PromptEnterKeyInput = {
  key: string
  shiftKey: boolean
  mobileWeb: boolean
}

export function promptEnterKeyAction(input: PromptEnterKeyInput): PromptEnterKeyAction {
  if (input.key !== "Enter") return "none"
  if (input.shiftKey || input.mobileWeb) return "newline"
  return "submit"
}
