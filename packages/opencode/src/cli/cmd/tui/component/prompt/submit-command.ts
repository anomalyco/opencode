import type { CommandOption } from "../dialog-command"

export function createSubmitPromptCommand(options: {
  isInputFocused: () => boolean
  submit: () => void
}): CommandOption {
  return {
    title: "Submit prompt",
    value: "prompt.submit",
    category: "Prompt",
    hidden: true,
    onSelect: (dialog) => {
      if (!options.isInputFocused()) return
      options.submit()
      dialog.clear()
    },
  }
}
