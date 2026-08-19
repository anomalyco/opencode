export * as AISDKNative from "./aisdk-native.js"

import { isRecord } from "@opencode-ai/ai/utils/record"
import { Provider } from "./provider.js"

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
}

export function map(input: MapInput): Mapping | undefined {
  const baseSettings = mapBaseSettings(input.settings)
  switch (input.packageName) {
    case "@ai-sdk/amazon-bedrock":
      return {
        package: "@opencode-ai/ai/providers/amazon-bedrock",
        settings: mapBedrockSettings(input.settings, baseSettings),
        ...mapBedrockRequest(input),
      }
    case "@ai-sdk/amazon-bedrock/mantle":
      return mapBedrockMantle(input, baseSettings)
    case "@ai-sdk/azure":
      return {
        package: `@opencode-ai/ai/providers/azure/${input.settings.useCompletionUrls === true ? "chat" : "responses"}`,
        settings: {
          ...baseSettings,
          ...mapAPIKey(input.settings),
          ...(typeof input.settings.resourceName === "string" ? { resourceName: input.settings.resourceName } : {}),
          ...(typeof input.settings.apiVersion === "string" ? { apiVersion: input.settings.apiVersion } : {}),
          ...(isStringRecord(input.settings.queryParams) ? { queryParams: input.settings.queryParams } : {}),
          ...(typeof input.settings.useDeploymentBasedUrls === "boolean"
            ? { useDeploymentBasedUrls: input.settings.useDeploymentBasedUrls }
            : {}),
          ...mapOpenAIOptions(input.settings),
        },
      }
    case "@ai-sdk/google":
      return {
        package: "@opencode-ai/ai/providers/google",
        settings: {
          ...baseSettings,
          ...mapAPIKey(input.settings),
          ...mapGoogleOptions(input.settings),
        },
      }
    case "@ai-sdk/google-vertex":
      return {
        package: "@opencode-ai/ai/providers/google-vertex",
        settings: {
          ...baseSettings,
          ...(typeof input.settings.accessToken === "string" ? { accessToken: input.settings.accessToken } : {}),
          ...mapAPIKey(input.settings),
          ...(typeof input.settings.location === "string" ? { location: input.settings.location } : {}),
          ...(typeof input.settings.project === "string" ? { project: input.settings.project } : {}),
          ...mapGoogleOptions(
            input.settings,
            isStringRecord(input.settings.labels) ? { labels: input.settings.labels } : {},
          ),
        },
        ...(isStringRecord(input.settings.headers) ? { headers: input.settings.headers } : {}),
      }
    case "@ai-sdk/google-vertex/anthropic":
      return {
        package: "@opencode-ai/ai/providers/google-vertex/messages",
        settings: {
          ...baseSettings,
          ...(typeof input.settings.accessToken === "string" ? { accessToken: input.settings.accessToken } : {}),
          ...(typeof input.settings.location === "string" ? { location: input.settings.location } : {}),
          ...(typeof input.settings.project === "string" ? { project: input.settings.project } : {}),
          ...(isRecord(input.settings.thinking) || typeof input.settings.effort === "string"
            ? {
                providerOptions: {
                  anthropic: {
                    ...(isRecord(input.settings.thinking) ? { thinking: input.settings.thinking } : {}),
                    ...(typeof input.settings.effort === "string" ? { effort: input.settings.effort } : {}),
                  },
                },
              }
            : {}),
        },
        ...(isStringRecord(input.settings.headers) ? { headers: input.settings.headers } : {}),
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
  const chat = input.modelID === "openai.gpt-oss-safeguard-20b" || input.modelID === "openai.gpt-oss-safeguard-120b"
  return {
    package: `@opencode-ai/ai/providers/amazon-bedrock/mantle/${chat ? "chat" : "responses"}`,
    settings: {
      ...mapBedrockSettings(settings, baseSettings),
      ...mapOpenAIOptions(settings),
    },
    ...(isStringRecord(settings.headers) ? { headers: settings.headers } : {}),
  }
}

function mapBedrockSettings(
  settings: Readonly<Record<string, unknown>>,
  baseSettings: Readonly<Record<string, unknown>>,
) {
  const apiKey =
    typeof settings.apiKey === "string"
      ? settings.apiKey
      : typeof settings.bearerToken === "string"
        ? settings.bearerToken
        : undefined
  const region = bedrockRegion(settings)
  const credentials = mapBedrockCredentials(settings, region)
  return {
    ...baseSettings,
    ...(typeof baseSettings.baseURL === "string" && region !== undefined
      ? { baseURL: baseSettings.baseURL.replaceAll("${AWS_REGION}", region) }
      : {}),
    ...(typeof settings.baseURL !== "string" && typeof settings.endpoint === "string"
      ? { baseURL: settings.endpoint }
      : {}),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(credentials === undefined ? {} : { credentials }),
    ...(typeof settings.region === "string" ? { region: settings.region } : {}),
    ...(typeof settings.topP === "number" ? { topP: settings.topP } : {}),
  }
}

function mapBedrockRequest(input: MapInput): Pick<Mapping, "headers" | "body"> {
  const settings = input.settings
  const headers = isStringRecord(settings.headers) ? settings.headers : undefined
  const additional = isRecord(settings.additionalModelRequestFields) ? settings.additionalModelRequestFields : {}
  const reasoning = isRecord(settings.reasoningConfig) ? settings.reasoningConfig : undefined
  const anthropic = input.modelID.includes("anthropic")
  const openai = input.modelID.startsWith("openai.")
  const effort = typeof reasoning?.maxReasoningEffort === "string" ? reasoning.maxReasoningEffort : undefined
  const type = typeof reasoning?.type === "string" ? reasoning.type : undefined
  const budget = typeof reasoning?.budgetTokens === "number" ? reasoning.budgetTokens : undefined
  const display = typeof reasoning?.display === "string" ? reasoning.display : undefined
  const betas = Array.isArray(settings.anthropicBeta)
    ? settings.anthropicBeta.filter((item): item is string => typeof item === "string")
    : []
  const existingBetas = Array.isArray(additional.anthropic_beta)
    ? additional.anthropic_beta.filter((item): item is string => typeof item === "string")
    : []
  const fields = Provider.mergeOverlay(additional, {
    ...(betas.length > 0 ? { anthropic_beta: [...existingBetas, ...betas] } : {}),
    ...(anthropic && type === "enabled" && budget !== undefined
      ? { thinking: { type: "enabled", budget_tokens: budget } }
      : {}),
    ...(anthropic && type === "adaptive"
      ? { thinking: { type: "adaptive", ...(display === undefined ? {} : { display }) } }
      : {}),
    ...(anthropic && effort !== undefined
      ? {
          output_config: {
            ...(isRecord(additional.output_config) ? additional.output_config : {}),
            effort,
          },
        }
      : {}),
    ...(!anthropic && openai && effort !== undefined ? { reasoning_effort: effort } : {}),
    ...(!anthropic && !openai && effort !== undefined
      ? {
          reasoningConfig: {
            ...(type === undefined || type === "adaptive" ? {} : { type }),
            ...(budget === undefined ? {} : { budgetTokens: budget }),
            maxReasoningEffort: effort,
          },
        }
      : {}),
  })
  const body = {
    ...(fields && Object.keys(fields).length > 0 ? { additionalModelRequestFields: fields } : {}),
    ...(typeof settings.serviceTier === "string" ? { serviceTier: { type: settings.serviceTier } } : {}),
  }
  return {
    ...(headers === undefined ? {} : { headers }),
    ...(Object.keys(body).length === 0 ? {} : { body }),
  }
}

function mapBedrockCredentials(settings: Readonly<Record<string, unknown>>, region: string | undefined) {
  const credentials = isRecord(settings.credentials) ? settings.credentials : settings
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

function bedrockRegion(settings: Readonly<Record<string, unknown>>) {
  const credentials = isRecord(settings.credentials) ? settings.credentials : settings
  return typeof settings.region === "string"
    ? settings.region
    : typeof credentials.region === "string"
      ? credentials.region
      : undefined
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

function mapGoogleOptions(settings: Readonly<Record<string, unknown>>, extra: Readonly<Record<string, unknown>> = {}) {
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
    ...extra,
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
          "promptCacheKey",
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
  }
  if (Object.keys(options).length === 0) return {}
  return { providerOptions: { xai: options } }
}
