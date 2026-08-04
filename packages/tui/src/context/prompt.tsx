import { createSimpleContext } from "./helper"
import type { TuiPromptRef } from "@opencode-ai/plugin/tui"

export function canStashPromptForSessions(prompt: TuiPromptRef | undefined): prompt is TuiPromptRef & {
  cursorAtStart: true
  stashAndClear(): "armed" | "stashed"
} {
  return prompt?.cursorAtStart === true && typeof prompt.stashAndClear === "function"
}

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    let current: TuiPromptRef | undefined

    return {
      get current() {
        return current
      },
      set(ref: TuiPromptRef | undefined) {
        current = ref
      },
    }
  },
})
