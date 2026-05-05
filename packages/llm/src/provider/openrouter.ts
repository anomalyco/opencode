import { OpenAICompatibleChat, type ProviderFamilyModelInput } from "./openai-compatible-chat"
import { OpenAICompatibleProfiles } from "./openai-compatible-profile"

export const profile = OpenAICompatibleProfiles.profiles.openrouter

export type ModelOptions = Omit<ProviderFamilyModelInput, "id">

export const adapters = [OpenAICompatibleChat.adapter]

export const model = (id: string, options: ModelOptions = {}) =>
  OpenAICompatibleChat.profileModel(profile, { ...options, id })

export const chat = model

export * as OpenRouter from "./openrouter"
