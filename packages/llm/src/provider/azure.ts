import { ProviderResolver } from "../provider-resolver"
import { ProviderID } from "../schema"

export const id = ProviderID.make("azure")

export const resolver = ProviderResolver.define({
  id,
  resolve: (input) =>
    ProviderResolver.make(id, input.options.useCompletionUrls ? "openai-chat" : "openai-responses", { auth: "bearer" }),
})

export * as Azure from "./azure"
