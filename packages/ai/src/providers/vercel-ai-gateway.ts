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
import { optionalNull, ProviderShared } from "../protocols/shared.js"
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
  ReasoningEffort,
  Usage,
} from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("vercel-ai-gateway")
const baseURL = "https://ai-gateway.vercel.sh/v1"

export interface GatewayOptions {
  readonly [key: string]: unknown
  readonly caching?: "auto" | (string & {})
  readonly only?: ReadonlyArray<string>
  readonly order?: ReadonlyArray<string>
  readonly sort?: "cost" | "tps" | "ttft" | (string & {})
  readonly models?: ReadonlyArray<string | Readonly<Record<string, unknown>>>
  readonly zeroDataRetention?: boolean
  readonly disallowPromptTraining?: boolean
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
  readonly idempotencyKey?: string
  readonly quotaEntityId?: string
  readonly serviceTier?: "flex" | "priority" | (string & {})
  readonly user?: string
  readonly tags?: ReadonlyArray<string>
  readonly byok?: Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>
  readonly inferenceRegion?: string
  readonly providerTimeouts?: {
    readonly [key: string]: unknown
    readonly byok?: Readonly<Record<string, number>>
  }
}

export type ProviderOptionsInput = OpenResponsesProviderOptionsInput &
  Omit<AnthropicMessages.OptionsInput, "thinking"> & {
    readonly thinking?:
      | AnthropicMessages.OptionsInput["thinking"]
      | {
          readonly type: "enabled" | "adaptive" | "disabled" | (string & {})
          readonly budgetTokens?: number
          readonly budget_tokens?: number
        }
    readonly gateway?: GatewayOptions
    /** Upstream options forwarded under their Gateway provider namespace. */
    readonly upstream?: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>
    /** Responses automatic-cache lifetime. */
    readonly cacheTTL?: "5m" | "1h" | (string & {})
    /** Number of stable Responses input items. */
    readonly cacheAnchorItems?: number
  }

export interface EvaluationOptions {
  readonly [key: string]: unknown
  readonly gateway?: GatewayOptions
}

export type Options = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings & ProviderOptionsInput & { readonly apiKey?: string }

const GatewayOptionsSchema = Schema.Struct({
  gateway: optionalNull(Schema.Record(Schema.String, Schema.Unknown)),
  upstream: optionalNull(Schema.Record(Schema.String, optionalNull(Schema.Record(Schema.String, Schema.Unknown)))),
  reasoningEffort: optionalNull(ReasoningEffort),
  cacheTTL: optionalNull(Schema.String),
  cacheAnchorItems: optionalNull(Schema.Number),
})
const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(GatewayOptionsSchema))

const ChatThinking = Schema.Struct({
  type: Schema.String,
  budgetTokens: optionalNull(Schema.Number),
  budget_tokens: optionalNull(Schema.Number),
})
type ChatThinking = typeof ChatThinking.Type
const decodeChatThinking = ProviderShared.validateWith(Schema.decodeUnknownEffect(ChatThinking))

function messagesRequest(request: LLMRequest, effort: ReasoningEffort | null | undefined) {
  if (effort === undefined || effort === null) return request
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
    max_tokens: thinking.budgetTokens ?? thinking.budget_tokens ?? undefined,
  }
}

function gatewayProviderOptions(options: typeof GatewayOptionsSchema.Type) {
  const upstream =
    options.upstream === undefined || options.upstream === null
      ? undefined
      : Object.fromEntries(
          Object.entries(options.upstream).filter(([, value]) => value !== undefined && value !== null),
        )
  const hasUpstream = upstream !== undefined && Object.keys(upstream).length > 0
  if (!hasUpstream && !options.gateway) return undefined
  return {
    ...upstream,
    ...(options.gateway ? { gateway: options.gateway } : {}),
  }
}

const prepare = (api: "messages" | "responses" | "chat") =>
  Effect.fnUntraced(function* (request: LLMRequest) {
    const options = yield* decodeOptions(request.providerOptions ?? {})
    const providerOptions = gatewayProviderOptions(options)
    if (api === "messages") {
      return {
        request: messagesRequest(request, options.reasoningEffort),
        body: { providerOptions },
      }
    }
    if (api === "responses") {
      return {
        request,
        body: {
          providerOptions,
          cache_ttl: options.cacheTTL ?? undefined,
          cache_anchor_items: options.cacheAnchorItems ?? undefined,
        },
      }
    }
    const rawThinking = request.providerOptions?.thinking
    const thinking =
      rawThinking === undefined || rawThinking === null ? undefined : yield* decodeChatThinking(rawThinking)
    return {
      request,
      body: {
        providerOptions,
        reasoning: chatReasoning(thinking),
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
  model: optionalNull(Schema.String),
  answers: Schema.Record(Schema.String, EvaluationAnswer),
  usage: optionalNull(
    Schema.Struct({
      inputTokens: optionalNull(Schema.Number),
      outputTokens: optionalNull(Schema.Number),
    }),
  ),
  rounding: optionalNull(EvaluationRounding),
  providerMetadata: optionalNull(ProviderMetadata),
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
                    inputTokens: data.usage.inputTokens ?? undefined,
                    outputTokens: data.usage.outputTokens ?? undefined,
                    totalTokens:
                      data.usage.inputTokens == null && data.usage.outputTokens == null
                        ? undefined
                        : (data.usage.inputTokens ?? 0) + (data.usage.outputTokens ?? 0),
                    providerMetadata: { gateway: data.usage },
                  })
                : undefined,
              rounding: data.rounding ?? undefined,
              providerMetadata: data.providerMetadata ?? undefined,
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
