import { SessionMessage } from "@opencode-ai/core/session/message"
import { DateTime } from "effect"
import { Buffer } from "node:buffer"

export type Latest = {
  user?: SessionMessage.User
  assistant?: SessionMessage.Assistant
  finishedAssistant?: SessionMessage.Assistant
}

export function chronological(messages: readonly SessionMessage.Message[]) {
  return messages.slice().sort((left, right) => compareMessages(left, right))
}

export function filterCompacted(messages: readonly SessionMessage.Message[]) {
  const ordered = chronological(messages)
  const latestCompaction = ordered
    .filter((message): message is SessionMessage.Compaction => message.type === "compaction")
    .at(-1)
  if (!latestCompaction) return ordered

  const compactionIndex = ordered.findIndex((message) => message.id === latestCompaction.id)
  const afterCompaction = ordered.slice(compactionIndex + 1)
  if (!latestCompaction.include) return [latestCompaction, ...afterCompaction]

  const includeIndex = ordered.findIndex((message) => message.id === latestCompaction.include)
  if (includeIndex === -1 || includeIndex >= compactionIndex) return [latestCompaction, ...afterCompaction]

  return [latestCompaction, ...ordered.slice(includeIndex, compactionIndex), ...afterCompaction]
}

export function context(messages: readonly SessionMessage.Message[]) {
  return filterCompacted(messages)
}

export function latest(messages: readonly SessionMessage.Message[]): Latest {
  const ordered = chronological(messages)
  return {
    user: ordered.findLast((message): message is SessionMessage.User => message.type === "user"),
    assistant: ordered.findLast((message): message is SessionMessage.Assistant => message.type === "assistant"),
    finishedAssistant: ordered.findLast((message): message is SessionMessage.Assistant => {
      return message.type === "assistant" && isTerminalAssistant(message)
    }),
  }
}

function compareMessages(left: SessionMessage.Message, right: SessionMessage.Message) {
  const time = DateTime.toEpochMillis(left.time.created) - DateTime.toEpochMillis(right.time.created)
  if (time !== 0) return time
  return compareID(left.id, right.id)
}

function compareID(left: string, right: string) {
  // Compare by byte order intentionally; IDs are not locale-collated text.
  return Buffer.from(left).compare(Buffer.from(right))
}

function isTerminalAssistant(message: SessionMessage.Assistant) {
  // v2 assistant turns are terminal when the step has completed, emitted a
  // finish reason, or failed with an assistant error. Pending/running turns have
  // none of these signals and are intentionally excluded.
  return Boolean(message.time.completed || message.finish || message.error)
}

export * as MessageV2Context from "./message-v2-context"
