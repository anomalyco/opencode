import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("xai", "openai-responses", { auth: "key" })

export * as XAI from "./xai"
