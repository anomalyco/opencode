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
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { ProviderShared } from "../protocols/shared.js"
import { gatewayProtocol } from "../protocols/utils/gateway-protocol.js"
import type { ProviderPackage } from "../provider-package.js"
import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import type { Protocol } from "../route/protocol.js"
import {
  AIError,
  HttpContext,
  HttpOptions,
  InvalidProviderOutputError,
  InvalidRequestError,
  LLMRequest,
  ModelID,
  ProviderID,
  ProviderMetadata,
  Usage,
} from "../schema/index.js"
import { VercelAIGatewayOptions, type ProviderOptionsInput } from "./vercel-ai-gateway-options.js"

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
const ChatThinking = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["adaptive", "disabled"]) }),
  Schema.Struct({ type: Schema.Literal("enabled"), budgetTokens: Schema.Number }),
])
type ChatThinking = typeof ChatThinking.Type
const decodeChatThinking = ProviderShared.validateWith(Schema.decodeUnknownEffect(ChatThinking))

function messagesRequest(request: LLMRequest, effort: VercelAIGatewayOptions.Options["reasoningEffort"]) {
  if (effort === undefined) return request
  const enabled = effort !== "none"
  const thinking = request.providerOptions?.thinking ?? { type: enabled ? "adaptive" : "disabled" }
  return LLMRequest.update(request, {
    providerOptions: {
      ...request.providerOptions,
      effort: enabled ? effort : undefined,
      thinking,
    },
  })
}

function chatReasoning(thinking: ChatThinking | undefined) {
  if (!thinking) return undefined
  return {
    enabled: thinking.type !== "disabled",
    max_tokens: thinking.type === "enabled" ? thinking.budgetTokens : undefined,
  }
}

function gatewayProviderOptions(request: LLMRequest, options: VercelAIGatewayOptions.Options) {
  const defaultGateway = request.cache === "none" ? undefined : { caching: "auto" as const }
  return {
    ...options.upstream,
    gateway: { ...defaultGateway, ...options.gateway },
  }
}

const prepare = (api: "messages" | "responses" | "chat") =>
  Effect.fnUntraced(function* (request: LLMRequest) {
    const options = yield* decodeOptions(request.providerOptions ?? {})
    const thinking =
      api === "chat" && request.providerOptions?.thinking !== undefined
        ? yield* decodeChatThinking(request.providerOptions.thinking)
        : undefined
    const reasoning = chatReasoning(thinking)
    return {
      request: api === "messages" ? messagesRequest(request, options.reasoningEffort) : request,
      body: {
        ...(reasoning ? { reasoning } : {}),
        providerOptions: gatewayProviderOptions(request, options),
        cache_ttl: api === "responses" ? options.cacheTTL : undefined,
        cache_anchor_items: api === "responses" ? options.cacheAnchorItems : undefined,
      },
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
  return configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body: { ...body } },
    providerOptions,
  })
}

export * as VercelAIGateway from "./vercel-ai-gateway.js"
