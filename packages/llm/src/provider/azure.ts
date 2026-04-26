import { ProviderRoute } from "../provider-route"
import { ProviderID } from "../schema"

export const id = ProviderID.make("azure")

export const provider = ProviderRoute.define({
  id,
  route: (input) => ProviderRoute.make(id, input.options.useCompletionUrls ? "openai-chat" : "openai-responses"),
})

export const route = provider.route

export * as Azure from "./azure"
