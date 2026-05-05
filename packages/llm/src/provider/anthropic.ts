import { AnthropicMessages, type AnthropicMessagesModelInput } from "./anthropic-messages"

export const adapters = [AnthropicMessages.adapter]

export const model = (id: string, options: Omit<AnthropicMessagesModelInput, "id"> = {}) =>
  AnthropicMessages.model({ ...options, id })

export const messages = model

export * as Anthropic from "./anthropic"
