import { Effect, Schema, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { Framing } from "../route/framing.js"
import {
  HttpTransport,
  WebSocketTransport,
  type Transport,
  type WebSocketChannelDriver,
  type WebSocketChannelExchange,
} from "../route/transport/index.js"
import * as ProviderShared from "./shared.js"
import { OpenResponses } from "./open-responses.js"

const WebSocketResponseCreate = Schema.StructWithRest(Schema.Struct({ type: Schema.tag("response.create") }), [
  Schema.Record(Schema.String, Schema.Unknown),
])
const decodeMessage = ProviderShared.validateWith(Schema.decodeUnknownEffect(WebSocketResponseCreate))
const encodeMessage = Schema.encodeSync(Schema.fromJsonString(WebSocketResponseCreate))
const decodeEvent = Schema.decodeUnknownEffect(OpenResponses.protocol.stream.event)

export interface Options {
  readonly id: string
  readonly name: string
  readonly rotateAfterMs?: number
  readonly headers?: (headers: Headers.Headers) => Headers.Headers
}

export interface Prepared {
  readonly http: HttpTransport.HttpPrepared<string>
  readonly channel?: {
    readonly url: string
    readonly headers: Headers.Headers
    readonly rotateAfterMs?: number
    readonly driver: WebSocketChannelDriver
  }
}

const message = (body: unknown) =>
  Effect.gen(function* () {
    if (!ProviderShared.isRecord(body))
      return yield* ProviderShared.invalidRequest("Open Responses WebSocket body must be a JSON object")
    const { stream: _stream, stream_options: _streamOptions, background: _background, ...request } = body
    return encodeMessage(yield* decodeMessage({ ...request, type: "response.create" }))
  })

const driver = (options: Options, body: string): WebSocketChannelDriver => {
  let responseID: string | undefined
  let terminal = false
  return {
    create: () =>
      Effect.sync(() => {
        responseID = undefined
        terminal = false
        return { message: body, mode: "full" }
      }),
    observe: (_create, frame) =>
      Effect.gen(function* () {
        const event = yield* decodeEvent(frame).pipe(
          Effect.mapError(() =>
            ProviderShared.eventError(options.id, `Invalid ${options.name} WebSocket event`, frame),
          ),
        )
        if (terminal)
          return yield* ProviderShared.eventError(
            options.id,
            `${options.name} emitted ${event.type} after a terminal event`,
            frame,
          )
        if (event.type === "error") {
          terminal = true
          yield* OpenResponses.decodeKnownErrorEvent(event).pipe(
            Effect.mapError(() =>
              ProviderShared.eventError(options.id, `${options.name} returned a malformed error event`, frame),
            ),
          )
          return {
            type: "provider-failure",
            error: OpenResponses.providerFailure(options.id, event, `${options.name} stream error`),
          }
        }
        if (event.type === "response.failed") {
          terminal = true
          if (responseID && event.response?.id && event.response.id !== responseID)
            return yield* ProviderShared.eventError(
              options.id,
              `${options.name} response ID changed during execution`,
              frame,
            )
          return {
            type: "provider-failure",
            error: OpenResponses.providerFailure(options.id, event, `${options.name} response failed`),
          }
        }
        if (event.type === "response.created") {
          const created = event.response?.id
          if (responseID)
            return yield* ProviderShared.eventError(
              options.id,
              `${options.name} emitted duplicate response.created`,
              frame,
            )
          if (!created)
            return yield* ProviderShared.eventError(
              options.id,
              `${options.name} response.created is missing response.id`,
              frame,
            )
          responseID = created
          return { type: "frame", frame }
        }
        if (!responseID)
          return yield* ProviderShared.eventError(
            options.id,
            `${options.name} emitted ${event.type} before response.created`,
            frame,
          )
        if (event.response?.id && event.response.id !== responseID)
          return yield* ProviderShared.eventError(
            options.id,
            `${options.name} response ID changed during execution`,
            frame,
          )
        if (event.type === "response.completed") {
          terminal = true
          return { type: "completed", frame }
        }
        if (event.type === "response.incomplete") {
          terminal = true
          return { type: "incomplete", frame }
        }
        return { type: "frame", frame }
      }),
  }
}

export const transport = <Body>(options: Options): Transport<Body, Prepared, string> => {
  const http = HttpTransport.sseJson.with<Body>()
  return {
    id: http.id,
    prepare: (input) =>
      Effect.gen(function* () {
        const parts = yield* HttpTransport.jsonRequestParts(input)
        const headers = Headers.remove(options.headers?.(parts.headers) ?? parts.headers, "content-length")
        return {
          http: {
            request: ProviderShared.jsonPost({ url: parts.url, body: parts.bodyText, headers: parts.headers }),
            framing: Framing.sse,
            middleware: input.middleware,
          },
          channel: input.webSocket
            ? {
                url: yield* WebSocketTransport.toWebSocketUrl(parts.url),
                headers,
                rotateAfterMs: options.rotateAfterMs,
                driver: driver(options, yield* message(parts.jsonBody)),
              }
            : undefined,
        }
      }),
    execute: (prepared, request, runtime, executeOptions) => {
      if (!executeOptions?.webSocket || !prepared.channel) return http.execute(prepared.http, request, runtime)
      const exchange: WebSocketChannelExchange = {
        id: request.id ?? "request",
        connect: {
          url: prepared.channel.url,
          headers: prepared.channel.headers,
          rotateAfterMs: prepared.channel.rotateAfterMs,
        },
        fallback: () =>
          Stream.unwrap(
            http.execute(prepared.http, request, runtime).pipe(Effect.map((execution) => execution.frames)),
          ),
        driver: prepared.channel.driver,
      }
      return executeOptions.webSocket.execute(exchange)
    },
  }
}

export const OpenResponsesChannel = { transport } as const
