import type { LanguageModelV2 } from "@ai-sdk/provider"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { KiroLanguageModel } from "./kiro-language-model"

export interface KiroProviderSettings {
  apiKey?: string
  baseURL?: string
  region?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface KiroProvider {
  (modelId: string): LanguageModelV2
  languageModel(modelId: string): LanguageModelV2
}

export function createKiro(options: KiroProviderSettings = {}): KiroProvider {
  const region = options.region ?? "us-east-1"
  const baseURL = options.baseURL ?? `https://codewhisperer.${region}.amazonaws.com`

  const createLanguageModel = (modelId: string): LanguageModelV2 => {
    return new KiroLanguageModel(modelId, {
      provider: "kiro",
      apiKey: options.apiKey,
      baseURL,
      headers: options.headers,
      fetch: options.fetch,
    })
  }

  const provider = (modelId: string): LanguageModelV2 => createLanguageModel(modelId)
  provider.languageModel = createLanguageModel

  return provider as KiroProvider
}
