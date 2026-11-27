import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { ai, LLMResponse } from "../src/effect.js"
import { Api } from "../src/api.js"
import { Provider } from "../src/provider.js"
import { Auth, LLMClient, Protocol, type Framing } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { LanguageModel } from "../src/schema/index.js"
import { testEffect } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

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

const fakeFraming: Framing.Definition<FakeEvent> = {
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
    ? { type: "finish", reason: { normalized: event.reason } }
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
            .flatMap((message) => [...message.content])
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

const fake = Api.make({
  name: "fake",
  protocol: fakeProtocol,
  path: "/chat",
  framing: fakeFraming,
})

const gemini = Api.make({
  name: "fake",
  id: "gemini-fake",
  protocol: fakeProtocol,
  path: "/chat",
  framing: fakeFraming,
})

const request = ai.request({
  id: "req_1",
  model: LanguageModel.make({
    id: "fake-model",
    provider: "fake-provider",
    api: fake,
    baseURL: "https://fake.local",
    auth: Auth.none,
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
const unterminated = testEffect(
  dynamicResponse(({ respond }) => Effect.succeed(respond(encodeJson([{ type: "text", text: "partial" }])))),
)

describe("llm api", () => {
  it.effect("stream and generate use the api pipeline", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))
      const response = yield* llm.generate(request)
      const reduced = LLMResponse.fromEvents(events)

      expect(events.map((event) => event.type)).toEqual(["text-delta", "finish"])
      expect(reduced).toBeDefined()
      if (!reduced) throw new Error("stream reducer did not produce a completed response")
      expect(response.events).toEqual(events)
      expect(response.message).toEqual(reduced.message)
      expect(response.usage).toEqual(reduced.usage)
      expect(response.finishReason).toEqual(reduced.finishReason)
      expect(response.message.content).toEqual([{ type: "text", text: 'echo:{"body":"hello"}' }])
    }),
  )

  unterminated.effect("fails when the normalized stream ends without a terminal event", () =>
    Effect.gen(function* () {
      const error = yield* (yield* LLMClient.Service).stream(request).pipe(Stream.runDrain, Effect.flip)

      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
      expect(error.message).toContain("The provider response ended unexpectedly.")
    }),
  )

  it.effect("selects apis by model api value", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest({
        ...request,
        model: LanguageModel.make({ ...request.model, api: gemini }),
      })

      expect(prepared.api).toBe("gemini-fake")
    }),
  )

  test("builds models from providers", () => {
    const configured = Provider.make({
      id: "fake-provider",
      baseURL: "https://fake.local",
      auth: Provider.keyless,
      apis: [fake],
    })

    expect(configured.model("fake-model")).toMatchObject({
      provider: "fake-provider",
    })
  })

  it.effect("does not register duplicate api ids globally", () =>
    Effect.gen(function* () {
      const duplicate = Api.make({
        name: "fake",
        protocol: Protocol.make({
          ...fakeProtocol,
          body: {
            ...fakeProtocol.body,
            from: () => Effect.succeed({ body: "late-default" }),
          },
        }),
        path: "/chat",
        framing: fakeFraming,
      })

      const prepared = yield* compileRequest({
        ...request,
        model: LanguageModel.make({ ...request.model, api: duplicate }),
      })

      expect(prepared.body).toEqual({ body: "late-default" })
    }),
  )
})
