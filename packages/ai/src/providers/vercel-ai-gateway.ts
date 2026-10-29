import { Effect, Schema } from "effect"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { OpenAIDecisions } from "../protocols/openai-decisions.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { ProviderShared } from "../protocols/shared.js"
import { gatewayProtocol } from "../protocols/utils/gateway-protocol.js"
import type { ProviderPackage } from "../provider-package.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { MediaRoute } from "../route/media.js"
import type { Protocol } from "../route/protocol.js"
import {
  LLMRequest,
  ModelID,
  ProviderID,
  ProviderMetadata,
  ReasoningEffort,
  type ProviderOptions,
} from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("vercel-ai-gateway")
const baseURL = "https://ai-gateway.vercel.sh/v1"

export interface GatewayOptions {
  /** Service-owned options added by the Gateway without requiring an SDK update. */
  readonly [key: string]: unknown
  /** Enables Gateway automatic prompt-cache breakpoint injection (`"auto"`). */
  readonly caching?: "auto" | (string & {})
  /** Provider slugs that are the only ones allowed to serve the request (e.g. `["anthropic", "vertex"]`). */
  readonly only?: ReadonlyArray<string>
  /** Provider slugs specifying the order in which providers are tried (e.g. `["bedrock", "anthropic"]`). */
  readonly order?: ReadonlyArray<string>
  /** Sort candidate providers by cost (`"cost"`), throughput (`"tps"`), or time-to-first-token (`"ttft"`). */
  readonly sort?: "cost" | "tps" | "ttft" | (string & {})
  /** Fallback models to try in order. */
  readonly models?: ReadonlyArray<string | Readonly<Record<string, unknown>>>
  /** Restrict routing to providers with zero data retention agreements. */
  readonly zeroDataRetention?: boolean
  /** Restrict routing to providers that do not train on prompt data. */
  readonly disallowPromptTraining?: boolean
  /**
   * Restrict routing to provider models that satisfy every entry: capability
   * tags (`"implicit-caching"`, `"reasoning"`, `"structured-output"`,
   * `"tool-use"`, `"vision"`) or weight-format filters (`"quantization:fp8"`,
   * `"!quantization:fp8"`).
   */
  readonly has?: ReadonlyArray<
    | "implicit-caching"
    | "reasoning"
    | "structured-output"
    | "tool-use"
    | "vision"
    | `quantization:${string}`
    | `!quantization:${string}`
    | (string & {})
  >
  /** Entity identifier against which Gateway quota is tracked. */
  readonly quotaEntityId?: string
  /** Unified service tier intent (`"flex"` or `"priority"`). */
  readonly serviceTier?: "flex" | "priority" | (string & {})
  /** End-user identifier for spend tracking and attribution. */
  readonly user?: string
  /** User-specified tags for reporting and filtering usage. */
  readonly tags?: ReadonlyArray<string>
  /** Request-scoped BYOK credentials keyed by provider slug, used instead of cached workspace credentials. */
  readonly byok?: Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>
  /** Preferred inference region for upstream provider routing. */
  readonly inferenceRegion?: string
  /** Per-provider timeouts in milliseconds (e.g. `{ byok: { anthropic: 3000 } }`). */
  readonly providerTimeouts?: {
    readonly [key: string]: unknown
    readonly byok?: Readonly<Record<string, number>>
  }
}

export type ProviderOptionsInput = OpenResponsesProviderOptionsInput &
  Omit<AnthropicMessages.OptionsInput, "thinking"> & {
    /** Reasoning configuration for Messages (`thinking`) or Chat (`reasoning.enabled` + `reasoning.max_tokens`). */
    readonly thinking?:
      | AnthropicMessages.OptionsInput["thinking"]
      | {
          readonly type: "enabled" | "adaptive" | "disabled" | (string & {})
          readonly budgetTokens?: number
          readonly budget_tokens?: number
        }
    /** Gateway routing, fallback, BYOK, compliance, and attribution options sent under `body.providerOptions.gateway`. */
    readonly gateway?: GatewayOptions
    /** Provider-specific options forwarded under their upstream namespace in `body.providerOptions` (e.g. `{ anthropic: { ... } }`). */
    readonly upstream?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    /** Responses API automatic-cache lifetime (`"5m"` or `"1h"`), sent as top-level `cache_ttl`. */
    readonly cacheTTL?: "5m" | "1h" | (string & {})
    /** Responses API count of stable input items to anchor for caching, sent as top-level `cache_anchor_items`. */
    readonly cacheAnchorItems?: number
  }

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings & ProviderOptionsInput & { readonly apiKey?: string }

const GatewayOptionsSchema = Schema.Struct({
  gateway: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  upstream: Schema.optional(ProviderMetadata),
  reasoningEffort: Schema.optional(ReasoningEffort),
  thinking: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      budgetTokens: Schema.optional(Schema.Number),
      budget_tokens: Schema.optional(Schema.Number),
    }),
  ),
  cacheTTL: Schema.optional(Schema.String),
  cacheAnchorItems: Schema.optional(Schema.Number),
})
const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(GatewayOptionsSchema))

