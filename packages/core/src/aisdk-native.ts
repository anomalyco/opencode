export * as AISDKNative from "./aisdk-native"

import { isRecord } from "@opencode-ai/ai/utils/record"
import { Provider } from "./provider"

export interface Mapping {
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
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
      return mapOpenRouter(settings, baseSettings)
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

function mapOpenRouter(
  settings: Readonly<Record<string, unknown>>,
  baseSettings: Readonly<Record<string, unknown>>,
): Mapping {
  const headers =
    Provider.mergeHeaders(
      {
        ...(typeof settings.appName === "string" ? { "X-OpenRouter-Title": settings.appName } : {}),
        ...(typeof settings.appUrl === "string" ? { "HTTP-Referer": settings.appUrl } : {}),
        ...(isStringRecord(settings.api_keys) && Object.keys(settings.api_keys).length > 0
          ? { "X-Provider-API-Keys": JSON.stringify(settings.api_keys) }
          : {}),
      },
      isStringRecord(settings.headers) ? settings.headers : undefined,
    ) ?? {}
  return {
    package: "@opencode-ai/ai/providers/openrouter",
    settings: {
      ...baseSettings,
      ...mapAPIKey(settings),
      ...mapOpenRouterOptions(settings),
    },
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(isRecord(settings.extraBody) ? { body: settings.extraBody } : {}),
  }
}

function mapOpenRouterOptions(settings: Readonly<Record<string, unknown>>) {
  const options = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) =>
        ![
          "apiKey",
          "api_keys",
          "appName",
          "appUrl",
          "authToken",
          "baseURL",
          "chunkTimeout",
          "compatibility",
          "extraBody",
          "fetch",
          "headers",
          "timeout",
        ].includes(key),
    ),
  )
  if (Object.keys(options).length === 0) return {}
  return { providerOptions: { openrouter: options } }
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string")
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
