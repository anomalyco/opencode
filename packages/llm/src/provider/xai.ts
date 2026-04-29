import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("xai", "openai-responses")

export * as XAI from "./xai"
