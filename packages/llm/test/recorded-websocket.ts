import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "../src/route"
import type { Service as LLMClientService } from "../src/route/client"
import type { Service as RequestExecutorService } from "../src/route/executor"
import type { Service as WebSocketExecutorService } from "../src/route/transport/websocket"
import { recordedEffectGroup, type RecordedCaseOptions as RunnerCaseOptions, type RecordedGroupOptions } from "./recorded-runner"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings-websocket")

type RecordedWebSocketEnv = RequestExecutorService | WebSocketExecutorService | LLMClientService

type Cassette = {
  readonly schemaVersion: 1
  readonly recordedAt: string
  readonly metadata?: Record<string, unknown>
  readonly interactions: ReadonlyArray<{
    readonly url: string
    readonly sent: ReadonlyArray<string>
    readonly received: ReadonlyArray<string>
  }>
}

const cassettePath = (cassette: string) => path.join(FIXTURES_DIR, `${cassette}.json`)

const readCassette = async (cassette: string): Promise<Cassette> => Bun.file(cassettePath(cassette)).json()

const writeCassette = (cassette: string, value: Cassette) =>
  Effect.promise(async () => {
    await fs.promises.mkdir(path.dirname(cassettePath(cassette)), { recursive: true })
    await Bun.write(cassettePath(cassette), `${JSON.stringify(value, null, 2)}\n`)
  })

const liveWebSocket = WebSocketExecutor.open

const http = Layer.succeed(RequestExecutor.Service, RequestExecutor.Service.of({
  execute: () => Effect.die("unexpected HTTP request in WebSocket recording"),
}))

const layerFromCassette = (cassette: string, input: Cassette): Layer.Layer<RecordedWebSocketEnv> => {
  let interactionIndex = 0
  const webSocket = Layer.effect(
    WebSocketExecutor.Service,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => {
        expect(interactionIndex, `Unused recorded WebSocket interactions in ${cassette}`).toBe(input.interactions.length)
      }))
      return WebSocketExecutor.Service.of({
        open: (request) =>
          Effect.sync(() => {
            const interaction = input.interactions[interactionIndex]
            interactionIndex++
            if (!interaction) throw new Error(`No recorded WebSocket interaction for ${request.url}`)
            expect(request.url).toBe(interaction.url)
            let index = 0
            return {
              sendText: (message: string) =>
                Effect.sync(() => {
                  expect(JSON.parse(message)).toEqual(JSON.parse(interaction.sent[index] ?? "null"))
                  index++
                }),
              messages: Stream.fromArray(interaction.received),
              close: Effect.sync(() => {
                expect(index).toBe(interaction.sent.length)
              }),
            }
          }),
      })
    }),
  )
  const deps = Layer.mergeAll(http, webSocket)
  return Layer.mergeAll(deps, LLMClient.layerWithWebSocket.pipe(Layer.provide(deps)))
}

const recordingLayer = (cassette: string, metadata: Record<string, unknown> | undefined): Layer.Layer<RecordedWebSocketEnv> => {
  const webSocket = Layer.effect(
    WebSocketExecutor.Service,
    Effect.gen(function* () {
      const interactions: Cassette["interactions"][number][] = []
      let dirty = false
      yield* Effect.addFinalizer(() =>
        dirty
          ? writeCassette(cassette, {
            schemaVersion: 1,
            recordedAt: new Date().toISOString(),
            metadata,
            interactions,
          })
          : Effect.void,
      )
      return WebSocketExecutor.Service.of({
        open: (request) =>
          Effect.gen(function* () {
            const sent: string[] = []
            const received: string[] = []
            const connection = yield* liveWebSocket(request)
            const decoder = new TextDecoder()
            return {
              sendText: (message: string) => connection.sendText(message).pipe(Effect.tap(() => Effect.sync(() => sent.push(message)))),
              messages: connection.messages.pipe(Stream.map((message) => {
                const text = WebSocketExecutor.messageText(message, decoder)
                received.push(text)
                return text
              })),
              close: connection.close.pipe(
                Effect.tap(() => Effect.sync(() => {
                  interactions.push({ url: request.url, sent, received })
                  dirty = true
                })),
              ),
            }
          }),
      })
    }),
  )
  const deps = Layer.mergeAll(http, webSocket)
  return Layer.mergeAll(deps, LLMClient.layerWithWebSocket.pipe(Layer.provide(deps)))
}

const replayLayer = (cassette: string) =>
  Layer.unwrap(Effect.promise(() => readCassette(cassette)).pipe(Effect.map((input) => layerFromCassette(cassette, input))))

type RecordedWebSocketTestsOptions = RecordedGroupOptions & {
  readonly metadata?: Record<string, unknown>
}

type RecordedWebSocketCaseOptions = RunnerCaseOptions & {
  readonly metadata?: Record<string, unknown>
}

export const recordedWebSocketTests = (options: RecordedWebSocketTestsOptions) =>
  recordedEffectGroup<RecordedWebSocketEnv, never, RecordedWebSocketTestsOptions, RecordedWebSocketCaseOptions>({
    duplicateLabel: "recorded WebSocket cassette",
    options,
    cassetteExists: (cassette) => fs.existsSync(cassettePath(cassette)),
    layer: ({ cassette, metadata, recording }) =>
      recording
        ? recordingLayer(cassette, metadata)
        : replayLayer(cassette),
  })
