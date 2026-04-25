import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLM } from "../src"
import { Adapter, client } from "../src/adapter"
import { Patch } from "../src/patch"
import { TransportRequest } from "../src/schema"
import { Transport } from "../src/transport"
import { testEffect } from "./lib/effect"

const Json = Schema.fromJsonString(Schema.Unknown)
const encodeJson = Schema.encodeSync(Json)

type FakeDraft = {
  readonly body: string
  readonly includeUsage?: boolean
}

type FakeChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "finish"; readonly reason: "stop" }

const request = LLM.request({
  id: "req_1",
  model: LLM.model({
    id: "fake-model",
    provider: "fake-provider",
    protocol: "openai-chat",
  }),
  prompt: "hello",
})

const fake = Adapter.define<FakeDraft, FakeDraft, FakeChunk>({
  id: "fake",
  protocol: "openai-chat",
  builder: {
    empty: { body: "" },
    concat: (left, right) => Effect.succeed({ ...left, ...right }),
    validate: (draft) => Effect.succeed(draft),
  },
  redact: (target) => ({ ...target, redacted: true }),
  prepare: (request) =>
    Effect.succeed({
      body: [
        ...request.messages
          .flatMap((message) => message.content)
          .filter((part) => part.type === "text")
          .map((part) => part.text),
        ...request.tools.map((tool) => `tool:${tool.name}:${tool.description}`),
      ]
        .join("\n"),
    }),
  toTransport: (target) =>
    Effect.succeed(
      new TransportRequest({
        url: "https://fake.local/chat",
        method: "POST",
        headers: {},
        body: JSON.stringify(target),
      }),
    ),
  parse: (response) =>
    Stream.fromEffect(response.json.pipe(Effect.orDie, Effect.map((body) => body as FakeChunk[]))).pipe(
      Stream.flatMap(Stream.fromIterable),
    ),
  raise: (chunk) => {
    if (chunk.type === "finish") return Stream.make({ type: "request-finish", reason: chunk.reason })
    return Stream.make({ type: "text-delta", text: chunk.text })
  },
})

const transportLayer = Layer.succeed(
  Transport.Service,
  Transport.Service.of({
    fetch: (request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          HttpClientRequest.post(request.url),
          new Response(encodeJson([{ type: "text", text: `echo:${request.body}` }, { type: "finish", reason: "stop" }])),
        ),
      ),
  }),
)

const it = testEffect(transportLayer)

describe("llm adapter", () => {
  test("prepare applies target and transport patches with trace", async () => {
    const llm = client({
      adapter: fake.withPatches([
        fake.patch("include-usage", {
          reason: "fake target patch",
          apply: (draft) => ({ ...draft, includeUsage: true }),
        }),
      ]),
      patches: [
        Patch.transport("fake.header", {
          reason: "fake transport patch",
          apply: (request) => ({ ...request, headers: { ...request.headers, "x-fake": "1" } }),
        }),
      ],
    })

    const prepared = await Effect.runPromise(llm.prepare(request))

    expect(prepared.redactedTarget).toEqual({ body: "hello", includeUsage: true, redacted: true })
    expect(prepared.transport.headers).toEqual({ "x-fake": "1" })
    expect(prepared.patchTrace.map((item) => item.id)).toEqual(["target.fake.include-usage", "transport.fake.header"])
  })

  it.effect("stream and generate use the adapter pipeline", () =>
    Effect.gen(function* () {
      const llm = client({ adapter: fake })
      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))
      const response = yield* llm.generate(request)

      expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
      expect(response.events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
    }),
  )

  test("request, prompt, and tool-schema patches run before adapter prepare", async () => {
    const llm = client({
      adapter: fake,
      patches: [
        Patch.request("test.id", {
          reason: "rewrite request id",
          apply: (request) => ({ ...request, id: "req_patched" }),
        }),
        Patch.prompt("test.message", {
          reason: "rewrite prompt text",
          apply: (request) => ({
            ...request,
            messages: request.messages.map((message) => ({
              ...message,
              content: message.content.map((part) => (part.type === "text" ? { ...part, text: "patched" } : part)),
            })),
          }),
        }),
        Patch.toolSchema("test.description", {
          reason: "rewrite tool description",
          apply: (tool) => ({ ...tool, description: "patched tool" }),
        }),
      ],
    })

    const prepared = await Effect.runPromise(
      llm.prepare(
        LLM.request({
          ...request,
          tools: [{ name: "lookup", description: "original", inputSchema: {} }],
        }),
      ),
    )

    expect(prepared.id).toBe("req_patched")
    expect(prepared.target).toEqual({ body: "patched\ntool:lookup:patched tool" })
    expect(prepared.patchTrace.map((item) => item.id)).toEqual([
      "request.test.id",
      "prompt.test.message",
      "schema.test.description",
    ])
  })

  it.effect("stream patches transform raised events", () =>
    Effect.gen(function* () {
      const llm = client({
        adapter: fake,
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

  test("rejects protocol mismatch", async () => {
    const llm = client({ adapter: fake })

    await expect(
      Effect.runPromise(
        llm.prepare(
          LLM.request({
            ...request,
            model: LLM.model({ ...request.model, protocol: "gemini" }),
          }),
        ),
      ),
    ).rejects.toThrow("No LLM adapter")
  })
})
