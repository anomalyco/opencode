import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("anthropic", "anthropic-messages", { auth: "anthropic-api-key" })

export * as Anthropic from "./anthropic"
