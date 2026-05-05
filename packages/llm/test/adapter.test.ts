import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { Endpoint, LLM, Protocol } from "../src"
import { Adapter, LLMClient } from "../src/adapter"
import { Patch } from "../src/patch"
import type { FramingDef } from "../src"
import type { ModelRef } from "../src/schema"
import { testEffect } from "./lib/effect"
import { dynamicResponse } from "./lib/http"

const updateModel = (model: ModelRef, patch: Partial<LLM.ModelInput>) =>
  LLM.model({
    id: model.id,
    provider: model.provider,
    adapter: model.adapter,
    protocol: model.protocol,
    baseURL: model.baseURL,
    headers: model.headers,
    capabilities: model.capabilities,
    limits: model.limits,
    native: model.native,
    ...patch,
  })

const Json = Schema.fromJsonString(Schema.Unknown)
const encodeJson = Schema.encodeSync(Json)

type FakePayload = {
  readonly body: string
  readonly includeUsage?: boolean
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
    includeUsage: Schema.optional(Schema.Boolean),
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
  it.effect("prepare applies payload patches", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({
        adapters: [
          fake.withPatches([
            fake.patch("include-usage", {
              reason: "fake payload patch",
              apply: (payload) => ({ ...payload, includeUsage: true }),
            }),
          ]),
        ],
      }).prepare(request)

      expect(prepared.payload).toEqual({ body: "hello", includeUsage: true })
    }),
  )

  it.effect("stream and generate use the adapter pipeline", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({ adapters: [fake] })
      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))
      const response = yield* llm.generate(request)

      expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
      expect(response.events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
    }),
  )

  it.effect("selects adapters by request adapter", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: [fake, gemini] }).prepare(
        LLM.updateRequest(request, { model: updateModel(request.model, { adapter: "gemini-fake" }) }),
      )

      expect(prepared.adapter).toBe("gemini-fake")
    }),
  )

  it.effect("falls back to adapter bound to model", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: [] }).prepare(
        LLM.updateRequest(request, {
          model: Adapter.bindModel(updateModel(request.model, { adapter: "gemini-fake" }), gemini),
        }),
      )

      expect(prepared.adapter).toBe("gemini-fake")
    }),
  )

  it.effect("explicit adapters override provider adapters", () =>
    Effect.gen(function* () {
      const override = Adapter.make({
        id: "fake",
        protocol: Protocol.define({
          ...fakeProtocol,
          toPayload: () => Effect.succeed({ body: "override" }),
        }),
        endpoint: Endpoint.baseURL({ default: "https://fake.local", path: "/chat" }),
        framing: fakeFraming,
      })

      const response = yield* LLM.make({ providers: [{ adapters: [fake] }], adapters: [override] }).generate(request)

      expect(response.text).toBe('echo:{"body":"override"}')
    }),
  )

  it.effect("stream patches transform raised events", () =>
    Effect.gen(function* () {
      const llm = LLMClient.make({
        adapters: [fake],
        patches: [
          Patch.stream("test.uppercase", {
            reason: "uppercase text deltas",
            apply: (event) => (event.type === "text-delta" ? { ...event, text: event.text.toUpperCase() } : event),
          }),
        ],
      })

      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))

      expect(events[0]).toEqual({ type: "text-delta", text: 'ECHO:{"BODY":"HELLO"}' })
    }),
  )

  it.effect("rejects missing adapter", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.make({ adapters: [fake] })
        .prepare(
          LLM.updateRequest(request, { model: updateModel(request.model, { adapter: "missing" }) }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("No LLM adapter")
    }),
  )
})
