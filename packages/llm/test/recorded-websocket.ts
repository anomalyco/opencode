import { expect, test, type TestOptions } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "../src/adapter"
import type { Service as LLMClientService } from "../src/adapter/client"
import type { Service as RequestExecutorService } from "../src/adapter/executor"
import type { Service as WebSocketExecutorService } from "../src/adapter/transport/websocket"
import { testEffect } from "./lib/effect"
import { cassetteName, classifiedTags, matchesSelected, missingEnv, unique } from "./recorded-utils"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings-websocket")

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)
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
  const interactions = input.interactions.map((interaction) => ({ ...interaction, sent: [...interaction.sent] }))
  const webSocket = Layer.succeed(WebSocketExecutor.Service, WebSocketExecutor.Service.of({
    open: (request) =>
      Effect.sync(() => {
        const interaction = interactions.shift()
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
  }))
  const deps = Layer.mergeAll(http, webSocket)
  return Layer.mergeAll(deps, LLMClient.layerWithWebSocket.pipe(Layer.provide(deps)))
}

const recordingLayer = (cassette: string, metadata: Record<string, unknown> | undefined): Layer.Layer<RecordedWebSocketEnv> => {
  const interactions: Cassette["interactions"][number][] = []
  const webSocket = Layer.succeed(WebSocketExecutor.Service, WebSocketExecutor.Service.of({
    open: (request) =>
      Effect.gen(function* () {
        const sent: string[] = []
        const received: string[] = []
        const connection = yield* liveWebSocket(request)
        return {
          sendText: (message: string) => connection.sendText(message).pipe(Effect.tap(() => Effect.sync(() => sent.push(message)))),
          messages: connection.messages.pipe(Stream.map((message) => {
            const text = typeof message === "string" ? message : new TextDecoder().decode(message)
            received.push(text)
            return text
          })),
          close: connection.close.pipe(
            Effect.tap(() => Effect.sync(() => interactions.push({ url: request.url, sent, received }))),
            Effect.tap(() => writeCassette(cassette, {
              schemaVersion: 1,
              recordedAt: new Date().toISOString(),
              metadata,
              interactions,
            })),
          ),
        }
      }),
  }))
  const deps = Layer.mergeAll(http, webSocket)
  return Layer.mergeAll(deps, LLMClient.layerWithWebSocket.pipe(Layer.provide(deps)))
}

const replayLayer = (cassette: string) =>
  Layer.unwrap(Effect.promise(() => readCassette(cassette)).pipe(Effect.map((input) => layerFromCassette(cassette, input))))

type RecordedWebSocketTestsOptions = {
  readonly prefix: string
  readonly provider?: string
  readonly protocol?: string
  readonly requires?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
}

type RecordedWebSocketCaseOptions = {
  readonly cassette?: string
  readonly id?: string
  readonly provider?: string
  readonly protocol?: string
  readonly requires?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
}

export const recordedWebSocketTests = (options: RecordedWebSocketTestsOptions) => {
  const cassettes = new Set<string>()

  const run = <A, E>(
    name: string,
    caseOptions: RecordedWebSocketCaseOptions,
    body: Body<A, E, RecordedWebSocketEnv>,
    testOptions?: number | TestOptions,
  ) => {
    const cassette = cassetteName(options.prefix, name, caseOptions)
    if (cassettes.has(cassette)) throw new Error(`Duplicate recorded WebSocket cassette "${cassette}"`)
    cassettes.add(cassette)
    const tags = unique([
      ...classifiedTags(options),
      ...classifiedTags({
        provider: caseOptions.provider,
        protocol: caseOptions.protocol,
        tags: caseOptions.tags,
      }),
    ])

    if (!matchesSelected({ prefix: options.prefix, name, cassette, tags })) return test.skip(name, () => {}, testOptions)

    if (process.env.RECORD === "true") {
      if (missingEnv([...(options.requires ?? []), ...(caseOptions.requires ?? [])]).length > 0) return test.skip(name, () => {}, testOptions)
      return testEffect(recordingLayer(cassette, {
        ...options.metadata,
        ...caseOptions.metadata,
        tags,
      })).live(name, body, testOptions)
    }
    if (!fs.existsSync(cassettePath(cassette))) return test.skip(name, () => {}, testOptions)
    return testEffect(replayLayer(cassette)).live(name, body, testOptions)
  }

  const effect = <A, E>(name: string, body: Body<A, E, RecordedWebSocketEnv>, testOptions?: number | TestOptions) =>
    run(name, {}, body, testOptions)

  effect.with = <A, E>(
    name: string,
    caseOptions: RecordedWebSocketCaseOptions,
    body: Body<A, E, RecordedWebSocketEnv>,
    testOptions?: number | TestOptions,
  ) => run(name, caseOptions, body, testOptions)

  return { effect }
}
