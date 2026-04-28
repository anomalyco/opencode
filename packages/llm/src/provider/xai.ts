import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("xai", "openai-responses", { auth: "bearer" })

export * as XAI from "./xai"
