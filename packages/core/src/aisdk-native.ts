export * as AISDKNative from "./aisdk-native.js"

import { Effect, Option, Schema, Struct } from "effect"
import { Provider } from "./provider.js"

type Overlays = {
  settings?: Provider.Settings
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

type Target<ID extends string> = Overlays & {
  package?: string
  variants?: (Overlays & { id: ID })[]
}

type Context = { readonly providerID: string; readonly canonical?: string; readonly modelID?: string }

export function rewrite<ID extends string>(
  target: Target<ID>,
  input: Context & { readonly specifier: string | undefined },
) {
  if (input.specifier === undefined) return
  const plain = resolve(input.specifier, input)
  if (!plain) return
  const settings = decode(target.settings ?? {})
  const replacement = resolve(input.specifier, { ...input, settings }) ?? plain
  const translated = options(replacement, input.modelID, settings)
  if (target.package !== undefined || replacement !== input.specifier) target.package = replacement
  target.settings =
    target.settings === undefined
      ? undefined
      : {
          ...translated.settings,
          ...(!NATIVE.has(input.specifier) && replacement === "@opencode/ai/providers/openai-compatible"
            ? { provider: input.canonical ?? input.providerID }
            : {}),
        }
  target.headers = Provider.mergeHeaders(translated.headers, target.headers)
  target.body = Provider.mergeOverlay(translated.body, target.body)
  target.variants = target.variants?.map((variant) => {
    const overlay = options(replacement, input.modelID, decode(variant.settings ?? {}))
    const headers = Provider.mergeHeaders(overlay.headers, variant.headers)
    const body = Provider.mergeOverlay(overlay.body, variant.body)
    return {
      id: variant.id,
      ...(variant.settings === undefined ? {} : { settings: overlay.settings }),
      ...(headers === undefined ? {} : { headers }),
      ...(body === undefined ? {} : { body }),
    }
  })
}

const PACKAGES: Readonly<Record<string, string>> = {
  "@ai-sdk/amazon-bedrock": "@opencode/ai/providers/amazon-bedrock",
  "@ai-sdk/alibaba": "@opencode/ai/providers/alibaba/chat",
  "@ai-sdk/anthropic": "@opencode/ai/providers/anthropic",
  "@ai-sdk/azure": "@opencode/ai/providers/azure/responses",
  "@ai-sdk/cerebras": "@opencode/ai/providers/cerebras",
  "@ai-sdk/deepinfra": "@opencode/ai/providers/deepinfra",
  "@ai-sdk/google": "@opencode/ai/providers/google",
  "@ai-sdk/google-vertex": "@opencode/ai/providers/google-vertex",
  "@ai-sdk/google-vertex/anthropic": "@opencode/ai/providers/google-vertex/messages",
  "@ai-sdk/groq": "@opencode/ai/providers/groq",
  "@ai-sdk/mistral": "@opencode/ai/providers/mistral",
  "@ai-sdk/openai": "@opencode/ai/providers/openai",
  "@ai-sdk/openai-compatible": "@opencode/ai/providers/openai-compatible",
  "@ai-sdk/togetherai": "@opencode/ai/providers/togetherai",
  "@ai-sdk/xai": "@opencode/ai/providers/xai",
  "@openrouter/ai-sdk-provider": "@opencode/ai/providers/openrouter",
  "ai-gateway-provider": "@opencode/ai/providers/cloudflare-ai-gateway",
}

const protocols = (name: string) => ({
  "@ai-sdk/openai-compatible": `@opencode/ai/providers/${name}/chat`,
  "@ai-sdk/anthropic": `@opencode/ai/providers/${name}/messages`,
  "@ai-sdk/openai": `@opencode/ai/providers/${name}/responses`,
})

const HOSTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  alibaba: protocols("alibaba"),
  "alibaba-cn": protocols("alibaba"),
  "alibaba-coding-plan": protocols("alibaba"),
  "alibaba-coding-plan-cn": protocols("alibaba"),
  "alibaba-token-plan": protocols("alibaba"),
  "alibaba-token-plan-cn": protocols("alibaba"),
  baseten: { "@ai-sdk/openai-compatible": "@opencode/ai/providers/baseten" },
  "cloudflare-ai-gateway": {
    "@ai-sdk/anthropic": "@opencode/ai/providers/cloudflare-ai-gateway",
    "@ai-sdk/openai": "@opencode/ai/providers/cloudflare-ai-gateway",
    "@ai-sdk/openai-compatible": "@opencode/ai/providers/cloudflare-ai-gateway",
    "ai-gateway-provider": "@opencode/ai/providers/cloudflare-ai-gateway",
  },
  "cloudflare-workers-ai": { "@ai-sdk/openai-compatible": "@opencode/ai/providers/cloudflare-workers-ai" },
  deepseek: { "@ai-sdk/openai-compatible": "@opencode/ai/providers/deepseek" },
  "fireworks-ai": { "@ai-sdk/openai-compatible": "@opencode/ai/providers/fireworks" },
  "google-vertex": { "@ai-sdk/openai-compatible": "@opencode/ai/providers/google-vertex/chat" },
  "kimi-for-coding": protocols("moonshot"),
  meta: protocols("meta"),
  minimax: protocols("minimax"),
  "minimax-cn": protocols("minimax"),
  "minimax-coding-plan": protocols("minimax"),
  "minimax-cn-coding-plan": protocols("minimax"),
  moonshotai: protocols("moonshot"),
  "moonshotai-cn": protocols("moonshot"),
  zai: { "@ai-sdk/openai-compatible": "@opencode/ai/providers/zai/chat" },
  "zai-coding-plan": protocols("zai-coding-plan"),
  zhipuai: { "@ai-sdk/openai-compatible": "@opencode/ai/providers/zai/chat" },
  "zhipuai-coding-plan": protocols("zai-coding-plan"),
}

