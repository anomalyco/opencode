export * as AISDKNative from "./aisdk-native.js"

import { Effect, Option, Schema, Struct } from "effect"
import { Provider } from "./provider.js"

/** A provider, model, or variant overlay written in legacy AI SDK vocabulary. */
export interface Overlay {
  readonly settings?: Provider.Settings
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
}

/** Fields the rewrite touches; catalog records and migrated config entries both fit. */
export interface Target {
  package?: string
  settings?: Provider.Settings
  headers?: Readonly<Record<string, string>>
  body?: Readonly<Record<string, unknown>>
}

export interface ModelTarget extends Target {
  readonly id: string
  readonly modelID?: string
  variants?: ReadonlyArray<{ readonly id: string } & Overlay>
}

/** Rewrites a provider and its models in place so they name native packages and native settings wherever one exists. */
export function rewrite(provider: Target, models: Iterable<ModelTarget>) {
  const inherited = Provider.isAISDK(provider.package)
    ? nativePackage(Provider.packageName(provider.package), undefined, provider.settings)
    : undefined
  // Converse request settings depend on the model, so provider-level ones move onto each model first.
  const converse = inherited === BEDROCK ? Struct.pick(provider.settings ?? {}, CONVERSE_KEYS) : {}
  if (inherited === BEDROCK && provider.settings) provider.settings = Struct.omit(provider.settings, CONVERSE_KEYS)
  for (const model of models) {
    const legacy = model.package ?? provider.package
    if (!Provider.isAISDK(legacy)) continue
    if (model.package === undefined) model.settings = Provider.mergeOverlay(converse, model.settings)
    const modelID = model.modelID ?? model.id
    const native = nativePackage(
      Provider.packageName(legacy),
      modelID,
      Provider.mergeOverlay(provider.settings, model.settings),
    )
    if (!native) continue
    assign(model, translate(native, model, modelID))
    model.variants = model.variants?.map((variant) => ({ id: variant.id, ...translate(native, variant, modelID) }))
    model.package = model.package !== undefined || native !== inherited ? native : undefined
  }
  if (!inherited) return
  assign(provider, translate(inherited, provider))
  provider.package = inherited
}

function assign(target: Target, overlay: Overlay) {
  target.settings = overlay.settings
  target.headers = overlay.headers
  target.body = overlay.body
}

/** Native package replacing a legacy AI SDK package, or undefined when the AI SDK runtime must run it. */
export function nativePackage(npm: string | undefined, modelID = "", settings?: Provider.Settings) {
  switch (npm) {
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
      return `@opencode/ai/providers/${npm.slice("@ai-sdk/".length)}`
    case "@ai-sdk/amazon-bedrock/mantle":
      return `@opencode/ai/providers/amazon-bedrock/mantle/${modelID.includes("gpt-oss") ? "chat" : "responses"}`
    case "@ai-sdk/azure":
      return `@opencode/ai/providers/azure/${settings?.useCompletionUrls === true ? "chat" : "responses"}`
    case "@ai-sdk/google-vertex/anthropic":
      return "@opencode/ai/providers/google-vertex/messages"
    case "@ai-sdk/openai-compatible":
      return "@opencode/ai/providers/openai-compatible"
    case "@openrouter/ai-sdk-provider":
      return "@opencode/ai/providers/openrouter"
  }
}

// A wrongly typed legacy value is dropped rather than failing the whole decode.
const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.UndefinedOr(schema).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(undefined)))))

const Credentials = Schema.Struct({
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
  sessionToken: lenient(Schema.String),
  region: lenient(Schema.String),
})

