import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal } from "solid-js"
import type { SelectedLineRange } from "@/context/file"

type Mode = "normal" | "shell" | "draw" | "doc"

export type LineReferenceInput = {
  path: string
  selection: SelectedLineRange
  label?: string
  comment?: string
  preview?: string
}

export const { use: usePromptDocBridge, provider: PromptDocBridgeProvider } = createSimpleContext({
  name: "PromptDocBridge",
  gate: false,
  init: () => {
    const [mode, setMode] = createSignal<Mode>("normal")
    let addFile: ((path: string) => boolean) | undefined
    let addLine: ((input: LineReferenceInput) => boolean) | undefined

    return {
      mode,
      setMode,
      setAddReference: (next: typeof addFile) => {
        addFile = next
      },
      addReference: (path: string) => addFile?.(path) ?? false,
      setAddLineReference: (next: typeof addLine) => {
        addLine = next
      },
      addLineReference: (input: LineReferenceInput) => addLine?.(input) ?? false,
    }
  },
})
