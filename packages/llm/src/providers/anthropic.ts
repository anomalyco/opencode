import type { AdapterModelInput } from "../adapter/client"
import * as AnthropicMessages from "../protocols/anthropic-messages"

export const adapters = [AnthropicMessages.adapter]

export const model = (id: string, options: Omit<AdapterModelInput, "id"> = {}) =>
  AnthropicMessages.model({ ...options, id })
