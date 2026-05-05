import * as AnthropicMessages from "../protocols/anthropic-messages"
import type { AnthropicMessagesModelInput } from "../protocols/anthropic-messages"

export const adapters = [AnthropicMessages.adapter]

export const model = (id: string, options: Omit<AnthropicMessagesModelInput, "id"> = {}) =>
  AnthropicMessages.model({ ...options, id })
