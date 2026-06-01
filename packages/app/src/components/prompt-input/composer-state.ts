import type { Prompt } from "@/context/prompt"

export const NON_EMPTY_TEXT = /[^\s\u200B]/

export type FollowupMode = "queue" | "steer" | "none"

const followupModes = new Set<FollowupMode>(["queue", "steer", "none"])

export function parseFollowupMode(value: string | undefined): FollowupMode {
  if (value && followupModes.has(value as FollowupMode)) return value as FollowupMode
  return "none"
}

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

export function submitIntent(working: boolean, draft: boolean, mode: FollowupMode): SubmitIntent {
  if (!working) return "send"
  if (!draft) return "stop"
  if (mode === "queue") return "queue"
  if (mode === "none") return "stop"
  return "send"
}

export function followupShouldQueue(sessionID: string | undefined, mode: FollowupMode, busy: boolean) {
  if (mode !== "queue") return false
  if (!sessionID) return false
  return busy
}

export function promptHasDraft(parts: Prompt) {
  const text = parts.map((part) => ("content" in part ? part.content : "")).join("")
  return NON_EMPTY_TEXT.test(text) || parts.some((part) => part.type !== "text")
}
