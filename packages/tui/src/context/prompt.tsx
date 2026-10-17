import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    const [current, setCurrent] = createSignal<PromptRef>()

    return {
      get current() {
        return current()
      },
      bind(ref: PromptRef) {
        setCurrent(ref)
        return () => setCurrent((value) => (value === ref ? undefined : value))
      },
    }
  },
})
