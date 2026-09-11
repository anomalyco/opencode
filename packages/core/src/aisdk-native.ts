export * as AISDKNative from "./aisdk-native.js"

import { isRecord } from "@opencode/ai/utils/record"
import { Struct } from "effect"
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
  readonly providerID: string
}

/**
 * Maps an AI SDK package and its flat settings onto the native `@opencode/ai` package that replaces it.
 * Settings pass through `Provider.nativeSettings`; only packages whose AI SDK vocabulary differs from the
 * native one translate keys here.
 */
export function map(input: MapInput): Mapping | undefined {
  const native = mapPackage(input)
  if (!native) return
  const headers = isStringRecord(input.settings.headers) ? input.settings.headers : undefined
  const converse = native === "@opencode/ai/providers/amazon-bedrock"
  // AI SDK constructors take request overlays as `headers` and `extraBody`; the mapping carries them separately.
  // `useCompletionUrls` only selects the Azure package above.
  const settings = {
    ...Struct.omit(input.settings, ["headers", "extraBody", "useCompletionUrls", ...OPENROUTER_HEADER_KEYS]),
    ...(native === "@opencode/ai/providers/openai-compatible" ? { provider: input.providerID } : {}),
  }
  return {
    package: native,
    settings: Provider.nativeSettings(
      native.startsWith("@opencode/ai/providers/amazon-bedrock") ? bedrockSettings(settings, converse) : settings,
    ),
    ...(headers === undefined ? {} : { headers }),
    ...(isRecord(input.settings.extraBody) ? { body: input.settings.extraBody } : {}),
    ...(converse ? bedrockRequest(input) : {}),
    ...(native === "@opencode/ai/providers/openrouter" ? openRouterRequest(input.settings) : {}),
  }
}

function mapPackage(input: MapInput) {
  const settings = input.settings
  switch (input.packageName) {
    case "@ai-sdk/anthropic":
    case "@ai-sdk/cerebras":
    case "@ai-sdk/deepinfra":
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
    case "@ai-sdk/groq":
    case "@ai-sdk/mistral":
    case "@ai-sdk/openai":
    case "@ai-sdk/togetherai":
    case "@ai-sdk/xai":
    case "@ai-sdk/amazon-bedrock":
      return `@opencode/ai/providers/${input.packageName.slice("@ai-sdk/".length)}`
    case "@ai-sdk/amazon-bedrock/mantle":
      return `@opencode/ai/providers/amazon-bedrock/mantle/${input.modelID.includes("gpt-oss") ? "chat" : "responses"}`
    case "@ai-sdk/azure":
      return `@opencode/ai/providers/azure/${settings.useCompletionUrls === true ? "chat" : "responses"}`
    case "@ai-sdk/google-vertex/anthropic":
      return "@opencode/ai/providers/google-vertex/messages"
    case "@ai-sdk/openai-compatible":
      return typeof settings.baseURL === "string" ? "@opencode/ai/providers/openai-compatible" : undefined
    case "@openrouter/ai-sdk-provider":
      return "@opencode/ai/providers/openrouter"
  }
}

// AI SDK connection spellings the native Bedrock packages do not read.
const BEDROCK_CONNECTION_KEYS = [
  "bearerToken",
  "endpoint",
  "credentials",
  "credentialProvider",
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
]
// AI SDK request settings that Converse expects in the body; `bedrockRequest` translates them.
const BEDROCK_BODY_KEYS = ["additionalModelRequestFields", "reasoningConfig", "anthropicBeta", "serviceTier"]

// The AI SDK Bedrock packages spell connection settings differently from the native package.
function bedrockSettings(settings: Readonly<Record<string, unknown>>, converse: boolean) {
  const excluded = converse ? [...BEDROCK_CONNECTION_KEYS, ...BEDROCK_BODY_KEYS] : BEDROCK_CONNECTION_KEYS
  const region = bedrockRegion(settings)
  const credentials = bedrockCredentials(settings, region)
  const baseURL = typeof settings.baseURL === "string" ? settings.baseURL : settings.endpoint
  return {
    ...Object.fromEntries(
      Object.entries(settings).filter(
        ([key, value]) => !excluded.includes(key) && (key !== "auth" || value === "bearer" || value === "sigv4"),
      ),
    ),
    ...(typeof baseURL === "string"
      ? { baseURL: region === undefined ? baseURL : baseURL.replaceAll("${AWS_REGION}", region) }
      : {}),
    ...(typeof settings.apiKey !== "string" && typeof settings.bearerToken === "string"
      ? { apiKey: settings.bearerToken }
      : {}),
    ...(credentials === undefined ? {} : { credentials }),
  }
}

function bedrockRequest(input: MapInput): Pick<Mapping, "body"> {
  const settings = input.settings
  const additional = isRecord(settings.additionalModelRequestFields) ? settings.additionalModelRequestFields : {}
  const reasoning = isRecord(settings.reasoningConfig) ? settings.reasoningConfig : undefined
  const anthropic = input.modelID.includes("anthropic")
  const openai = input.modelID.includes("openai.")
  // Converse passes OpenAI fields through verbatim. gpt-oss (Harmony) takes the
  // flat chat-completions `reasoning_effort`; GPT-5.6+ reject it and take the
  // Responses-style `reasoning.effort` instead.
  const harmony = input.modelID.includes("openai.gpt-oss")
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
    ...(!anthropic && openai && harmony && effort !== undefined ? { reasoning_effort: effort } : {}),
    ...(!anthropic && openai && !harmony && effort !== undefined
      ? { reasoning: { ...(isRecord(additional.reasoning) ? additional.reasoning : {}), effort } }
      : {}),
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
  return Object.keys(body).length === 0 ? {} : { body }
}

function bedrockCredentials(settings: Readonly<Record<string, unknown>>, region: string | undefined) {
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

// The AI SDK OpenRouter package takes app attribution and BYOK keys as constructor options; the native
// package reads them as headers.
const OPENROUTER_HEADER_KEYS = ["appName", "appUrl", "api_keys"] as const

function openRouterRequest(settings: Readonly<Record<string, unknown>>): Pick<Mapping, "headers"> {
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
  return Object.keys(headers).length === 0 ? {} : { headers }
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string")
}
