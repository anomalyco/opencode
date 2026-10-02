import { Effect, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import {
  EvaluationAnswer,
  EvaluationInput,
  EvaluationModel,
  EvaluationQuestion,
  EvaluationResponse,
  EvaluationRounding,
} from "../experimental/evaluation.js"
import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIResponses } from "../protocols/openai-responses.js"
import { MetaResponses } from "../protocols/meta-responses.js"
import { XAIResponses } from "../protocols/xai-responses.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { cacheControl } from "../protocols/utils/cache.js"
import { gatewayProtocol } from "../protocols/utils/gateway-protocol.js"
import { VercelAIGatewayOptions, type ProviderOptionsInput } from "./vercel-ai-gateway-options.js"
import { ProviderShared } from "../protocols/shared.js"
import type { ProviderPackage } from "../provider-package.js"
import {
  AIError,
  HttpContext,
  HttpOptions,
  InvalidProviderOutputError,
  InvalidRequestError,
  ModelID,
  ProviderID,
  ProviderMetadata,
  Usage,
  LLMRequest,
} from "../schema/index.js"

export type { GatewayOptions, ProviderOptionsInput } from "./vercel-ai-gateway-options.js"

export const id = ProviderID.make("vercel-ai-gateway")
const baseURL = "https://ai-gateway.vercel.sh/v1"

export interface EvaluationOptions {
  readonly [key: string]: unknown
  readonly gateway?: Readonly<{
    readonly [key: string]: unknown
    readonly zeroDataRetention?: boolean
    readonly only?: ReadonlyArray<string>
  }>
}

export type Options = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings & ProviderOptionsInput & { readonly apiKey?: string }

const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(VercelAIGatewayOptions.Options))

const lower = Effect.fn("VercelAIGateway.lower")(function* (
  request: LLMRequest,
  api: "messages" | "responses" | "chat",
) {
  const options = yield* decodeOptions(request.providerOptions ?? {})
  if (api !== "responses" && (options.cacheTTL !== undefined || options.cacheAnchorItems !== undefined))
    return yield* ProviderShared.invalidRequest("cacheTTL and cacheAnchorItems require the Gateway Responses API")
  if (api === "responses" && request.providerOptions?.thinking !== undefined)
    return yield* ProviderShared.invalidRequest(
      "Responses uses reasoningEffort; put native thinking settings under upstream",
    )
  const chatReasoning =
    api === "chat" && request.providerOptions?.thinking !== undefined
      ? yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(ChatThinking))(request.providerOptions.thinking)
      : undefined
  const effective = options.reasoningEffort ?? options.effort
  const normalized = LLMRequest.update(request, {
    providerOptions: {
      ...request.providerOptions,
      ...(effective === undefined ? {} : { reasoningEffort: effective }),
      ...(api === "messages" && effective !== undefined
        ? {
            effort: effective === "none" ? undefined : effective,
            thinking:
              request.providerOptions?.thinking ?? (effective === "none" ? { type: "disabled" } : { type: "adaptive" }),
          }
        : {}),
    },
  })
  const body = yield* api === "messages"
    ? AnthropicMessages.protocol.body
        .from(normalized)
        .pipe(
          Effect.flatMap(
            ProviderShared.validateWith(Schema.decodeUnknownEffect(AnthropicMessages.protocol.body.schema)),
          ),
        )
    : api === "chat"
      ? OpenAIChat.fromRequest(normalized, { cacheControl: cacheControl() }).pipe(
          Effect.flatMap(ProviderShared.validateWith(Schema.decodeUnknownEffect(OpenAIChat.protocol.body.schema))),
        )
      : request.model.id.startsWith("meta/muse-")
        ? MetaResponses.protocol.body.from(normalized)
        : request.model.id.startsWith("xai/grok-")
          ? XAIResponses.protocol.body.from(normalized)
          : request.model.id.startsWith("openai/")
            ? OpenAIResponses.protocol.body.from(normalized)
            : OpenResponses.protocol.body.from(normalized)
  const caching = request.cache === undefined || request.cache === "auto" ? "auto" : undefined
  return {
    ...body,
    ...(chatReasoning !== undefined
      ? {
          reasoning: {
            enabled: chatReasoning.type !== "disabled",
            ...(chatReasoning.type === "enabled" ? { max_tokens: chatReasoning.budgetTokens } : {}),
          },
        }
      : {}),
    providerOptions: {
      ...options.upstream,
      gateway: { ...(caching === undefined ? {} : { caching }), ...options.gateway },
    },
    ...(api === "responses" && options.cacheTTL !== undefined ? { cache_ttl: options.cacheTTL } : {}),
    ...(api === "responses" && options.cacheAnchorItems !== undefined
      ? { cache_anchor_items: options.cacheAnchorItems }
      : {}),
  }
})