/** AI SDK settings whose spelling differs from the native package. Everything else passes through. */
const Legacy = Schema.StructWithRest(
  Schema.Struct({
    apiKey: lenient(Schema.String),
    baseURL: lenient(Schema.String),
    headers: lenient(Schema.Record(Schema.String, Schema.String)),
    extraBody: lenient(Schema.Record(Schema.String, Schema.Unknown)),
    useCompletionUrls: lenient(Schema.Boolean),
    // Bedrock
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
    // OpenRouter
    appName: lenient(Schema.String),
    appUrl: lenient(Schema.String),
    api_keys: lenient(Schema.Record(Schema.String, Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type Legacy = typeof Legacy.Type
const decode = Schema.decodeUnknownSync(Legacy)

const BEDROCK = "@opencode/ai/providers/amazon-bedrock"

/** Translates one legacy overlay into the spelling `native` reads. Explicit headers and body win over translated ones. */
export function translate(native: string, overlay: Overlay, modelID = ""): Overlay {
  const settings = decode(overlay.settings ?? {})
  const converse = native === BEDROCK
  // Wrongly typed legacy values decode to undefined; drop them rather than forward them.
  const mapped = Object.fromEntries(
    Object.entries(Struct.omit(settings, ["headers", "extraBody", "useCompletionUrls", ...OPENROUTER_KEYS])).filter(
      ([, value]) => value !== undefined,
    ),
  )
  return defined({
    settings: native.startsWith(BEDROCK) ? bedrockSettings(mapped, converse) : mapped,
    headers: Provider.mergeHeaders(
      native === "@opencode/ai/providers/openrouter" ? openRouterHeaders(settings) : settings.headers,
      overlay.headers,
    ),
    body: Provider.mergeOverlay(
      Provider.mergeOverlay(settings.extraBody, converse ? bedrockBody(modelID, settings) : undefined),
      overlay.body,
    ),
  })
}

// Keeps catalog records free of empty overlays.
function defined(overlay: Overlay): Overlay {
  return Object.fromEntries(
    Object.entries(overlay).filter(([, value]) => value !== undefined && Object.keys(value).length > 0),
  )
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
// Request settings Converse takes in the body; translated by `bedrockBody`.
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
    ...(region === undefined || credentials.accessKeyId === undefined || credentials.secretAccessKey === undefined
      ? {}
      : {
          credentials: {
            region,
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
          },
        }),
  }
}

function bedrockBody(modelID: string, settings: Legacy) {
  const additional = settings.additionalModelRequestFields ?? {}
  const reasoning = settings.reasoningConfig
  const anthropic = modelID.includes("anthropic")
  const openai = modelID.includes("openai.")
  // gpt-oss (Harmony) takes the flat chat-completions `reasoning_effort`; GPT-5.6+ take Responses-style `reasoning.effort`.
  const harmony = modelID.includes("openai.gpt-oss")
  const effort = reasoning?.maxReasoningEffort
  const type = reasoning?.type
  const budget = reasoning?.budgetTokens
  const display = reasoning?.display
  const betas = settings.anthropicBeta ?? []
  const fields = Provider.mergeOverlay(additional, {
    ...(betas.length > 0 ? { anthropic_beta: [...(additional.anthropic_beta ?? []), ...betas] } : {}),
    ...(anthropic && type === "enabled" && budget !== undefined
      ? { thinking: { type: "enabled", budget_tokens: budget } }
      : {}),
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
  return Object.keys(body).length === 0 ? undefined : body
}

// Constructor options the native OpenRouter package takes as headers, plus `compatibility`, which the
// native package would otherwise forward to the request body.
const OPENROUTER_KEYS = ["appName", "appUrl", "api_keys", "compatibility"] as const

function openRouterHeaders(settings: Legacy) {
  return Provider.mergeHeaders(
    {
      ...(settings.appName === undefined ? {} : { "X-OpenRouter-Title": settings.appName }),
      ...(settings.appUrl === undefined ? {} : { "HTTP-Referer": settings.appUrl }),
      ...(settings.api_keys === undefined || Object.keys(settings.api_keys).length === 0
        ? {}
        : { "X-Provider-API-Keys": JSON.stringify(settings.api_keys) }),
    },
    settings.headers,
  )
}
