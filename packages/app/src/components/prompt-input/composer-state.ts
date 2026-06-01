import type { Prompt } from "@/context/prompt"

export const NON_EMPTY_TEXT = /[^\s\u200B]/

type SessionStatus = { type: string }

type BusyMessage = {
  role: string
  time?: object
}

export function sessionBusy(status: SessionStatus, messages: readonly BusyMessage[] | undefined) {
  if (status.type !== "idle") return true
  return (messages ?? []).some((item) => {
    if (item.role !== "assistant") return false
    const completed = (item.time as { completed?: number } | undefined)?.completed
    return typeof completed !== "number"
  })
}

export type SubmitIntent = "send" | "stop" | "queue"

export function submitIntent(working: boolean, draft: boolean, queue: boolean): SubmitIntent {
  if (!working) return "send"
  if (!draft) return "stop"
  if (queue) return "queue"
  return "send"
}

export function followupQueueAllowed(sessionID: string | undefined, queueMode: boolean, busy: boolean) {
  if (!sessionID || !queueMode) return false
  return busy
}

export function promptHasDraft(parts: Prompt) {
  const text = parts.map((part) => ("content" in part ? part.content : "")).join("")
  return NON_EMPTY_TEXT.test(text) || parts.some((part) => part.type !== "text")
}
