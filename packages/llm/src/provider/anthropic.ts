import { ProviderRoute } from "../provider-route"

export const provider = ProviderRoute.fixed("anthropic", "anthropic-messages")

export * as Anthropic from "./anthropic"