const NATIVE = new Set([
  ...Object.values(PACKAGES),
  ...Object.values(HOSTS).flatMap((host) => Object.values(host)),
  "@opencode/ai/providers/azure/chat",
  "@opencode/ai/providers/amazon-bedrock/converse",
  "@opencode/ai/providers/amazon-bedrock/chat",
  "@opencode/ai/providers/amazon-bedrock/messages",
  "@opencode/ai/providers/amazon-bedrock/responses",
  "@opencode/ai/providers/amazon-bedrock/mantle",
  "@opencode/ai/providers/amazon-bedrock/mantle/chat",
  "@opencode/ai/providers/amazon-bedrock/mantle/responses",
])

export function native(npm: string, context: Context & { readonly settings?: Provider.Settings }): string | undefined {
  const host = HOSTS[context.providerID]?.[npm]
  if (host) return host
  if (npm === "@ai-sdk/amazon-bedrock/mantle") return mantle(context.modelID)
  if (npm === "@ai-sdk/azure" && context.settings?.useCompletionUrls === true)
    return "@opencode/ai/providers/azure/chat"
  return PACKAGES[npm]
}

const mantle = (modelID: string | undefined) => {
  if (modelID === undefined) return "@opencode/ai/providers/amazon-bedrock/mantle"
  return `@opencode/ai/providers/amazon-bedrock/mantle/${modelID.includes("gpt-oss") ? "chat" : "responses"}`
}

function resolve(specifier: string, context: Context & { readonly settings?: Provider.Settings }): string | undefined {
  const npm = Provider.packageName(specifier)
  if (Provider.isAISDK(specifier) || npm in PACKAGES || npm in (HOSTS[context.providerID] ?? {}))
    return native(npm, context)
  if (npm === "@opencode/ai/providers/amazon-bedrock/mantle") return mantle(context.modelID)
  if (npm === "@opencode/ai/providers/azure/responses" && context.settings?.useCompletionUrls === true)
    return "@opencode/ai/providers/azure/chat"
  return NATIVE.has(npm) ? npm : undefined
}

type Overlay = {
  readonly settings: Provider.Settings
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
}

function options(replacement: string, modelID: string | undefined, settings: Legacy): Overlay {
  const converse = replacement === "@opencode/ai/providers/amazon-bedrock" && modelID !== undefined
  const kept = Struct.omit(settings, ["headers", "extraBody", "useCompletionUrls", ...OPENROUTER_KEYS])
  const thinking = converse ? bedrockThinking(modelID, settings) : undefined
  return {
    settings: {
      ...(replacement.startsWith("@opencode/ai/providers/amazon-bedrock") ? bedrockSettings(kept, converse) : kept),
      ...(thinking === undefined ? {} : { thinking }),
    },
    ...(settings.headers === undefined ? {} : { headers: settings.headers }),
    ...(settings.extraBody === undefined ? {} : { body: settings.extraBody }),
    ...(converse ? bedrockRequest(modelID, settings) : {}),
    ...(replacement === "@opencode/ai/providers/openrouter" ? openRouterRequest(settings) : {}),
  }
}

// AI SDK spellings the native Bedrock packages do not read.
const BEDROCK_KEYS = [
  "bearerToken",
  "endpoint",
  "credentials",
  "credentialProvider",
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
]
// Request settings Converse takes in the body; translated by `bedrockRequest`.
const CONVERSE_KEYS = ["additionalModelRequestFields", "reasoningConfig", "anthropicBeta", "serviceTier"]

function bedrockSettings(settings: Legacy, converse: boolean) {
  const region = settings.region ?? settings.credentials?.region
  const credentials = settings.credentials ?? settings
  const baseURL = settings.baseURL ?? settings.endpoint
  return {
    ...Struct.omit(settings, converse ? [...BEDROCK_KEYS, ...CONVERSE_KEYS] : BEDROCK_KEYS),
    ...(baseURL === undefined
      ? {}
      : { baseURL: region === undefined ? baseURL : baseURL.replaceAll("${AWS_REGION}", region) }),
    ...(settings.apiKey === undefined && settings.bearerToken !== undefined ? { apiKey: settings.bearerToken } : {}),
    ...(credentials.accessKeyId === undefined || credentials.secretAccessKey === undefined
      ? {}
      : {
          credentials: {
            ...(region === undefined ? {} : { region }),
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
          },
        }),
  }
}

