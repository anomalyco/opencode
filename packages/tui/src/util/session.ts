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

export function latestAssistantContextMessage(messages: readonly Message[]) {
  return messages.findLast(
    (message): message is AssistantMessage => message.role === "assistant" && assistantContextTokens(message) > 0,
  )
}
