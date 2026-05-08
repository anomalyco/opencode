import { Effect, Option, Ref, Scope, Stream } from "effect"
import type { Headers } from "effect/unstable/http"
import * as CassetteService from "./cassette"
import { canonicalizeJson, decodeJson } from "./matching"
import { redactHeaders, redactUrl, type SecretFinding } from "./redaction"
import { webSocketInteractions, type CassetteMetadata, type WebSocketFrame, type WebSocketInteraction } from "./schema"

export const DEFAULT_WEBSOCKET_REQUEST_HEADERS: ReadonlyArray<string> = ["content-type", "accept", "openai-beta"]

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
  readonly mode?: "record" | "replay" | "passthrough"
  readonly metadata?: CassetteMetadata
  readonly cassette: CassetteService.Interface
  readonly live: WebSocketExecutor<E>
  readonly redact?: {
    readonly headers?: ReadonlyArray<string>
    readonly query?: ReadonlyArray<string>
    readonly url?: (url: string) => string
  }
  readonly requestHeaders?: ReadonlyArray<string>
  readonly compareClientMessagesAsJson?: boolean
}

const headersRecord = (headers: Headers.Headers) =>
  Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .toSorted(([a], [b]) => a.localeCompare(b)),
  )

const openSnapshot = (
  request: WebSocketRequest,
  options: Pick<WebSocketRecordReplayOptions<never>, "redact" | "requestHeaders"> = {},
) => ({
  url: redactUrl(request.url, options.redact?.query, options.redact?.url),
  headers: redactHeaders(
    headersRecord(request.headers),
    options.requestHeaders ?? DEFAULT_WEBSOCKET_REQUEST_HEADERS,
    options.redact?.headers,
  ),
})

const textFrame = (body: string): WebSocketFrame => ({ kind: "text", body })

const frameText = (frame: WebSocketFrame) => {
  if (frame.kind === "text") return frame.body
  return new TextDecoder().decode(Buffer.from(frame.body, "base64"))
}

const frameMessage = (frame: WebSocketFrame) =>
  frame.kind === "text" ? frame.body : new Uint8Array(Buffer.from(frame.body, "base64"))

const receivedFrame = (message: string | Uint8Array): WebSocketFrame =>
  typeof message === "string"
    ? textFrame(message)
    : { kind: "binary", body: Buffer.from(message).toString("base64"), bodyEncoding: "base64" }

const unsafeCassette = (name: string, findings: ReadonlyArray<SecretFinding>) =>
  new Error(
    `Refusing to write WebSocket cassette "${name}" because it contains possible secrets: ${findings
      .map((item) => `${item.path} (${item.reason})`)
      .join(", ")}`,
  )

const mismatch = (message: string, actual: unknown, expected: unknown) =>
  new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)

const assertEqual = (message: string, actual: unknown, expected: unknown) =>
  Effect.sync(() => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) return
    throw mismatch(message, actual, expected)
  })

const jsonOrText = (value: string) => Option.match(decodeJson(value), { onNone: () => value, onSome: canonicalizeJson })

const compareClientMessage = (actual: string, expected: WebSocketFrame | undefined, index: number, asJson: boolean) => {
  if (!expected)
    return Effect.sync(() => {
      throw new Error(`Unexpected WebSocket client frame ${index + 1}: ${actual}`)
    })
  const expectedText = frameText(expected)
  if (!asJson) return assertEqual(`WebSocket client frame ${index + 1}`, actual, expectedText)
  return assertEqual(`WebSocket client JSON frame ${index + 1}`, jsonOrText(actual), jsonOrText(expectedText))
}

export const makeWebSocketExecutor = <E>(
  options: WebSocketRecordReplayOptions<E>,
): Effect.Effect<WebSocketExecutor<E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const mode = options.mode ?? "replay"

    if (mode === "passthrough") return options.live

    if (mode === "record") {
      return {
        open: (request) =>
          Effect.gen(function* () {
            const client: WebSocketFrame[] = []
            const server: WebSocketFrame[] = []
            const connection = yield* options.live.open(request)
            const closed = yield* Ref.make(false)
            const closeOnce = Effect.gen(function* () {
              if (yield* Ref.getAndSet(closed, true)) return
              yield* connection.close
              const result = yield* options.cassette
                .append(
                  options.name,
                  { transport: "websocket", open: openSnapshot(request, options), client, server },
                  options.metadata,
                )
                .pipe(Effect.orDie)
              if (result.findings.length > 0) yield* Effect.die(unsafeCassette(options.name, result.findings))
            })
            return {
              sendText: (message: string) =>
                connection.sendText(message).pipe(Effect.tap(() => Effect.sync(() => client.push(textFrame(message))))),
              messages: connection.messages.pipe(
                Stream.map((message) => {
                  server.push(receivedFrame(message))
                  return message
                }),
              ),
              close: closeOnce,
            }
          }),
      }
    }

    const replay = yield* Ref.make<{ readonly interactions: ReadonlyArray<WebSocketInteraction> } | undefined>(
      undefined,
    )
    const cursor = yield* Ref.make(0)

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const input = yield* Ref.get(replay)
        if (!input) return
        yield* assertEqual(
          `Unused recorded WebSocket interactions in ${options.name}`,
          yield* Ref.get(cursor),
          input.interactions.length,
        )
      }),
    )

    const loadReplay = Effect.fn("WebSocketRecorder.loadReplay")(function* () {
      const cached = yield* Ref.get(replay)
      if (cached) return cached
      const input = {
        interactions: webSocketInteractions(yield* options.cassette.read(options.name).pipe(Effect.orDie)),
      }
      yield* Ref.set(replay, input)
      return input
    })

    return {
      open: (request) => {
        return Effect.gen(function* () {
          const input = yield* loadReplay()
          const index = yield* Ref.getAndUpdate(cursor, (value) => value + 1)
          const interaction = input.interactions[index]
          if (!interaction) return yield* Effect.die(new Error(`No recorded WebSocket interaction for ${request.url}`))
          yield* assertEqual(`WebSocket open frame ${index + 1}`, openSnapshot(request, options), interaction.open)
          const messageIndex = yield* Ref.make(0)
          return {
            sendText: (message: string) =>
              Effect.gen(function* () {
                const current = yield* Ref.getAndUpdate(messageIndex, (value) => value + 1)
                yield* compareClientMessage(
                  message,
                  interaction.client[current],
                  current,
                  options.compareClientMessagesAsJson === true,
                )
              }),
            messages: Stream.fromIterable(interaction.server).pipe(Stream.map(frameMessage)),
            close: Effect.gen(function* () {
              yield* assertEqual(
                `WebSocket client frame count for interaction ${index + 1}`,
                yield* Ref.get(messageIndex),
                interaction.client.length,
              )
            }),
          }
        })
      },
    }
  })
