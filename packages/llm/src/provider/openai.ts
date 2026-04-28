import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("openai", "openai-responses", { auth: "bearer" })

export * as OpenAI from "./openai"