const prepare = (api: "messages" | "responses" | "chat") =>
  Effect.fnUntraced(function* (request: LLMRequest) {
    const options = yield* decodeOptions(request.providerOptions ?? {})
    const providerOptions = (() => {
      if (!options.upstream && !options.gateway) return undefined
      if (!options.gateway) return options.upstream
      return { ...options.upstream, gateway: options.gateway }
    })()
    switch (api) {
      case "messages": {
        const effort = options.reasoningEffort
        if (effort === undefined) return { request, body: { providerOptions } }
        const enabled = effort !== "none"
        const thinking = request.providerOptions?.thinking ?? { type: enabled ? "adaptive" : "disabled" }
        const next = LLMRequest.update(request, {
          providerOptions: {
            ...request.providerOptions,
            effort: enabled ? effort : undefined,
            thinking,
          },
        })
        return { request: next, body: { providerOptions } }
      }
      case "responses":
        return {
          request,
          body: {
            providerOptions,
            cache_ttl: options.cacheTTL,
            cache_anchor_items: options.cacheAnchorItems,
          },
        }
      case "chat": {
        if (!options.thinking) return { request, body: { providerOptions } }
        const reasoning = {
          enabled: options.thinking.type !== "disabled",
          max_tokens: options.thinking.budgetTokens ?? options.thinking.budget_tokens,
        }
        return { request, body: { providerOptions, reasoning } }
      }
    }
  })

const route = <Body, Event, State>(input: {
  readonly id: string
  readonly protocol: Protocol<Body, string, Event, State>
  readonly api: "messages" | "responses" | "chat"
  readonly path: string
  readonly framing: Framing.Definition<string>
  readonly defaults?: RouteDefaultsInput
}) =>
  Route.make({
    id: input.id,
    provider: id,
    providerMetadataKey: id,
    protocol: gatewayProtocol(input.protocol, { id: input.id, prepare: prepare(input.api) }),
    endpoint: Endpoint.path(input.path, { baseURL }),
    framing: input.framing,
    headers: ({ request }): Record<string, string> =>
      request.promptCacheKey ? { "x-session-affinity": request.promptCacheKey } : {},
    defaults: input.defaults,
  })

const messagesRoute = route({
  id: "vercel-ai-gateway-messages",
  protocol: AnthropicMessages.protocol,
  api: "messages",
  path: "/messages",
  framing: AnthropicMessages.framing,
  defaults: { headers: { "anthropic-version": "2023-06-01" } },
})
const responsesRoute = route({
  id: "vercel-ai-gateway-responses",
  protocol: OpenResponses.protocol,
  api: "responses",
  path: "/responses",
  framing: Framing.sse,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})
const chatRoute = route({
  id: "vercel-ai-gateway-chat",
  protocol: OpenAIChat.protocol,
  api: "chat",
  path: "/chat/completions",
  framing: OpenAIChat.framing,
})

export const routes = [messagesRoute, responsesRoute, chatRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const configured = {
    ...defaults,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: AuthOptions.bearer(input, ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]),
  }
  const messages = (modelID: string | ModelID) =>
    messagesRoute.with(configured).model<ProviderOptionsInput>({
      id: modelID,
      // Recorded Gateway translations for non-Claude models return thinking with empty signatures.
      compatibility: { requireSignature: modelID.startsWith("anthropic/") },
    })
  const responses = (modelID: string | ModelID) =>
    responsesRoute.with(configured).model<ProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) =>
    chatRoute
      .with(configured)
      .model<ProviderOptionsInput>({ id: modelID, compatibility: { reasoningField: "reasoning" } })
  // Each family uses the API whose Gateway translation carries its reasoning state across turns.
  const model = (modelID: string | ModelID) => {
    if (/^(openai\/gpt-|spacexai\/grok-)/.test(modelID)) return responses(modelID)
    if (modelID.startsWith("meta/muse-")) return chat(modelID)
    return messages(modelID)
  }
  const media = MediaRoute.deployment({ ...input, baseURL: configured.endpoint.baseURL }, configured.auth)
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    OpenAIImages.model({ ...media, id: modelID, provider: id, providerOptions })
  const decisionRoute = OpenAIDecisions.route.with({
    provider: id,
    endpoint: { baseURL: configured.endpoint.baseURL },
    auth: configured.auth,
    headers: input.headers,
    http: input.http,
  })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    decisionRoute.model({ id: modelID, providerOptions })
  return { id, model, messages, responses, chat, image, decision, configure }
}

export const provider = configure()
export const decision = provider.decision
export const messages = provider.messages
export const responses = provider.responses
export const chat = provider.chat
export const image = provider.image

export const model: ProviderPackage.Model<Settings, ProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const messagesModel: ProviderPackage.Model<Settings, ProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).messages(modelID)
export const responsesModel: ProviderPackage.Model<Settings, ProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).responses(modelID)
export const chatModel: ProviderPackage.Model<Settings, ProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).chat(modelID)
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, headers, body, ...providerOptions }: Settings = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as VercelAIGateway from "./vercel-ai-gateway.js"
