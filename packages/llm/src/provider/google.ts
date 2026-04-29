import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("google", "gemini")

export * as Google from "./google"
