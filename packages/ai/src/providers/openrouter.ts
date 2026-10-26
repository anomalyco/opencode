import { Effect, Schema } from "effect"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { ProviderID, type ModelID, type OpenString } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { SystemOne } from "../protocols/system-one.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { cacheControl } from "../protocols/utils/cache.js"
import { isRecord, JsonObject, lenient, ProviderShared } from "../protocols/shared.js"

export const id = ProviderID.make("openrouter")
const baseURL = "https://openrouter.ai/api/v1"
const ADAPTER = "openrouter"

export interface OpenRouterProviderRouting {
  readonly [key: string]: unknown
  readonly order?: ReadonlyArray<string>
  readonly allow_fallbacks?: boolean
  readonly require_parameters?: boolean
  readonly data_collection?: OpenString<"allow" | "deny">
  readonly only?: ReadonlyArray<string>
  readonly ignore?: ReadonlyArray<string>
  readonly quantizations?: ReadonlyArray<string>
  readonly sort?: OpenString<"price" | "throughput" | "latency">
  readonly max_price?: Readonly<{
    prompt?: number | string
    completion?: number | string
    image?: number | string
    audio?: number | string
    request?: number | string
  }>
  readonly zdr?: boolean
}

export type OpenRouterPlugin =
  | Readonly<{
      id: "web"
      max_results?: number
      search_prompt?: string
      engine?: OpenString<"native" | "exa">
    }>
  | Readonly<{ id: "file-parser"; max_files?: number; pdf?: { engine?: string } }>
  | Readonly<{ id: "moderation" }>
  | Readonly<{ id: "response-healing" }>
  | Readonly<{ id: "auto-router"; allowed_models?: ReadonlyArray<string> }>
  | Readonly<{ id: string & {}; [key: string]: unknown }>

export interface OpenRouterOptions {
  readonly [key: string]: unknown
  readonly debug?: Readonly<{ echo_upstream_body?: boolean }>
  readonly models?: ReadonlyArray<string>
  readonly plugins?: ReadonlyArray<OpenRouterPlugin>
  readonly provider?: OpenRouterProviderRouting
  readonly reasoning?: Readonly<{
    enabled?: boolean
    exclude?: boolean
    effort?: OpenString<"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max">
    max_tokens?: number
  }>
  readonly usage?: boolean | Readonly<{ include: boolean }>
  readonly user?: string
  readonly web_search_options?: Readonly<{
    max_results?: number
    search_prompt?: string
    engine?: OpenString<"native" | "exa">
  }>
}

export type OpenRouterProviderOptionsInput = OpenRouterOptions

export interface OpenRouterDecisionOptions {
  readonly [key: string]: unknown
  readonly provider?: OpenRouterProviderRouting
  readonly session_id?: string
  readonly trace?: Readonly<Record<string, unknown>>
  readonly user?: string
}

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenRouterProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenRouterProviderOptionsInput & {
    readonly apiKey?: string
    readonly baseURL?: string
  }

const Options = Schema.Struct({
  usage: lenient(Schema.Union([Schema.Boolean, JsonObject])),
  models: lenient(Schema.Array(Schema.String)),
  provider: lenient(JsonObject),
  plugins: lenient(Schema.Array(JsonObject)),
  web_search_options: lenient(JsonObject),
  debug: lenient(JsonObject),
  user: lenient(Schema.String),
  reasoning: lenient(JsonObject),
})
const decodeOptions = Schema.decodeUnknownSync(Options)

const OpenRouterBody = Schema.StructWithRest(
  Schema.Struct({
    ...OpenAIChat.bodyFields,
    ...Options.fields,
    usage: Schema.optional(JsonObject),
  }),
  [JsonObject],
)
export type OpenRouterBody = Schema.Schema.Type<typeof OpenRouterBody>

