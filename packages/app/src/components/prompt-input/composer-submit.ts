import type { SubmitIntent } from "./composer-state"

export type PromptMode = "normal" | "shell" | "draw" | "doc"

export type QueuedClearInput = {
  mode: PromptMode
  sessionID: string
  advanceDoc?: (sessionID: string) => Promise<unknown>
}

export async function clearAfterQueue(input: QueuedClearInput) {
  if (input.mode !== "doc") return
  await input.advanceDoc?.(input.sessionID)
}

export function shouldAbortEmpty(intent: SubmitIntent) {
  return intent === "stop"
}
