import { ProviderResolver } from "../provider-resolver"
import { OpenAICompatible, type ModelOptions as OpenAICompatibleModelOptions } from "./openai-compatible"

const baseURL = "https://openrouter.ai/api/v1"

export type ModelOptions = Omit<OpenAICompatibleModelOptions, "provider" | "baseURL"> & {
  readonly baseURL?: string
}

export const resolver = ProviderResolver.fixed("openrouter", "openai-compatible-chat", {
  baseURL,
})

export const adapters = OpenAICompatible.adapters

export const model = (id: string, options: ModelOptions = {}) =>
  OpenAICompatible.model(id, {
    ...options,
    provider: "openrouter",
    baseURL: options.baseURL ?? baseURL,
  })

export const chat = model

export * as OpenRouter from "./openrouter"
