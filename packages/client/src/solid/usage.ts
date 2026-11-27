import type { SessionMessageAssistant, SessionMessageInfo } from "../promise"
import { messagesBeforeRevert, type RevertBoundary } from "./revert"

/**
 * The assistant step whose tokens fill the context window now: the latest one after the last completed
 * compaction and before the revert boundary. Every client shows context usage from this step, so the TUI
 * and the desktop app agree on it. Pass the session's `revert`; a bare message ID can't be placed by `seq`.
 */
export function lastAssistantWithUsage(messages: ReadonlyArray<SessionMessageInfo>, revert?: RevertBoundary | string) {
  const kept = revert
    ? messagesBeforeRevert(messages, typeof revert === "string" ? { messageID: revert } : revert)
    : messages
  const compactionIndex = kept.findLastIndex(
    (message) => message.type === "compaction" && message.status === "completed",
  )

  return kept.findLast(
    (message, index): message is SessionMessageAssistant & { tokens: NonNullable<SessionMessageAssistant["tokens"]> } =>
      message.type === "assistant" && message.tokens !== undefined && index > compactionIndex,
  )
}
