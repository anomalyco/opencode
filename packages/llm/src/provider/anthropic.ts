import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("anthropic", "anthropic-messages")

export * as Anthropic from "./anthropic"
