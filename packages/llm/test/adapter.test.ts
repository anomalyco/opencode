import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLM } from "../src"
import { Adapter, client } from "../src/adapter"
import { RequestExecutor } from "../src/executor"
import { Patch } from "../src/patch"
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
  redact: (target) => ({ ...target, redacted: true }),
  validate: (draft) => Effect.succeed(draft),
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
  toHttp: (target) =>
    Effect.succeed(
      HttpClientRequest.post("https://fake.local/chat").pipe(
        HttpClientRequest.setHeader("content-type", "application/json"),
        HttpClientRequest.bodyText(encodeJson(target), "application/json"),
      ),
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

const gemini = Adapter.define<FakeDraft, FakeDraft, FakeChunk>({
  ...fake,
  id: "gemini-fake",
  protocol: "gemini",
})

const httpLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.gen(function* () {
      const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
      return HttpClientResponse.fromWeb(
        request,
        new Response(encodeJson([{ type: "text", text: `echo:${yield* Effect.promise(() => web.text())}` }, { type: "finish", reason: "stop" }])),
      )
    }),
  ),
)

const it = testEffect(RequestExecutor.layer.pipe(Layer.provide(httpLayer)))

describe("llm adapter", () => {
  it.effect("prepare applies target patches with trace", () =>
    Effect.gen(function* () {
      const prepared = yield* client({
        adapters: [
          fake.withPatches([
            fake.patch("include-usage", {
              reason: "fake target patch",
              apply: (draft) => ({ ...draft, includeUsage: true }),
            }),
          ]),
        ],
      }).prepare(request)

      expect(prepared.redactedTarget).toEqual({ body: "hello", includeUsage: true, redacted: true })
      expect(prepared.patchTrace.map((item) => item.id)).toEqual(["target.fake.include-usage"])
    }),
  )

  it.effect("stream and generate use the adapter pipeline", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [fake] })
      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))
      const response = yield* llm.generate(request)

      expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
      expect(response.events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
    }),
  )

  it.effect("selects adapters by request protocol", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [fake, gemini] }).prepare(
        LLM.request({
          ...request,
          model: LLM.model({ ...request.model, protocol: "gemini" }),
        }),
      )

      expect(prepared.adapter).toBe("gemini-fake")
    }),
  )

  it.effect("request, prompt, and tool-schema patches run before adapter prepare", () =>
    Effect.gen(function* () {
      const prepared = yield* client({
        adapters: [fake],
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
      }).prepare(
        LLM.request({
          ...request,
          tools: [{ name: "lookup", description: "original", inputSchema: {} }],
        }),
      )

      expect(prepared.id).toBe("req_patched")
      expect(prepared.target).toEqual({ body: "patched\ntool:lookup:patched tool" })
      expect(prepared.patchTrace.map((item) => item.id)).toEqual([
        "request.test.id",
        "prompt.test.message",
        "schema.test.description",
      ])
    }),
  )

  it.effect("stream patches transform raised events", () =>
    Effect.gen(function* () {
      const llm = client({
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

  it.effect("rejects protocol mismatch", () =>
    Effect.gen(function* () {
      const error = yield* client({ adapters: [fake] })
        .prepare(
          LLM.request({
            ...request,
            model: LLM.model({ ...request.model, protocol: "gemini" }),
          }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("No LLM adapter")
    }),
  )
})
