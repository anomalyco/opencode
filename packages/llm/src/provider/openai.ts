import { ProviderRoute } from "../provider-route"

export const provider = ProviderRoute.fixed("openai", "openai-responses")

export * as OpenAI from "./openai"
