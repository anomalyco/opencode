import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

export function moveHistory(
  history: PromptInfo[],
  currentIndex: number,
  direction: 1 | -1,
  input: string,
): { nextIndex: number; result: PromptInfo | undefined } {
  if (!history.length) return { nextIndex: currentIndex, result: undefined }
  const current = history.at(currentIndex)
  if (!current) return { nextIndex: currentIndex, result: undefined }
  if (current.input !== input && input.length) return { nextIndex: currentIndex, result: undefined }

  const next = currentIndex + direction
  if (Math.abs(next) > history.length) {
    if (currentIndex === 0) {
      return { nextIndex: currentIndex, result: { input: "", parts: [] } }
    }
    return { nextIndex: currentIndex, result: history.at(currentIndex) }
  }
  if (next > 0) {
    if (currentIndex === 0) {
      return { nextIndex: currentIndex, result: { input: "", parts: [] } }
    }
    return { nextIndex: currentIndex, result: history.at(currentIndex) }
  }

  if (next === 0) {
    return { nextIndex: 0, result: { input: "", parts: [] } }
  }

  return { nextIndex: next, result: history.at(next) }
}
