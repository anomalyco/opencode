import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("openai", "openai-responses")

export * as OpenAI from "./openai"
