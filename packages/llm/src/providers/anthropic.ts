import type { RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as AnthropicMessages from "../protocols/anthropic-messages"

export const id = ProviderID.make("anthropic")

export const routes = [AnthropicMessages.route]

export const model = (
  id: string | ModelID,
  options: Omit<RouteModelInput, "id" | "baseURL"> & { readonly baseURL?: string } = {},
) => AnthropicMessages.model({ ...options, id })

export const provider = Provider.make({
  id,
  model,
})
