import type { AdapterModelInput } from "../adapter/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as AnthropicMessages from "../protocols/anthropic-messages"

export const id = ProviderID.make("anthropic")

export const adapters = [AnthropicMessages.adapter]

export const model = (id: string | ModelID, options: Omit<AdapterModelInput, "id"> = {}) =>
  AnthropicMessages.model({ ...options, id })

export const provider = Provider.make({
  id,
  model,
})