const ChatThinking = Schema.Union([
  Schema.Struct({ type: Schema.Literal("disabled") }),
  Schema.Struct({ type: Schema.Literal("adaptive") }),
  Schema.Struct({ type: Schema.Literal("enabled"), budgetTokens: Schema.Int.check(Schema.isGreaterThan(0)) }),
])

const messagesProtocol = gatewayProtocol(AnthropicMessages.protocol, {
  id: "vercel-ai-gateway-messages",
  from: (request) => lower(request, "messages"),
})
const responsesProtocol = gatewayProtocol(OpenAIResponses.protocol, {
  id: "vercel-ai-gateway-responses",
  from: (request) => lower(request, "responses"),
})
const openResponsesProtocol = gatewayProtocol(OpenResponses.protocol, {
  id: "vercel-ai-gateway-openresponses",
  from: (request) => lower(request, "responses"),
})
const metaProtocol = gatewayProtocol(MetaResponses.protocol, {
  id: "vercel-ai-gateway-meta-responses",
  from: (request) => lower(request, "responses"),
})
const xaiProtocol = gatewayProtocol(XAIResponses.protocol, {
  id: "vercel-ai-gateway-xai-responses",
  from: (request) => lower(request, "responses"),
})
const chatProtocol = gatewayProtocol(OpenAIChat.protocol, {
  id: "vercel-ai-gateway-chat",
  from: (request) => lower(request, "chat"),
})

const messagesRoute = Route.make({
  id: "vercel-ai-gateway-messages",
  provider: id,
  providerMetadataKey: "vercel-ai-gateway",
  protocol: messagesProtocol,
  endpoint: Endpoint.path("/messages", { baseURL }),
  framing: AnthropicMessages.framing,
  defaults: { headers: { "anthropic-version": "2023-06-01" } },
  headers: affinity,
})
const responsesRoute = Route.make({
  id: "vercel-ai-gateway-responses",
  provider: id,
  providerMetadataKey: "vercel-ai-gateway",
  protocol: responsesProtocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  framing: OpenAIChat.framing,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
  headers: affinity,
})
const metaRoute = Route.make({
  id: "vercel-ai-gateway-meta-responses",
  provider: id,
  providerMetadataKey: "vercel-ai-gateway",
  protocol: metaProtocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  framing: OpenAIChat.framing,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
  headers: affinity,
})
const openResponsesRoute = Route.make({
  id: "vercel-ai-gateway-openresponses",
  provider: id,
  providerMetadataKey: "vercel-ai-gateway",
  protocol: openResponsesProtocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  framing: OpenAIChat.framing,
  defaults: { providerOptions: { store: false } },
  headers: affinity,
})
const xaiRoute = Route.make({
  id: "vercel-ai-gateway-xai-responses",
  provider: id,
  providerMetadataKey: "vercel-ai-gateway",
  protocol: xaiProtocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  framing: OpenAIChat.framing,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
  headers: affinity,
})
const chatRoute = Route.make({
  id: "vercel-ai-gateway-chat",
  provider: id,
  providerMetadataKey: "vercel-ai-gateway",
  protocol: chatProtocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
  headers: affinity,
})

function affinity({ request }: { readonly request: LLMRequest }): Record<string, string> {
  return request.promptCacheKey && request.cache !== "none" ? { "x-session-affinity": request.promptCacheKey } : {}
}

export const routes = [messagesRoute, responsesRoute, openResponsesRoute, metaRoute, xaiRoute, chatRoute]

const Request = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.String,
    state: EvaluationInput,
    questions: Schema.Record(Schema.String, EvaluationQuestion),
    providerOptions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)
const Response = Schema.Struct({
  model: Schema.optional(Schema.String),
  answers: Schema.Record(Schema.String, EvaluationAnswer),
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.optional(Schema.Number),
      outputTokens: Schema.optional(Schema.Number),
    }),
  ),
  rounding: Schema.optional(EvaluationRounding),
  providerMetadata: Schema.optional(ProviderMetadata),
})

