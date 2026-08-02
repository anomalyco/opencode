export * as AISDKNative from "./aisdk-native"

import { isRecord } from "@opencode-ai/ai/utils/record"
import { Provider } from "./provider"

export interface Mapping {
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
}

export interface MapInput {
  readonly packageName: string | undefined
  readonly settings: Readonly<Record<string, unknown>>
  readonly modelID: string
  readonly hasCredential?: boolean
}

export function map(input: MapInput): Mapping | undefined {
  const baseSettings = mapBaseSettings(input.settings)
  switch (input.packageName) {
    case "@ai-sdk/amazon-bedrock/mantle":
      return mapBedrockMantle(input, baseSettings)
    case "@ai-sdk/google":
      return {
        package: "@opencode-ai/ai/providers/google",
        settings: {
          ...baseSettings,
          ...mapAPIKey(input.settings),
          ...mapGoogleOptions(input.settings),
        },
      }
    case "@openrouter/ai-sdk-provider":
      return mapOpenRouter(input.settings, baseSettings)
    case "@ai-sdk/xai":
      return {
        package: "@opencode-ai/ai/providers/xai",
        settings: {
          ...baseSettings,
          ...mapAPIKey(input.settings),
          ...mapXAIOptions(input.settings),
        },
      }
  }
}

function mapBedrockMantle(input: MapInput, baseSettings: Readonly<Record<string, unknown>>): Mapping | undefined {
  const settings = input.settings
  const apiKey =
    typeof settings.apiKey === "string"
      ? settings.apiKey
      : typeof settings.bearerToken === "string"
        ? settings.bearerToken
        : undefined
  const credentials = mapBedrockCredentials(settings)
  if (!input.hasCredential && apiKey === undefined && credentials === undefined) return undefined
  const chat = input.modelID === "openai.gpt-oss-safeguard-20b" || input.modelID === "openai.gpt-oss-safeguard-120b"
  return {
    package: `@opencode-ai/ai/providers/amazon-bedrock/mantle/${chat ? "chat" : "responses"}`,
    settings: {
      ...baseSettings,
      ...(typeof settings.baseURL !== "string" && typeof settings.endpoint === "string"
        ? { baseURL: settings.endpoint }
        : {}),
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(credentials === undefined ? {} : { credentials }),
      ...(typeof settings.region === "string" ? { region: settings.region } : {}),
      ...mapOpenAIOptions(settings),
    },
  }
}

function mapBedrockCredentials(settings: Readonly<Record<string, unknown>>) {
  const credentials = isRecord(settings.credentials) ? settings.credentials : settings
  const region =
    typeof settings.region === "string"
      ? settings.region
      : typeof credentials.region === "string"
        ? credentials.region
        : undefined
  if (
    region === undefined ||
    typeof credentials.accessKeyId !== "string" ||
    typeof credentials.secretAccessKey !== "string"
  )
    return undefined
  return {
    region,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(typeof credentials.sessionToken === "string" ? { sessionToken: credentials.sessionToken } : {}),
  }
}

function mapOpenAIOptions(settings: Readonly<Record<string, unknown>>) {
  const options = {
    ...(typeof settings.reasoningEffort === "string" ? { reasoningEffort: settings.reasoningEffort } : {}),
    ...(typeof settings.reasoningSummary === "string" ? { reasoningSummary: settings.reasoningSummary } : {}),
    ...(Array.isArray(settings.include) ? { include: settings.include } : {}),
    ...(typeof settings.store === "boolean" ? { store: settings.store } : {}),
    ...(typeof settings.promptCacheKey === "string" ? { promptCacheKey: settings.promptCacheKey } : {}),
    ...(typeof settings.textVerbosity === "string" ? { textVerbosity: settings.textVerbosity } : {}),
    ...(typeof settings.serviceTier === "string" ? { serviceTier: settings.serviceTier } : {}),
  }
  if (Object.keys(options).length === 0) return {}
  return { providerOptions: { openai: options } }
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
