import { byProvider, profiles, type OpenAICompatibleProfile } from "./openai-compatible-profile"

export type ProviderFamily = OpenAICompatibleProfile
export const families = profiles
export { byProvider }

export * as OpenAICompatibleFamily from "./openai-compatible-family"
