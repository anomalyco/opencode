import { cloneSelectedLineRange } from "@opencode-ai/ui/pierre/selection-bridge"
import type { SelectedLineRange } from "@/context/file"
import type { LineReferenceInput } from "@/context/prompt-doc-bridge"

type Bridge = {
  mode: () => "normal" | "shell" | "draw" | "doc"
  addLineReference: (input: LineReferenceInput) => boolean
}

export type LineContextInput = {
  file: string
  selection: SelectedLineRange
  comment?: string
  preview?: string
}

export function addLineContext(
  bridge: Bridge,
  input: LineContextInput,
  fallback: () => void,
) {
  if (bridge.mode() !== "doc") {
    fallback()
    return true
  }
  return bridge.addLineReference({
    path: input.file,
    selection: cloneSelectedLineRange(input.selection),
    comment: input.comment,
    preview: input.preview,
  })
}
