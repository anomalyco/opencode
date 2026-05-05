import { byProvider, profiles, resolve, resolver } from "./openai-compatible-profile"
import type { OpenAICompatibleProfile } from "./openai-compatible-profile"

export type ProviderFamily = OpenAICompatibleProfile
export const families = profiles
export { byProvider, resolve, resolver }

export * as OpenAICompatibleFamily from "./openai-compatible-family"
