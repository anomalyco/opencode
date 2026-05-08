import { MessageV2 } from "./message-v2"

export const ResumeError = "Tool execution was interrupted by server restart"
export const ResumeAbortError = "Tool execution aborted"
export const ResumePrompt =
  "Your last response was interrupted by an OpenCode server restart. Continue from the latest context without repeating completed work."

export type ResumeMatch = {
  assistant: MessageV2.Assistant
  user: MessageV2.User
}

export type ResumeAction =
  | { type: "interrupted"; assistant: MessageV2.Assistant; user: MessageV2.User }
  | { type: "unanswered"; user: MessageV2.User }

function interrupted(item: MessageV2.WithParts) {
  if (item.info.role !== "assistant") return false
  if (MessageV2.AbortedError.isInstance(item.info.error)) return true
  return item.parts.some(
    (part) =>
      part.type === "tool" &&
      part.state.status === "error" &&
      (part.state.error === ResumeError || part.state.error === ResumeAbortError),
  )
}

/**
 * Unified picker: returns the single best recovery action for a session.
 *
 * Priority:
 *   1. **unanswered** – last message is a user message with no assistant reply
 *   2. **interrupted** – last assistant was interrupted with no subsequent user message
 */
export function pickAction(input: MessageV2.WithParts[]): ResumeAction | undefined {
  if (input.length === 0) return

  const last = input[input.length - 1]

  // Priority 1: trailing user message with no assistant reply
  if (last.info.role === "user") {
    return { type: "unanswered", user: last.info as MessageV2.User }
  }

  // Priority 2: interrupted assistant (existing pickResume logic)
  const match = pickResume(input)
  if (match) return { type: "interrupted", ...match }
}

export function pickResume(input: MessageV2.WithParts[]) {
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i]
    if (item.info.role !== "assistant") continue
    if (typeof item.info.time.completed !== "number") continue
    if (!interrupted(item)) continue
    if (input.slice(i + 1).some((next) => next.info.role === "user")) continue

    for (let j = i - 1; j >= 0; j--) {
      const prev = input[j]
      if (prev.info.role !== "user") continue
      return {
        assistant: item.info,
        user: prev.info,
      } satisfies ResumeMatch
    }
  }
}
