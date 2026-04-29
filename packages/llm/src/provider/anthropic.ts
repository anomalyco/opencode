import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("anthropic", "anthropic-messages", { auth: "key" })

export * as Anthropic from "./anthropic"
