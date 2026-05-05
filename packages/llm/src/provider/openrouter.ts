import { OpenAICompatible, type ModelOptions as OpenAICompatibleModelOptions } from "./openai-compatible"
import { OpenAICompatibleProfiles } from "./openai-compatible-profile"

export const profile = OpenAICompatibleProfiles.profiles.openrouter

export type ModelOptions = Omit<OpenAICompatibleModelOptions, "provider" | "baseURL"> & {
  readonly baseURL?: string
}

export const resolver = OpenAICompatibleProfiles.resolverFor(profile)

export const adapters = OpenAICompatible.adapters

export const model = (id: string, options: ModelOptions = {}) => {
  const baseURL = options.baseURL ?? profile.baseURL
  if (!baseURL) throw new Error("OpenRouter requires a baseURL")
  return OpenAICompatible.model(id, {
    ...options,
    provider: profile.provider,
    baseURL,
  })
}

export const chat = model

export * as OpenRouter from "./openrouter"
