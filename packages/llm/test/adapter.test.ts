import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM } from "../src"
import { Adapter, Endpoint, LLMClient, Protocol, type AdapterModelInput, type FramingDef } from "../src/adapter"
import { ModelRef } from "../src/schema"
import { testEffect } from "./lib/effect"
import { dynamicResponse } from "./lib/http"

const updateModel = (model: ModelRef, patch: Partial<ModelRef.Input>) => ModelRef.update(model, patch)

const Json = Schema.fromJsonString(Schema.Unknown)
const encodeJson = Schema.encodeSync(Json)

type FakePayload = {
  readonly body: string
}

const FakeChunk = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("finish"), reason: Schema.Literal("stop") }),
])
type FakeChunk = Schema.Schema.Type<typeof FakeChunk>
const decodeFakeChunks = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(FakeChunk)))

const fakeFraming: FramingDef<FakeChunk> = {
  id: "fake-json-array",
  frame: (bytes) =>
    Stream.fromEffect(
      bytes.pipe(
        Stream.decodeText(),
        Stream.runFold(() => "", (text, chunk) => text + chunk),
        Effect.flatMap(decodeFakeChunks),
        Effect.orDie,
      ),
    ).pipe(Stream.flatMap(Stream.fromIterable)),
}

const request = LLM.request({
  id: "req_1",
  model: LLM.model({
    id: "fake-model",
    provider: "fake-provider",
    adapter: "fake",
    protocol: "fake",
  }),
  prompt: "hello",
})

const raiseChunk = (chunk: FakeChunk): import("../src/schema").LLMEvent =>
  chunk.type === "finish"
    ? { type: "request-finish", reason: chunk.reason }
    : { type: "text-delta", text: chunk.text }

const fakeProtocol = Protocol.define<FakePayload, FakeChunk, FakeChunk, void>({
  id: "fake",
  payload: Schema.Struct({
    body: Schema.String,
  }),
  chunk: FakeChunk,
  toPayload: (request) =>
    Effect.succeed({
      body: [
        ...request.messages
          .flatMap((message) => message.content)
          .filter((part) => part.type === "text")
          .map((part) => part.text),
        ...request.tools.map((tool) => `tool:${tool.name}:${tool.description}`),
      ].join("\n"),
    }),
  initial: () => undefined,
  process: (state, chunk) => Effect.succeed([state, [raiseChunk(chunk)]] as const),
})

const fake = Adapter.make({
  id: "fake",
  protocol: fakeProtocol,
  endpoint: Endpoint.baseURL({ default: "https://fake.local", path: "/chat" }),
  framing: fakeFraming,
})

const gemini = Adapter.make({
  id: "gemini-fake",
  protocol: fakeProtocol,
  endpoint: Endpoint.baseURL({ default: "https://fake.local", path: "/chat" }),
  framing: fakeFraming,
})

const echoLayer = dynamicResponse(({ text, respond }) =>
  Effect.succeed(
    respond(
      encodeJson([
        { type: "text", text: `echo:${text}` },
        { type: "finish", reason: "stop" },
      ]),
    ),
  ),
)

const it = testEffect(echoLayer)

describe("llm adapter", () => {
  it.effect("stream and generate use the adapter pipeline", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))
      const response = yield* llm.generate(request)

      expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
      expect(response.events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
    }),
  )

  it.effect("selects adapters by request adapter", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const prepared = yield* llm.prepare(
        LLM.updateRequest(request, { model: updateModel(request.model, { adapter: "gemini-fake" }) }),
      )

      expect(prepared.adapter).toBe("gemini-fake")
    }),
  )

  it.effect("uses registered adapters by model adapter id", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const prepared = yield* llm.prepare(
        LLM.updateRequest(request, { model: updateModel(request.model, { adapter: "gemini-fake" }) }),
      )

      expect(prepared.adapter).toBe("gemini-fake")
    }),
  )

  it.effect("maps model input before building refs", () =>
    Effect.gen(function* () {
      const mapped = Adapter.model<AdapterModelInput & { readonly region?: string }>(
        fake,
        { provider: "fake-provider" },
        {
          mapInput: (input) => {
            const { region, ...rest } = input
            return { ...rest, native: { region } }
          },
        },
      )

      expect(mapped({ id: "fake-model", region: "us-east-1" }).native).toEqual({ region: "us-east-1" })
    }),
  )

  it.effect("keeps the first registered adapter as the default", () =>
    Effect.gen(function* () {
      Adapter.make({
        id: "fake",
        protocol: Protocol.define({
          ...fakeProtocol,
          toPayload: () => Effect.succeed({ body: "late-default" }),
        }),
        endpoint: Endpoint.baseURL({ default: "https://fake.local", path: "/chat" }),
        framing: fakeFraming,
      })

      const llm = yield* LLMClient.Service
      const response = yield* llm.generate(request)

      expect(response.text).toBe('echo:{"body":"hello"}')
    }),
  )

  it.effect("rejects missing adapter", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const error = yield* llm
        .prepare(
          LLM.updateRequest(request, { model: updateModel(request.model, { adapter: "missing" }) }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("No LLM adapter")
    }),
  )
})
