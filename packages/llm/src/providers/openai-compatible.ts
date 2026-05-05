import { ProviderID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import type { OpenAICompatibleChatModelInput } from "../protocols/openai-compatible-chat"
import { profiles, type OpenAICompatibleProfile } from "./openai-compatible-profile"

export type ModelOptions = Omit<OpenAICompatibleChatModelInput, "id" | "provider"> & {
  readonly provider: string
}

export type FamilyModelOptions = Omit<OpenAICompatibleChatModelInput, "id" | "provider" | "baseURL"> & {
  readonly baseURL?: string
}

export const adapters = [OpenAICompatibleChat.adapter]

export const model = (id: string, options: ModelOptions) => {
  return OpenAICompatibleChat.model({
    ...options,
    id,
    provider: ProviderID.make(options.provider),
  })
}

const profileBaseURL = (profile: OpenAICompatibleProfile, options: FamilyModelOptions) => {
  const baseURL = options.baseURL ?? profile.baseURL
  if (baseURL) return baseURL
  throw new Error(`OpenAI-compatible profile ${profile.provider} requires a baseURL`)
}

export const profileModel = (profile: OpenAICompatibleProfile, id: string, options: FamilyModelOptions = {}) =>
  OpenAICompatibleChat.model({
    ...options,
    id,
    provider: profile.provider,
    baseURL: profileBaseURL(profile, options),
    capabilities: options.capabilities ?? profile.capabilities,
  })

const define = (profile: OpenAICompatibleProfile) => ({
  id: profile.provider,
  adapters,
  model: (id: string, options: FamilyModelOptions = {}) => profileModel(profile, id, options),
})

export const baseten = define(profiles.baseten)
export const cerebras = define(profiles.cerebras)
export const deepinfra = define(profiles.deepinfra)
export const deepseek = define(profiles.deepseek)
export const fireworks = define(profiles.fireworks)
export const groq = define(profiles.groq)
export const togetherai = define(profiles.togetherai)
export const xai = define(profiles.xai)
