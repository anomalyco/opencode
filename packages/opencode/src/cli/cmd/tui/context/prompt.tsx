import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"
import type { StartupInputBuffer } from "../startup-input-buffer"

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: (props: { startupInputBuffer: StartupInputBuffer }) => {
    let current: PromptRef | undefined
    let startupDrained = false

    return {
      get current() {
        return current
      },
      set(ref: PromptRef | undefined) {
        current = ref
      },
      drainStartupInputBuffer(ref = current) {
        if (startupDrained || !ref) return false
        startupDrained = true
        const input = props.startupInputBuffer.drain()
        props.startupInputBuffer.dispose()
        if (!input || ref.current.input) return false
        ref.set({ input, parts: [] })
        return true
      },
    }
  },
})
