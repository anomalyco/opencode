import { Effect, Option, Ref, Scope, Semaphore, Stream, SynchronizedRef } from "effect"
import type { Headers } from "effect/unstable/http"
import * as CassetteService from "./cassette.js"
import { canonicalizeJson, decodeJson, safeText } from "./matching.js"
import { makeReplayState, resolveAutoMode } from "./recorder.js"
import type { RecordReplayMode } from "./internal-effect.js"
import { redactUrl } from "./redaction.js"
import { defaults, type Redactor } from "./redactor.js"
import { webSocketInteractions, type CassetteMetadata, type WebSocketFrame } from "./schema.js"

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

const encodeFrame = (message: string | Uint8Array): WebSocketFrame =>
  typeof message === "string"
    ? { kind: "text", body: message }
    : { kind: "binary", body: Buffer.from(message).toString("base64"), bodyEncoding: "base64" }

const decodeFrameMessage = (frame: WebSocketFrame): string | Uint8Array =>
  frame.kind === "text" ? frame.body : new Uint8Array(Buffer.from(frame.body, "base64"))

const decodeFrameText = (frame: WebSocketFrame) =>
  frame.kind === "text" ? frame.body : new TextDecoder().decode(Buffer.from(frame.body, "base64"))

const assertEqual = (message: string, actual: unknown, expected: unknown) =>
  Effect.sync(() => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) return
    throw new Error(`${message}: expected ${safeText(expected)}, received ${safeText(actual)}`)
  })

const jsonOrText = (value: string) => Option.match(decodeJson(value), { onNone: () => value, onSome: canonicalizeJson })

const compareClientMessage = (actual: string, expected: WebSocketFrame | undefined, index: number, asJson: boolean) => {
  if (!expected)
    return Effect.sync(() => {
      throw new Error(`Unexpected WebSocket client frame ${index + 1}: ${safeText(actual)}`)
    })
  const expectedText = decodeFrameText(expected)
  if (!asJson) return assertEqual(`WebSocket client frame ${index + 1}`, actual, expectedText)
  return assertEqual(`WebSocket client JSON frame ${index + 1}`, jsonOrText(actual), jsonOrText(expectedText))
}

export const makeWebSocketExecutor = <E>(
  options: WebSocketRecordReplayOptions<E>,
): Effect.Effect<WebSocketExecutor<E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const requested = options.mode ?? "auto"
    const mode = requested === "auto" ? yield* resolveAutoMode(options.cassette, options.name) : requested
    const redactor = options.redactor ?? defaults()
    const openSnapshot = (request: WebSocketRequest) => {
      const redacted = redactor.request({
        method: "GET",
        url: request.url,
        headers: headersRecord(request.headers),
        body: "",
      })
      return { url: redacted.url, headers: redacted.headers }
    }

    if (mode === "passthrough") return options.live

    if (mode === "record") {
      return {
        open: (request) =>
          Effect.gen(function* () {
            const client: WebSocketFrame[] = []
            const server: WebSocketFrame[] = []
            const connection = yield* options.live.open(request)
            const closed = yield* Ref.make(false)
            const closeLock = yield* Semaphore.make(1)
            const closeOnce = closeLock.withPermit(
              Effect.gen(function* () {
                if (yield* Ref.get(closed)) return
                yield* connection.close
                yield* options.cassette
                  .append(
                    options.name,
                    { transport: "websocket", open: openSnapshot(request), client, server },
                    options.metadata,
                  )
                  .pipe(Effect.orDie)
                yield* Ref.set(closed, true)
              }),
            )
            return {
              sendText: (message) =>
                connection
                  .sendText(message)
                  .pipe(Effect.tap(() => Effect.sync(() => client.push(encodeFrame(message))))),
              messages: connection.messages.pipe(
                Stream.tap((message) => Effect.sync(() => server.push(encodeFrame(message)))),
              ),
              close: closeOnce,
            }
          }),
      }
    }

    const replay = yield* makeReplayState(options.cassette, options.name, webSocketInteractions)

    return {
      open: (request) =>
        Effect.gen(function* () {
          const claimed = yield* replay
            .claim((interaction, index) => {
              if (!interaction)
                return Effect.die(new Error(`No recorded WebSocket interaction for ${redactUrl(request.url)}`))
              return assertEqual(`WebSocket open frame ${index + 1}`, openSnapshot(request), interaction.open)
            })
            .pipe(Effect.orDie)
          const interaction = claimed.interaction
          const index = claimed.index
          const messageIndex = yield* SynchronizedRef.make(0)
          return {
            sendText: (message) =>
              SynchronizedRef.updateEffect(messageIndex, (current) =>
                compareClientMessage(
                  message,
                  interaction.client[current],
                  current,
                  options.compareClientMessagesAsJson === true,
                ).pipe(Effect.as(current + 1)),
              ),
            messages: Stream.fromIterable(interaction.server).pipe(Stream.map(decodeFrameMessage)),
            close: Effect.gen(function* () {
              yield* assertEqual(
                `WebSocket client frame count for interaction ${index + 1}`,
                yield* SynchronizedRef.get(messageIndex),
                interaction.client.length,
              )
            }),
          }
        }),
    }
  })
