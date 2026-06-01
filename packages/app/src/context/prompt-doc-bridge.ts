import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal } from "solid-js"

type Mode = "normal" | "shell" | "draw" | "doc"

export const { use: usePromptDocBridge, provider: PromptDocBridgeProvider } = createSimpleContext({
  name: "PromptDocBridge",
  gate: false,
  init: () => {
    const [mode, setMode] = createSignal<Mode>("normal")
    let add: ((path: string) => boolean) | undefined

    return {
      mode,
      setMode,
      setAddReference: (next: typeof add) => {
        add = next
      },
      addReference: (path: string) => add?.(path) ?? false,
    }
  },
})