// Claude's enabled budget is a typed setting so the protocol can fit it under the output limit.
function bedrockThinking(modelID: string | undefined, settings: Legacy) {
  const reasoning = settings.reasoningConfig
  if (!modelID?.includes("anthropic") || reasoning?.type !== "enabled" || reasoning.budgetTokens === undefined) return
  return { type: "enabled", budgetTokens: reasoning.budgetTokens }
}

function bedrockRequest(modelID: string | undefined, settings: Legacy): Pick<Overlay, "body"> {
  const additional = settings.additionalModelRequestFields ?? {}
  const reasoning = settings.reasoningConfig
  const anthropic = modelID?.includes("anthropic") ?? false
  const openai = modelID?.includes("openai.") ?? false
  // gpt-oss (Harmony) takes the flat chat-completions `reasoning_effort`; GPT-5.6+ take Responses-style `reasoning.effort`.
  const harmony = modelID?.includes("openai.gpt-oss") ?? false
  const effort = reasoning?.maxReasoningEffort
  const type = reasoning?.type
  const budget = reasoning?.budgetTokens
  const display = reasoning?.display
  const betas = settings.anthropicBeta ?? []
  const fields = Provider.mergeOverlay(additional, {
    ...(betas.length > 0 ? { anthropic_beta: [...(additional.anthropic_beta ?? []), ...betas] } : {}),
    ...(anthropic && type === "adaptive"
      ? { thinking: { type: "adaptive", ...(display === undefined ? {} : { display }) } }
      : {}),
    ...(anthropic && effort !== undefined ? { output_config: { ...additional.output_config, effort } } : {}),
    ...(!anthropic && openai && harmony && effort !== undefined ? { reasoning_effort: effort } : {}),
    ...(!anthropic && openai && !harmony && effort !== undefined
      ? { reasoning: { ...additional.reasoning, effort } }
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
    ...(settings.serviceTier === undefined ? {} : { serviceTier: { type: settings.serviceTier } }),
  }
  return Object.keys(body).length === 0 ? {} : { body }
}

// Constructor options the native OpenRouter package takes as headers, plus `compatibility`, which the
// native package would otherwise forward to the request body.
const OPENROUTER_KEYS = ["appName", "appUrl", "api_keys", "compatibility"] as const

function openRouterRequest(settings: Legacy): Pick<Overlay, "headers"> {
  const headers =
    Provider.mergeHeaders(
      {
        ...(settings.appName === undefined ? {} : { "X-OpenRouter-Title": settings.appName }),
        ...(settings.appUrl === undefined ? {} : { "HTTP-Referer": settings.appUrl }),
        ...(settings.api_keys === undefined || Object.keys(settings.api_keys).length === 0
          ? {}
          : { "X-Provider-API-Keys": JSON.stringify(settings.api_keys) }),
      },
      settings.headers,
    ) ?? {}
  return Object.keys(headers).length === 0 ? {} : { headers }
}

const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.UndefinedOr(schema).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(undefined)))))

const Credentials = Schema.Struct({
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
  sessionToken: lenient(Schema.String),
  region: lenient(Schema.String),
})

const Legacy = Schema.StructWithRest(
  Schema.Struct({
    apiKey: lenient(Schema.String),
    baseURL: lenient(Schema.String),
    headers: lenient(Schema.Record(Schema.String, Schema.String)),
    extraBody: lenient(Schema.Record(Schema.String, Schema.Unknown)),
    useCompletionUrls: lenient(Schema.Boolean),
    auth: lenient(Schema.Literals(["bearer", "sigv4"])),
    bearerToken: lenient(Schema.String),
    endpoint: lenient(Schema.String),
    region: lenient(Schema.String),
    credentials: lenient(Credentials),
    accessKeyId: lenient(Schema.String),
    secretAccessKey: lenient(Schema.String),
    sessionToken: lenient(Schema.String),
    anthropicBeta: lenient(Schema.Array(Schema.String)),
    serviceTier: lenient(Schema.String),
    reasoningConfig: lenient(
      Schema.Struct({
        type: lenient(Schema.String),
        display: lenient(Schema.String),
        maxReasoningEffort: lenient(Schema.String),
        budgetTokens: lenient(Schema.Number),
      }),
    ),
    additionalModelRequestFields: lenient(
      Schema.StructWithRest(
        Schema.Struct({
          anthropic_beta: lenient(Schema.Array(Schema.String)),
          output_config: lenient(Schema.Record(Schema.String, Schema.Unknown)),
          reasoning: lenient(Schema.Record(Schema.String, Schema.Unknown)),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
    appName: lenient(Schema.String),
    appUrl: lenient(Schema.String),
    api_keys: lenient(Schema.Record(Schema.String, Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type Legacy = typeof Legacy.Type
const decode = Schema.decodeUnknownSync(Legacy)
