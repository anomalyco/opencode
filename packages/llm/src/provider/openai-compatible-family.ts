import { families, familyByProvider, familyResolver, resolveFamily } from "./openai-compatible-profile"
import type { OpenAICompatibleProfile } from "./openai-compatible-profile"

export type ProviderFamily = OpenAICompatibleProfile
export const byProvider = familyByProvider
export const resolve = resolveFamily
export const resolver = familyResolver
export { families }

export * as OpenAICompatibleFamily from "./openai-compatible-family"
