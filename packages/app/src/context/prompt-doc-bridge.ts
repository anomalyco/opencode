import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal } from "solid-js"
import type { SelectedLineRange } from "@/context/file"
import type { FileNodeType } from "@/components/blocksuite/file-reference-block"
import type { LineRefInput } from "@/components/blocksuite/line-reference-url"

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
    let addFile: ((path: string, nodeType?: FileNodeType) => boolean) | undefined
    let addLine: ((input: LineReferenceInput) => boolean) | undefined
    let openLine: ((input: LineRefInput) => boolean) | undefined
    let openFile: ((path: string, nodeType?: FileNodeType) => boolean) | undefined

    return {
      mode,
      setMode,
      setAddReference: (next: typeof addFile) => {
        addFile = next
      },
      addReference: (path: string, nodeType?: FileNodeType) => addFile?.(path, nodeType) ?? false,
      setAddLineReference: (next: typeof addLine) => {
        addLine = next
      },
      addLineReference: (input: LineReferenceInput) => addLine?.(input) ?? false,
      setOpenLineReference: (next: typeof openLine) => {
        openLine = next
      },
      openLineReference: (input: LineRefInput) => openLine?.(input) ?? false,
      setOpenFileReference: (next: typeof openFile) => {
        openFile = next
      },
      openFileReference: (path: string, nodeType?: FileNodeType) => openFile?.(path, nodeType) ?? false,
    }
  },
})
