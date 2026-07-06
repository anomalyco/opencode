import type { SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2"

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

export function lastAssistantWithUsage(messages: ReadonlyArray<SessionMessage>, boundary?: string) {
  return messages.findLast(
    (message): message is SessionMessageAssistant & { tokens: NonNullable<SessionMessageAssistant["tokens"]> } =>
      message.type === "assistant" && message.tokens !== undefined && (!boundary || message.id < boundary),
  )
}
