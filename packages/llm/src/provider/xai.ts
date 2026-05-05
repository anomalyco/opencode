import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("xai", "openai-responses", {
  baseURL: "https://api.x.ai/v1",
})

export * as XAI from "./xai"
