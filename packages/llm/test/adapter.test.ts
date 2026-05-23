import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM } from "../src"
import { Route, Endpoint, LLMClient, Protocol, type FramingDef } from "../src/route"
import { Model } from "../src/schema"
import { testEffect } from "./lib/effect"
import { dynamicResponse } from "./lib/http"

const updateModel = (model: Model, patch: Partial<Model.Input>) => Model.update(model, patch)

const Json = Schema.fromJsonString(Schema.Unknown)
const encodeJson = Schema.encodeSync(Json)

type FakeBody = {
  readonly body: string
}

const FakeEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("finish"), reason: Schema.Literal("stop") }),
])
type FakeEvent = Schema.Schema.Type<typeof FakeEvent>
const decodeFakeEvents = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(FakeEvent)))

const fakeFraming: FramingDef<FakeEvent> = {
  id: "fake-json-array",
  frame: (bytes) =>
    Stream.fromEffect(
      bytes.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (text, event) => text + event,
        ),
        Effect.flatMap(decodeFakeEvents),
        Effect.orDie,
      ),
    ).pipe(Stream.flatMap(Stream.fromIterable)),
}

const raiseEvent = (event: FakeEvent): import("../src/schema").LLMEvent =>
  event.type === "finish"
    ? { type: "finish", reason: event.reason }
    : { type: "text-delta", id: "text-0", text: event.text }

const fakeProtocol = Protocol.make<FakeBody, FakeEvent, FakeEvent, void>({
  id: "fake",
  body: {
    schema: Schema.Struct({
      body: Schema.String,
    }),
    from: (request) =>
      Effect.succeed({
        body: [
          ...request.messages
            .flatMap((message) => message.content)
            .filter((part) => part.type === "text")
            .map((part) => part.text),
          ...request.tools.map((tool) => `tool:${tool.name}:${tool.description}`),
        ].join("\n"),
      }),
  },
  stream: {
    event: FakeEvent,
    initial: () => undefined,
    step: (state, event) => Effect.succeed([state, [raiseEvent(event)]] as const),
  },
})

const fake = Route.make({
  id: "fake",
  protocol: fakeProtocol,
  endpoint: Endpoint.path("/chat"),
  framing: fakeFraming,
})
const configuredFake = fake.with({ endpoint: { baseURL: "https://fake.local" } })

const gemini = Route.make({
  id: "gemini-fake",
  protocol: fakeProtocol,
  endpoint: Endpoint.path("/chat"),
  framing: fakeFraming,
})
const configuredGemini = gemini.with({ endpoint: { baseURL: "https://fake.local" } })

const request = LLM.request({
  id: "req_1",
  model: Model.make({
    id: "fake-model",
    provider: "fake-provider",
    route: configuredFake,
  }),
  prompt: "hello",
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

describe("llm route", () => {
  it.effect("stream and generate use the route pipeline", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))
      const response = yield* llm.generate(request)

      expect(events.map((event) => event.type)).toEqual(["text-delta", "finish"])
      expect(response.events.map((event) => event.type)).toEqual(["text-delta", "finish"])
    }),
  )

  it.effect("selects routes by model route value", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const prepared = yield* llm.prepare(
        LLM.updateRequest(request, { model: updateModel(request.model, { route: configuredGemini }) }),
      )

      expect(prepared.route).toBe("gemini-fake")
    }),
  )

  it.effect("builds models from configured routes", () =>
    Effect.gen(function* () {
      const configured = fake.with({ provider: "fake-provider", endpoint: { baseURL: "https://fake.local" } })

      expect(configured.model({ id: "fake-model" })).toMatchObject({
        provider: "fake-provider",
      })
    }),
  )

  it.effect("does not register duplicate route ids globally", () =>
    Effect.gen(function* () {
      const duplicate = Route.make({
        id: "fake",
        protocol: Protocol.make({
          ...fakeProtocol,
          body: {
            ...fakeProtocol.body,
            from: () => Effect.succeed({ body: "late-default" }),
          },
        }),
        endpoint: Endpoint.path("/chat", { baseURL: "https://fake.local" }),
        framing: fakeFraming,
      })

      const prepared = yield* (yield* LLMClient.Service).prepare(
        LLM.updateRequest(request, { model: updateModel(request.model, { route: duplicate }) }),
      )

      expect(prepared.body).toEqual({ body: "late-default" })
    }),
  )
})
