import { expect } from "bun:test"
import {
  Cassette,
  redactHeaders,
  redactUrl,
  isWebSocketInteraction,
  type WebSocketFrame,
  type WebSocketInteraction,
} from "@opencode-ai/http-recorder"
import { Effect, Layer, Stream } from "effect"
import type { Headers } from "effect/unstable/http"
import { WebSocketExecutor } from "../src/route"
import type { Service as WebSocketExecutorService, WebSocketRequest } from "../src/route/transport/websocket"

const liveWebSocket = WebSocketExecutor.open
const WEBSOCKET_REQUEST_HEADERS = ["content-type", "accept", "openai-beta"]

const headersRecord = (headers: Headers.Headers) =>
  Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .toSorted(([a], [b]) => a.localeCompare(b)),
  )

const openSnapshot = (request: WebSocketRequest) => {
  const headers = headersRecord(request.headers)
  return {
    url: redactUrl(request.url),
    headers: redactHeaders(headers, WEBSOCKET_REQUEST_HEADERS),
  }
}

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

const unsafeCassette = (
  cassette: string,
  findings: ReadonlyArray<{ readonly path: string; readonly reason: string }>,
) =>
  new Error(
    `Refusing to write WebSocket cassette "${cassette}" because it contains possible secrets: ${findings
      .map((item) => `${item.path} (${item.reason})`)
      .join(", ")}`,
  )

export const webSocketCassetteLayer = (
  cassette: string,
  input: { readonly metadata?: Record<string, unknown>; readonly recording: boolean },
): Layer.Layer<WebSocketExecutorService, never, Cassette.Service> =>
  input.recording ? recordingLayer(cassette, input.metadata) : replayLayer(cassette)

const replayLayer = (cassette: string): Layer.Layer<WebSocketExecutorService, never, Cassette.Service> => {
  let input: { readonly interactions: ReadonlyArray<WebSocketInteraction> } | undefined
  let interactionIndex = 0
  return Layer.effect(
    WebSocketExecutor.Service,
    Effect.gen(function* () {
      const cassetteService = yield* Cassette.Service
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (!input) return
          expect(interactionIndex, `Unused recorded WebSocket interactions in ${cassette}`).toBe(
            input.interactions.length,
          )
        }),
      )
      return WebSocketExecutor.Service.of({
        open: (request) =>
          Effect.gen(function* () {
            input = input ?? {
              interactions: (yield* cassetteService.read(cassette).pipe(Effect.orDie)).interactions.filter(
                isWebSocketInteraction,
              ),
            }
            const interaction = input.interactions[interactionIndex]
            interactionIndex++
            if (!interaction) throw new Error(`No recorded WebSocket interaction for ${request.url}`)
            expect(openSnapshot(request)).toEqual(interaction.open)
            let index = 0
            return {
              sendText: (message: string) =>
                Effect.sync(() => {
                  expect(JSON.parse(message)).toEqual(
                    JSON.parse(frameText(interaction.client[index] ?? textFrame("null"))),
                  )
                  index++
                }),
              messages: Stream.fromIterable(interaction.server).pipe(Stream.map(frameMessage)),
              close: Effect.sync(() => {
                expect(index).toBe(interaction.client.length)
              }),
            }
          }),
      })
    }),
  )
}

const recordingLayer = (
  cassette: string,
  metadata: Record<string, unknown> | undefined,
): Layer.Layer<WebSocketExecutorService, never, Cassette.Service> => {
  const webSocket = Layer.effect(
    WebSocketExecutor.Service,
    Effect.gen(function* () {
      const cassetteService = yield* Cassette.Service
      return WebSocketExecutor.Service.of({
        open: (request) =>
          Effect.gen(function* () {
            const client: WebSocketFrame[] = []
            const server: WebSocketFrame[] = []
            const connection = yield* liveWebSocket(request)
            const decoder = new TextDecoder()
            return {
              sendText: (message: string) =>
                connection.sendText(message).pipe(Effect.tap(() => Effect.sync(() => client.push(textFrame(message))))),
              messages: connection.messages.pipe(
                Stream.map((message) => {
                  const text = WebSocketExecutor.messageText(message, decoder)
                  server.push(receivedFrame(message))
                  return text
                }),
              ),
              close: connection.close.pipe(
                Effect.andThen(
                  Effect.gen(function* () {
                    const result = yield* cassetteService
                      .append(
                        cassette,
                        { transport: "websocket", open: openSnapshot(request), client, server },
                        metadata,
                      )
                      .pipe(Effect.orDie)
                    if (result.findings.length > 0) return yield* Effect.die(unsafeCassette(cassette, result.findings))
                    return yield* Effect.void
                  }),
                ),
              ),
            }
          }),
      })
    }),
  )
  return webSocket
}
