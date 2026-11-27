import { Effect, Schema } from "effect"
import { Api } from "../api.js"
import { Capabilities } from "../capabilities.js"
import { gatewayModels } from "../cache-policy.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Protocol } from "../route/protocol.js"
import {
  mergeTransport,
  ProviderID,
  type ModelID,
  type OpenString,
  type ProviderOptions,
  type RequestOptions,
} from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { Provider } from "../provider.js"
import { SystemOne } from "../protocols/system-one.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { OpenAIImages, type OpenAIImageSizing } from "../protocols/openai-images.js"
import { OpenRouterVideo } from "../protocols/openrouter-video.js"
import { MediaRoute } from "../route/media.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { cacheControl } from "../protocols/utils/cache.js"
import { isRecord, JsonObject, lenient, ProviderShared } from "../protocols/shared.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"
import { responses } from "./openrouter/responses.js"
import { SharedOptions, sharedOptions, shared } from "./openrouter/shared.js"
import { toConfig } from "./settings.js"

export { model as responsesModel } from "./openrouter/responses.js"
export type { OpenRouterVideoOptions } from "../protocols/openrouter-video.js"

export const id = ProviderID.make("openrouter")

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

export interface OpenRouterEmbeddingOptions {
  readonly [key: string]: unknown
  readonly provider?: OpenRouterProviderRouting
  readonly user?: string
}

/** Connection settings for OpenRouter's media models. Language models come from `openrouter`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenRouterProviderOptionsInput | OpenRouterResponsesProviderOptionsInput
  }

export type Settings<Options = OpenRouterProviderOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

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

const protocol = Protocol.make({
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
      }).pipe(Effect.map((body) => bodyOptions(body, request.providerOptions, request.maxTokens))),
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

export const chatCompletions = Api.make({
  name: "chat-completions",
  id: "openrouter",
  protocol,
  path: OpenAIChat.PATH,
  framing: OpenAIChat.framing,
  capabilities: Capabilities.defaults<Capabilities.ChatCompletions>(),
}).configure({
  capabilities: { cache: { promptCacheKey: true } },
  models: gatewayModels,
})

export const openrouter = Provider.make({ ...shared, apis: [chatCompletions, responses] })

export const model = Provider.entrypoint<Settings, OpenRouterProviderOptionsInput>(openrouter)

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

export const media = (input: Config = {}) => {
  const auth = AuthOptions.bearer(input, "OPENROUTER_API_KEY")
  const endpoint = { baseURL: input.baseURL ?? shared.baseURL }
  const decisionRoute = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "openrouter",
    endpoint,
    auth,
    ...mergeTransport(input),
  })
  const deployment = MediaRoute.deployment({ ...input, baseURL: endpoint.baseURL }, auth)
  const embeddingRoute = OpenAIEmbeddings.route.with({ provider: id, endpoint, auth, ...mergeTransport(input) })
  return {
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      OpenAIImages.model({
        ...deployment,
        id: modelID,
        provider: id,
        providerOptions,
        sizing: imageSizing,
        imageInput: "references",
      }),
    video: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      OpenRouterVideo.model({ ...deployment, id: modelID, providerOptions }),
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      decisionRoute.model<OpenRouterDecisionOptions>({
        id: modelID,
        compatibility: { mediaInput: "state" },
        providerOptions,
      }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model<OpenRouterEmbeddingOptions>({ id: modelID, providerOptions }),
  }
}

const defaultMedia = media()

export const decision = defaultMedia.decision
export const embedding = defaultMedia.embedding
export const image = defaultMedia.image
export const video = defaultMedia.video
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const videoModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).video(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).decision(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

export * as OpenRouter from "./openrouter.js"
