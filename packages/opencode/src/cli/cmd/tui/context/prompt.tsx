import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    // Backed by a signal so that createEffect() in app.tsx can track when the
    // prompt mounts. A plain `let` would not be observable by SolidJS, and the
    // effect that triggers InputBuffer.flush() would never re-run.
    const [current, setCurrent] = createSignal<PromptRef | undefined>()

    return {
      get current() {
        return current()
      },
      set(ref: PromptRef | undefined) {
        // Wrap in a thunk so SolidJS stores the object itself as the value
        // rather than calling it as a functional updater.
        setCurrent(() => ref)
      },
    }
  },
})
