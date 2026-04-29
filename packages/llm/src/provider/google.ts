import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("google", "gemini", { auth: "key" })

export * as Google from "./google"