export const configure = (input: Options = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const configured = {
    ...defaults,
    endpoint: { baseURL: (endpoint ?? baseURL).replace(/\/$/, "").replace(/\/v1$/, "") + "/v1" },
    auth: AuthOptions.bearer(input, ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]),
  }
  const messages = (modelID: string | ModelID) =>
    messagesRoute.with(configured).model<ProviderOptionsInput>({
      id: modelID,
      compatibility: { requireSignature: modelID.startsWith("anthropic/") },
    })
  const responses = (modelID: string | ModelID) =>
    (modelID.startsWith("meta/muse-")
      ? metaRoute
      : modelID.startsWith("xai/grok-")
        ? xaiRoute
        : modelID.startsWith("openai/")
          ? responsesRoute
          : openResponsesRoute
    )
      .with(configured)
      .model<ProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) =>
    chatRoute.with(configured).model<ProviderOptionsInput>({
      id: modelID,
      compatibility: { supportsPromptCacheKey: true, supportsStore: false, reasoningField: "reasoning" },
    })
  const model = (modelID: string | ModelID) =>
    /^(openai\/gpt-|meta\/muse-|xai\/grok-)/.test(modelID) ? responses(modelID) : messages(modelID)
  const evaluation = (modelID: string | ModelID) =>
    EvaluationModel.make<EvaluationOptions>({
      id: modelID,
      provider: id,
      http: HttpOptions.make(input.http),
      route: {
        id: "vercel-evaluation",
        evaluate: (req, send) =>
          Effect.gen(function* () {
            const url = new URL(`${(input.baseURL ?? baseURL).replace(/\/$/, "")}/evaluate`)
            Object.entries(req.http?.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
            const body = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Request))({
              ...req.http?.body,
              model: req.model.id,
              state: req.state,
              questions: req.questions,
              providerOptions: req.options,
            }).pipe(
              Effect.mapError(
                (cause) => new AIError({ reason: new InvalidRequestError({ message: cause.message, cause }) }),
              ),
            )
            const headers = yield* Auth.toEffect(
              AuthOptions.bearer(input, ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]),
            )({
              request: req,
              method: "POST",
              url: url.toString(),
              body,
              headers: Headers.fromInput({ ...input.headers, ...req.http?.headers }),
            })
            const res = yield* send(
              HttpClientRequest.post(url).pipe(
                HttpClientRequest.setHeaders(headers),
                HttpClientRequest.bodyText(body, "application/json"),
              ),
            )
            const http = new HttpContext({ url: res.request.url, status: res.status, headers: res.headers })
            const fail = (message: string, cause: unknown, body?: string) =>
              new AIError({
                reason: new InvalidProviderOutputError({
                  route: "vercel-evaluation",
                  message,
                  body,
                  http,
                  cause,
                }),
              })
            const text = yield* res.text.pipe(
              Effect.mapError((cause) => fail("Failed to read the Vercel AI Gateway evaluation response", cause)),
            )
            const data = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Response))(text).pipe(
              Effect.mapError((cause) =>
                fail("Vercel AI Gateway returned an invalid evaluation response", cause, text),
              ),
            )
            return new EvaluationResponse({
              model: ModelID.make(data.model ?? req.model.id),
              answers: data.answers,
              usage: data.usage
                ? new Usage({
                    inputTokens: data.usage.inputTokens,
                    outputTokens: data.usage.outputTokens,
                    totalTokens:
                      data.usage.inputTokens === undefined && data.usage.outputTokens === undefined
                        ? undefined
                        : (data.usage.inputTokens ?? 0) + (data.usage.outputTokens ?? 0),
                    providerMetadata: { gateway: data.usage },
                  })
                : undefined,
              rounding: data.rounding,
              providerMetadata: data.providerMetadata,
            })
          }),
      },
    })
  return { id, model, messages, responses, chat, experimental: { evaluation }, configure }
}

export const provider = configure()
export const experimental = provider.experimental
export const messages = provider.messages
export const responses = provider.responses
export const chat = provider.chat

export const model: ProviderPackage.Definition<Settings, ProviderOptionsInput>["model"] = (modelID, settings) =>
  fromSettings(settings).model(modelID)
export const messagesModel: ProviderPackage.Definition<Settings, ProviderOptionsInput>["model"] = (modelID, settings) =>
  fromSettings(settings).messages(modelID)
export const responsesModel: ProviderPackage.Definition<Settings, ProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).responses(modelID)
export const chatModel: ProviderPackage.Definition<Settings, ProviderOptionsInput>["model"] = (modelID, settings) =>
  fromSettings(settings).chat(modelID)

function fromSettings({ apiKey, baseURL, headers, body, ...providerOptions }: Settings) {
  return configure({ apiKey, baseURL, headers, http: { body }, providerOptions })
}

export * as VercelAIGateway from "./vercel-ai-gateway.js"
