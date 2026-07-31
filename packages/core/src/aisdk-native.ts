export * as AISDKNative from "./aisdk-native"

import { isRecord } from "@opencode-ai/ai/utils/record"

export interface Mapping {
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
}

export function map(packageName: string | undefined, settings: Readonly<Record<string, unknown>>): Mapping | undefined {
  const baseSettings = mapBaseSettings(settings)
  switch (packageName) {
    case "@ai-sdk/google":
      return {
        package: "@opencode-ai/ai/providers/google",
        settings: {
          ...baseSettings,
          ...mapAPIKey(settings),
          ...mapGoogleOptions(settings),
        },
      }
    case "@openrouter/ai-sdk-provider":
      return {
        package: "@opencode-ai/ai/providers/openrouter",
        settings: {
          ...baseSettings,
          ...mapAPIKey(settings),
          ...mapProviderOptions("openrouter", settings),
        },
      }
    case "@ai-sdk/xai":
      return {
        package: "@opencode-ai/ai/providers/xai",
        settings: {
          ...baseSettings,
          ...mapAPIKey(settings),
          ...mapXAIOptions(settings),
        },
      }
  }
}

function mapBaseSettings(settings: Readonly<Record<string, unknown>>) {
  return {
    ...(typeof settings.baseURL === "string" ? { baseURL: settings.baseURL } : {}),
  }
}

function mapAPIKey(settings: Readonly<Record<string, unknown>>) {
  return typeof settings.apiKey === "string" ? { apiKey: settings.apiKey } : {}
}

function mapGoogleOptions(settings: Readonly<Record<string, unknown>>) {
  const input = settings.thinkingConfig
  const thinkingConfig = {
    ...(isRecord(input) && typeof input.thinkingBudget === "number" ? { thinkingBudget: input.thinkingBudget } : {}),
    ...(isRecord(input) && typeof input.includeThoughts === "boolean"
      ? { includeThoughts: input.includeThoughts }
      : {}),
    ...(isRecord(input) && typeof input.thinkingLevel === "string" ? { thinkingLevel: input.thinkingLevel } : {}),
  }
  const options = {
    ...(typeof settings.cachedContent === "string" ? { cachedContent: settings.cachedContent } : {}),
    ...(Array.isArray(settings.safetySettings) ? { safetySettings: settings.safetySettings } : {}),
    ...(typeof settings.serviceTier === "string" ? { serviceTier: settings.serviceTier } : {}),
    ...(Object.keys(thinkingConfig).length > 0 ? { thinkingConfig } : {}),
  }
  if (Object.keys(options).length === 0) return {}
  return { providerOptions: { gemini: options } }
}

function mapXAIOptions(settings: Readonly<Record<string, unknown>>) {
  const options = {
    ...(typeof settings.reasoningEffort === "string" ? { reasoningEffort: settings.reasoningEffort } : {}),
    ...(typeof settings.store === "boolean" ? { store: settings.store } : {}),
    ...(typeof settings.promptCacheKey === "string" ? { promptCacheKey: settings.promptCacheKey } : {}),
  }
  if (Object.keys(options).length === 0) return {}
  return { providerOptions: { xai: options } }
}

function mapProviderOptions(namespace: string, settings: Readonly<Record<string, unknown>>) {
  const values = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !["apiKey", "authToken", "baseURL", "chunkTimeout", "fetch", "timeout"].includes(key),
    ),
  )
  if (Object.keys(values).length === 0) return {}
  return { providerOptions: { [namespace]: values } }
}
