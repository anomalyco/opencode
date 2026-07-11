import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"
import { createSignal } from "solid-js"

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    let current: PromptRef | undefined
    let commandID = 0
    const [commands, setCommands] = createSignal<number[]>([])

    return {
      get current() {
        return current
      },
      set(ref: PromptRef | undefined) {
        current = ref
      },
      command: {
        get pending() {
          return commands().length > 0
        },
        async track<T>(request: () => Promise<T>) {
          const id = commandID++
          setCommands((commands) => [...commands, id])
          try {
            return await request()
          } finally {
            setCommands((commands) => commands.filter((command) => command !== id))
          }
        },
      },
    }
  },
})
