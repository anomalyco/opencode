import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2"

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

export function assistantContextTokens(message: AssistantMessage) {
  return (
    message.tokens.total ??
    message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write
  )
}

const withUsage = (message: Message): message is AssistantMessage =>
  message.role === "assistant" && assistantContextTokens(message) > 0

// Interrupted turns get locally estimated tokens (no provider-reported
// `total`); an estimate must never displace a provider-reported value.
const withEstimatedUsage = (message: AssistantMessage) =>
  message.tokens.total === undefined && message.error?.name === "MessageAbortedError"

/**
 * The message whose usage the context meter shows: the latest assistant
 * message with provider-reported usage, last write wins. Genuine reports move
 * the meter in both directions — context shrinks when the provider compacts
 * its own history, so picking a maximum would pin the meter at the
 * pre-compaction peak forever.
 */
export function latestAssistantContextMessage(messages: readonly Message[]) {
  return (
    messages.findLast((message): message is AssistantMessage => withUsage(message) && !withEstimatedUsage(message)) ??
    messages.findLast(withUsage)
  )
}
