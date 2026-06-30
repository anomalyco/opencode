import { Effect, Option, Ref, Scope, Semaphore, Stream, SynchronizedRef } from "effect"
import type { Headers } from "effect/unstable/http"
import * as CassetteService from "./cassette.js"
import { canonicalizeJson, decodeJson, safeText } from "./matching.js"
import { makeReplayState, resolveAutoMode } from "./recorder.js"
import type { RecordReplayMode } from "./internal-effect.js"
import { make, type Redactor } from "./redactor.js"
import { webSocketInteractions, type CassetteMetadata, type WebSocketEvent } from "./schema.js"

export interface WebSocketRequest {
  readonly url: string
  readonly headers: Headers.Headers
}

export interface WebSocketConnection<E> {
  readonly sendText: (message: string) => Effect.Effect<void, E>
  readonly messages: Stream.Stream<string | Uint8Array, E>
  readonly close: Effect.Effect<void>
}

export interface WebSocketExecutor<E> {
  readonly open: (request: WebSocketRequest) => Effect.Effect<WebSocketConnection<E>, E>
}

export interface WebSocketRecordReplayOptions<E> {
  readonly name: string
  readonly mode?: RecordReplayMode
  readonly metadata?: CassetteMetadata
  readonly cassette: CassetteService.Interface
  readonly live: WebSocketExecutor<E>
  readonly redactor?: Redactor
  readonly compareClientMessagesAsJson?: boolean
}

const headersRecord = (headers: Headers.Headers): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )

const textEvent = (direction: "client" | "server", body: string): WebSocketEvent => ({
  direction,
  kind: "text",
  body,
})

const decodeEvent = (event: WebSocketEvent) =>
  event.kind === "text" ? event.body : new Uint8Array(Buffer.from(event.body, "base64"))

const jsonOrText = (value: string) => Option.match(decodeJson(value), { onNone: () => value, onSome: canonicalizeJson })

const assertClientEvent = (actual: string, expected: WebSocketEvent | undefined, index: number, asJson: boolean) =>
  Effect.sync(() => {
    const matches =
      expected?.direction === "client" &&
      expected.kind === "text" &&
      JSON.stringify(asJson ? jsonOrText(actual) : actual) ===
        JSON.stringify(asJson ? jsonOrText(expected.body) : expected.body)
    if (matches) return
    throw new Error(`WebSocket client frame ${index + 1}: expected ${safeText(expected)}, received ${safeText(actual)}`)
  })

export const makeWebSocketExecutor = <E>(
  options: WebSocketRecordReplayOptions<E>,
): Effect.Effect<WebSocketExecutor<E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const mode = options.mode ?? (yield* resolveAutoMode(options.cassette, options.name))
    const redactor = options.redactor ?? make()
    const openSnapshot = (request: WebSocketRequest) => {
      const snapshot = redactor.request({
        method: "GET",
        url: request.url,
        headers: headersRecord(request.headers),
        body: "",
      })
      return { url: snapshot.url, headers: snapshot.headers }
    }
    const redactEvent = (event: WebSocketEvent) => {
      if (event.kind === "binary") return event
      const body =
        event.direction === "client"
          ? redactor.request({ method: "WEBSOCKET", url: "", headers: {}, body: event.body }).body
          : redactor.response({ status: 101, headers: {}, body: event.body }).body
      return { ...event, body }
    }

    if (mode === "passthrough") return options.live

    if (mode === "record") {
      return {
        open: (request) =>
          Effect.gen(function* () {
            const events: WebSocketEvent[] = []
            const connection = yield* options.live.open(request)
            const closed = yield* Ref.make(false)
            const closeLock = yield* Semaphore.make(1)
            return {
              sendText: (message) =>
                Effect.sync(() => events.push(redactEvent(textEvent("client", message)))).pipe(
                  Effect.andThen(connection.sendText(message)),
                ),
              messages: connection.messages.pipe(
                Stream.tap((message) =>
                  Effect.sync(() =>
                    events.push(
                      typeof message === "string"
                        ? redactEvent(textEvent("server", message))
                        : {
                            direction: "server",
                            kind: "binary",
                            body: Buffer.from(message).toString("base64"),
                            bodyEncoding: "base64",
                          },
                    ),
                  ),
                ),
              ),
              close: closeLock.withPermit(
                Effect.gen(function* () {
                  if (yield* Ref.get(closed)) return
                  yield* connection.close
                  yield* options.cassette
                    .append(
                      options.name,
                      { transport: "websocket", open: openSnapshot(request), events },
                      options.metadata,
                    )
                    .pipe(Effect.orDie)
                  yield* Ref.set(closed, true)
                }),
              ),
            }
          }),
      }
    }

    const replay = yield* makeReplayState(options.cassette, options.name, webSocketInteractions)
    return {
      open: (request) =>
        Effect.gen(function* () {
          const claimed = yield* replay
            .claim((interaction, index) =>
              Effect.sync(() => {
                const incoming = canonicalizeJson(openSnapshot(request))
                if (interaction && JSON.stringify(incoming) === JSON.stringify(canonicalizeJson(interaction.open)))
                  return
                throw new Error(`WebSocket open ${index + 1} does not match ${safeText(incoming)}`)
              }),
            )
            .pipe(Effect.orDie)
          const client = claimed.interaction.events.filter((event) => event.direction === "client")
          const server = claimed.interaction.events.filter((event) => event.direction === "server")
          const position = yield* SynchronizedRef.make(0)
          return {
            sendText: (message) =>
              SynchronizedRef.updateEffect(position, (index) =>
                assertClientEvent(message, client[index], index, options.compareClientMessagesAsJson === true).pipe(
                  Effect.as(index + 1),
                ),
              ),
            messages: Stream.fromIterable(server).pipe(Stream.map(decodeEvent)),
            close: Effect.gen(function* () {
              const used = yield* SynchronizedRef.get(position)
              if (used !== client.length)
                return yield* Effect.die(
                  new Error(`WebSocket client frame count: expected ${client.length}, received ${used}`),
                )
            }),
          }
        }),
    }
  })
