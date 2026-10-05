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
  /** Fallback models to try in order, or a conditional `{ model, when }` entry on evaluation requests. */
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
  gateway: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  upstream: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  reasoningEffort: Schema.optional(ReasoningEffort),
  cacheTTL: Schema.optional(Schema.String),
  cacheAnchorItems: Schema.optional(Schema.Number),
})
const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(GatewayOptionsSchema))

const ChatThinking = Schema.Struct({
  type: Schema.String,
  budgetTokens: Schema.optional(Schema.Number),
  budget_tokens: Schema.optional(Schema.Number),
})
type ChatThinking = typeof ChatThinking.Type
const decodeChatThinking = ProviderShared.validateWith(Schema.decodeUnknownEffect(ChatThinking))

function messagesRequest(request: LLMRequest, effort: ReasoningEffort | undefined) {
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
    max_tokens: thinking.budgetTokens ?? thinking.budget_tokens,
  }
}

function gatewayProviderOptions(options: typeof GatewayOptionsSchema.Type) {
  if (options.upstream === undefined && options.gateway === undefined) return undefined
  return {
    ...options.upstream,
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
          cache_ttl: options.cacheTTL,
          cache_anchor_items: options.cacheAnchorItems,
        },
      }
    }
    const thinking =
      request.providerOptions?.thinking === undefined
        ? undefined
        : yield* decodeChatThinking(request.providerOptions.thinking)
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