export const protocol = Protocol.make({
  id: "openrouter-chat",
  body: {
    schema: OpenRouterBody,
    from: (request) =>
      OpenAIChat.fromRequest(request, {
        cacheControl: cacheControl(),
        assistant: (source, message) => {
          if (message.role !== "assistant") return message
          const reasoning = source.content
            .filter((part) => part.type === "reasoning")
            .map((part) => part.text)
            .join("")
          const reasoningDetails = Array.isArray(message.reasoning_details) ? message.reasoning_details : undefined
          return {
            ...message,
            reasoning_content: undefined,
            reasoning_text: undefined,
            reasoning: reasoning && reasoningDetails && reasoningDetails.length > 0 ? reasoning : undefined,
            reasoning_details: reasoningDetails,
          }
        },
      }).pipe(Effect.map((body) => bodyOptions(body, request.providerOptions, request.generation?.maxTokens))),
  },
  stream: OpenAIChat.protocol.stream,
})

// OpenRouter forwards `reasoning.max_tokens` as the upstream thinking budget. Upstreams such as Anthropic and Alibaba
// reject one that is not below the output limit; 1,024 is Anthropic's minimum budget.
const fitReasoning = (reasoning: Record<string, unknown>, maxTokens: number | undefined) =>
  typeof reasoning.max_tokens === "number"
    ? { ...reasoning, max_tokens: ProviderShared.fitThinkingBudget(reasoning.max_tokens, maxTokens, 1_024) }
    : reasoning

const bodyOptions = (body: OpenAIChat.OpenAIChatBody, input: unknown, maxTokens: number | undefined) => {
  const openrouter = isRecord(input) ? input : {}
  const options = Object.fromEntries(
    Object.entries(openrouter).filter(([key]) => !(key in Options.fields) && key !== "promptCacheKey"),
  )
  const known = decodeOptions(openrouter)
  const usage =
    openrouter.usage === undefined || known.usage === true
      ? { include: true }
      : known.usage === false
        ? { include: false }
        : known.usage
  return {
    ...options,
    ...body,
    ...(usage !== undefined ? { usage } : {}),
    ...(known.models !== undefined ? { models: known.models } : {}),
    ...(known.provider !== undefined ? { provider: known.provider } : {}),
    ...(known.plugins !== undefined ? { plugins: known.plugins } : {}),
    ...(known.web_search_options !== undefined ? { web_search_options: known.web_search_options } : {}),
    ...(known.debug !== undefined ? { debug: known.debug } : {}),
    ...(known.user !== undefined ? { user: known.user } : {}),
    ...(known.reasoning !== undefined ? { reasoning: fitReasoning(known.reasoning, maxTokens) } : {}),
  }
}

export const route = Route.make({
  id: ADAPTER,
  provider: id,
  providerMetadataKey: "openrouter",
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

export const routes = [route]

const configuredRoute = (input: LanguageModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL: endpoint, ...rest } = input
  return route.with({
    ...rest,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: AuthOptions.bearer(input, "OPENROUTER_API_KEY"),
  })
}

export const configure = (input: LanguageModelOptions = {}) => {
  const route = configuredRoute(input)
  const decisionRoute = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "openrouter",
    endpoint: { baseURL: input.baseURL ?? baseURL },
    auth: AuthOptions.bearer(input, "OPENROUTER_API_KEY"),
    headers: input.headers,
    http: input.http,
  })
  const decision = (modelID: string | ModelID) =>
    decisionRoute.model<OpenRouterDecisionOptions>({ id: modelID, compatibility: { mediaInput: "state" } })
  return {
    id,
    model: (modelID: string | ModelID) =>
      route.model<OpenRouterProviderOptionsInput>({ id: modelID, compatibility: { supportsPromptCacheKey: true } }),
    decision,
    configure,
  }
}

export const provider = configure()
export const decision = provider.decision
export const model: ProviderPackage.Definition<Settings, OpenRouterProviderOptionsInput>["model"] = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions },
) =>
  configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).model(modelID)
