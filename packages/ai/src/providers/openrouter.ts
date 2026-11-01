import { Effect, Schema } from "effect"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { ProviderID, type ModelID, type OpenString, type ProviderOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { SystemOne } from "../protocols/system-one.js"
import { OpenAIImages, type OpenAIImageSizing } from "../protocols/openai-images.js"
import { MediaRoute } from "../route/media.js"
import { HttpTransport } from "../route/transport/index.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { cacheControl } from "../protocols/utils/cache.js"
import { isRecord, JsonObject, lenient, ProviderShared } from "../protocols/shared.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

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

export type OpenRouterResponsesProviderOptionsInput = OpenResponsesProviderOptionsInput &
  Pick<OpenRouterOptions, "debug" | "models" | "plugins" | "provider" | "user">

export interface OpenRouterDecisionOptions {
  readonly [key: string]: unknown
  readonly provider?: OpenRouterProviderRouting
  readonly session_id?: string
  readonly trace?: Readonly<Record<string, unknown>>
  readonly user?: string
}

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenRouterProviderOptionsInput | OpenRouterResponsesProviderOptionsInput
  }

export type Settings<Options = OpenRouterProviderOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const SharedOptions = Schema.Struct({
  models: lenient(Schema.Array(Schema.String)),
  provider: lenient(JsonObject),
  plugins: lenient(Schema.Array(JsonObject)),
  debug: lenient(JsonObject),
  user: lenient(Schema.String),
})

const Options = Schema.Struct({
  ...SharedOptions.fields,
  usage: lenient(Schema.Union([Schema.Boolean, JsonObject])),
  web_search_options: lenient(JsonObject),
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
    ...sharedOptions(known),
    ...(known.web_search_options !== undefined ? { web_search_options: known.web_search_options } : {}),
    ...(known.reasoning !== undefined ? { reasoning: fitReasoning(known.reasoning, maxTokens) } : {}),
  }
}

const IMAGE_RESOLUTIONS = new Set(["512", "768", "1K", "1.5K", "2K", "4K"])

// A pixel `size` renders at the upstream's own tier (Gemini 2K comes back as 4K) and FLUX 3 rejects it, so sizing goes
// out as an aspect ratio and a resolution tier. Values OpenRouter doesn't list are left out.
const imageSizing: OpenAIImageSizing = (request) => {
  const resolution = request.resolution
    ?.toUpperCase()
    .replace(/^0\.5K$/, "512")
    .replace(/^0\.75K$/, "768")
  return {
    aspect_ratio: request.aspect,
    resolution: resolution !== undefined && IMAGE_RESOLUTIONS.has(resolution) ? resolution : undefined,
  }
}

const sharedOptions = (known: typeof SharedOptions.Type) => ({
  ...(known.models !== undefined ? { models: known.models } : {}),
  ...(known.provider !== undefined ? { provider: known.provider } : {}),
  ...(known.plugins !== undefined ? { plugins: known.plugins } : {}),
  ...(known.debug !== undefined ? { debug: known.debug } : {}),
  ...(known.user !== undefined ? { user: known.user } : {}),
})

const OpenRouterResponsesBody = Schema.Struct({
  ...OpenResponses.OpenResponsesBody.fields,
  ...SharedOptions.fields,
})
type OpenRouterResponsesBody = Schema.Schema.Type<typeof OpenRouterResponsesBody>

const responsesProtocol = Protocol.make({
  id: "openrouter-responses",
  body: {
    schema: OpenRouterResponsesBody,
    from: (request) =>
      OpenResponses.fromRequest(request).pipe(
        Effect.map((body) => ({ ...body, ...sharedOptions(decodeOptions(request.providerOptions ?? {})) })),
      ),
  },
  stream: OpenResponses.protocol.stream,
})

export const route = Route.make({
  id: ADAPTER,
  provider: id,
  providerMetadataKey: "openrouter",
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

const responsesRoute = Route.make({
  id: "openrouter-responses",
  provider: id,
  providerMetadataKey: "openrouter",
  protocol: responsesProtocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  transport: HttpTransport.sseJson.with<OpenRouterResponsesBody>(),
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

export const routes = [route, responsesRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const auth = AuthOptions.bearer(input, "OPENROUTER_API_KEY")
  const options = { ...defaults, endpoint: { baseURL: endpoint ?? baseURL }, auth }
  const chatRoute = route.with(options)
  const configuredResponses = responsesRoute.with(options)
  const decisionRoute = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "openrouter",
    endpoint: { baseURL: input.baseURL ?? baseURL },
    auth,
    headers: input.headers,
    http: input.http,
  })
  const media = MediaRoute.deployment({ ...input, baseURL: input.baseURL ?? baseURL }, auth)
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    OpenAIImages.model({
      ...media,
      id: modelID,
      provider: id,
      providerOptions,
      sizing: imageSizing,
      imageInput: "references",
    })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    decisionRoute.model<OpenRouterDecisionOptions>({
      id: modelID,
      compatibility: { mediaInput: "state" },
      providerOptions,
    })
  const chat = (modelID: string | ModelID) =>
    chatRoute.model<OpenRouterProviderOptionsInput>({ id: modelID, compatibility: { supportsPromptCacheKey: true } })
  return {
    id,
    model: chat,
    chat,
    responses: (modelID: string | ModelID) =>
      configuredResponses.model<OpenRouterResponsesProviderOptionsInput>({ id: modelID }),
    image,
    decision,
    configure,
  }
}

export const provider = configure()
export const decision = provider.decision
export const image = provider.image
export const chat = provider.chat
export const responses = provider.responses
export const model: ProviderPackage.Model<Settings, OpenRouterProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const responsesModel: ProviderPackage.Model<
  Settings<OpenRouterResponsesProviderOptionsInput>,
  OpenRouterResponsesProviderOptionsInput
> = (modelID, settings) => configure(config(settings)).responses(modelID)
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as OpenRouter from "./openrouter.js"
