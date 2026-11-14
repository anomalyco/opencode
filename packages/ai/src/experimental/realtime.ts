import { Clock, Effect, Redacted, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { RequestExecutor } from "../route/executor.js"
import { AIError, InvalidProviderOutputError, InvalidRequestError } from "../schema/index.js"
import { encodeJson } from "../utils/json.js"

const OPENAI_BASE_URL = "https://api.openai.com/v1"
const XAI_BASE_URL = "https://api.x.ai/v1"
const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export type RealtimeTransportInput =
  | { readonly type: "webrtc"; readonly sdp: string; readonly dcid?: number }
  | { readonly type: "websocket" }

export type RealtimeTransportType = RealtimeTransportInput["type"]

export type RealtimeTransport =
  | { readonly type: "webrtc"; readonly sdp: string }
  | { readonly type: "websocket"; readonly url: string; readonly token: string; readonly expiresAt: number }

export type RealtimeSession = Readonly<Record<string, unknown>>

export interface RealtimeConnectInput {
  readonly model: string
  readonly apiKey: Redacted.Redacted
  /** Where a GPT-Live session starts, OpenAI by default: another host of its API, such as OpenCode's. */
  readonly baseURL?: string
  /** Headers that host needs besides the API key, such as OpenCode's workspace. */
  readonly headers?: Readonly<Record<string, string>>
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

export const engines = [
  { family: "gpt-live", model: "gpt-live-1", id: "openai-live", provider: "openai", transports: ["webrtc"] },
  {
    family: "gpt-realtime",
    model: "gpt-realtime-2.1",
    id: "openai-realtime",
    provider: "openai",
    transports: ["webrtc", "websocket"],
  },
  { family: "grok-voice", model: "grok-voice-3.0", id: "xai-realtime", provider: "xai", transports: ["websocket"] },
  {
    family: "gemini-3.8-live",
    model: "gemini-3.8-live",
    id: "gemini-live",
    provider: "google",
    transports: ["websocket"],
  },
] as const

// Matches the bare family name (`gpt-realtime`) and its versions (`gpt-realtime-2.1`, `gpt-realtime-mini`).
export const engine = (model: string) =>
  engines.find((item) => model === item.family || model.startsWith(`${item.family}-`))

export const connect = Effect.fn("Realtime.connect")(function* (input: RealtimeConnectInput) {
  const resolved = engine(input.model)
  if (!resolved) return yield* invalidRequest(`Unsupported voice model: ${input.model}`)
  if (!resolved.transports.some((type) => type === input.transport.type))
    return yield* invalidRequest(`${input.model} only supports ${resolved.transports.join(", ")} transport`)
  const session = { ...input.session, model: input.model }

  switch (resolved.id) {
    case "openai-live": {
      const data = yield* post(
        resolved.id,
        `${input.baseURL ?? OPENAI_BASE_URL}/live/sessions`,
        input.apiKey,
        { session, transport: input.transport },
        LiveSessionResponse,
        { headers: input.headers },
      )
      return { type: "webrtc" as const, sdp: data.transport.sdp }
    }
    case "openai-realtime": {
      if (input.transport.type === "websocket")
        return yield* clientSecret(resolved.id, OPENAI_BASE_URL, input.model, input.apiKey, {
          expires_after: { anchor: "created_at", seconds: 60 },
          session,
        })
      const form = new FormData()
      form.append("sdp", input.transport.sdp)
      form.append("session", encodeJson(session))
      const query = input.transport.dcid === undefined ? "" : `?dcid=${input.transport.dcid}`
      const sdp = yield* post(
        resolved.id,
        `${OPENAI_BASE_URL}/realtime/calls${query}`,
        input.apiKey,
        form,
        Schema.String,
      )
      return { type: "webrtc" as const, sdp }
    }
    case "xai-realtime":
      return yield* clientSecret(resolved.id, XAI_BASE_URL, input.model, input.apiKey, {
        expires_after: { seconds: 60 },
      })
    case "gemini-live": {
      const now = yield* Clock.currentTimeMillis
      const expiresAt = now + 60_000
      const data = yield* post(
        resolved.id,
        `${GOOGLE_BASE_URL}/auth_tokens`,
        input.apiKey,
        {
          uses: 1,
          expireTime: new Date(now + 30 * 60_000).toISOString(),
          newSessionExpireTime: new Date(expiresAt).toISOString(),
          bidiGenerateContentSetup: { ...input.session, model: `models/${input.model}` },
        },
        AuthTokenResponse,
        { authHeader: "x-goog-api-key" },
      )
      return {
        type: "websocket" as const,
        url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
        token: data.name,
        expiresAt: Math.floor(expiresAt / 1000),
      }
    }
  }
})

export const Realtime = {
  engines,
  engine,
  connect,
} as const

const LiveSessionResponse = Schema.fromJsonString(
  Schema.Struct({
    transport: Schema.Struct({ sdp: Schema.String }),
  }),
)

// xAI's ephemeral-token docs (https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens)
// document the request body (`{ expires_after: { seconds } }`, no `anchor` or `session`) but not the response payload; we assume
// it mirrors OpenAI's `{ value, expires_at }` response shape.
const ClientSecretResponse = Schema.fromJsonString(
  Schema.Struct({
    value: Schema.String,
    expires_at: Schema.Number,
  }),
)

const AuthTokenResponse = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
  }),
)

const invalidRequest = (message: string) => new AIError({ reason: new InvalidRequestError({ message }) })

const post = <A>(
  route: string,
  url: string,
  apiKey: Redacted.Redacted,
  body: Record<string, unknown> | FormData,
  response: Schema.Codec<A, string>,
  options: { readonly authHeader?: string; readonly headers?: Readonly<Record<string, string>> } = {},
) =>
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const res = yield* executor.execute(
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeaders(options.headers ?? {}),
        options.authHeader
          ? HttpClientRequest.setHeader(options.authHeader, Redacted.value(apiKey))
          : HttpClientRequest.bearerToken(apiKey),
        body instanceof FormData
          ? HttpClientRequest.bodyFormData(body)
          : HttpClientRequest.bodyText(encodeJson(body), "application/json"),
      ),
    )
    const http = RequestExecutor.responseHttp(res)
    const fail = (message: string, cause?: unknown, raw?: string) =>
      new AIError({ reason: new InvalidProviderOutputError({ route, message, body: raw, http, cause }) })
    const text = yield* res.text.pipe(Effect.mapError((cause) => fail(`Failed to read ${route} response`, cause)))
    return yield* Schema.decodeEffect(response)(text).pipe(
      Effect.mapError((cause) => fail(`${route} returned an invalid response`, cause, text)),
    )
  })

const clientSecret = (
  route: string,
  baseURL: string,
  model: string,
  apiKey: Redacted.Redacted,
  body: Record<string, unknown>,
) =>
  post(route, `${baseURL}/realtime/client_secrets`, apiKey, body, ClientSecretResponse).pipe(
    Effect.map(
      (data): RealtimeTransport => ({
        type: "websocket",
        url: `${baseURL.replace(/^http/, "ws")}/realtime?model=${encodeURIComponent(model)}`,
        token: data.value,
        expiresAt: data.expires_at,
      }),
    ),
  )
