import type { PromptInfo } from "./history"
import type { PromptRef } from "."

export function createStartupPrompt(value: PromptInfo | undefined) {
  let ref: PromptRef | undefined
  let seeded = false
  let submitted = false

  return {
    bind(next: PromptRef | undefined) {
      ref = next
      if (!value || !next || seeded) return
      seeded = true
      next.set(value)
    },
    submitWhenReady(ready: boolean) {
      if (!value || !ref || !ready || submitted) return
      if (ref.current.input !== value.input) return
      submitted = true
      ref.submit()
    },
  }
}
