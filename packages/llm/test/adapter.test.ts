import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM } from "../src"
import { Adapter, LLMClient } from "../src/adapter"
import { Patch } from "../src/patch"
import type { LLMRequest, Message, ModelRef, ToolDefinition } from "../src/schema"
import { testEffect } from "./lib/effect"
import { dynamicResponse } from "./lib/http"

const updateMessageContent = (message: Message, content: Message["content"]) =>
  LLM.message({
    id: message.id,
    role: message.role,
    content,
    metadata: message.metadata,
    native: message.native,
  })

const updateModel = (model: ModelRef, patch: Partial<LLM.ModelInput>) =>
  LLM.model({
    id: model.id,
    provider: model.provider,
    protocol: model.protocol,
    baseURL: model.baseURL,
    headers: model.headers,
    capabilities: model.capabilities,
    limits: model.limits,
    native: model.native,
    ...patch,
  })

const updateToolDefinition = (tool: ToolDefinition, patch: Partial<ToolDefinition>) =>
  LLM.toolDefinition({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    metadata: tool.metadata,
    native: tool.native,
    ...patch,
  })

const mapText = (fn: (text: string) => string) => (request: LLMRequest): LLMRequest =>
  LLM.updateRequest(request, {
    messages: request.messages.map((message) =>
      updateMessageContent(
        message,
        message.content.map((part) => (part.type === "text" ? { ...part, text: fn(part.text) } : part)),
      ),
    ),
  })

const Json = Schema.fromJsonString(Schema.Unknown)
const encodeJson = Schema.encodeSync(Json)

type FakeDraft = {
  readonly body: string
  readonly includeUsage?: boolean
}

const FakeChunk = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("finish"), reason: Schema.Literal("stop") }),
])
type FakeChunk = Schema.Schema.Type<typeof FakeChunk>
const FakeChunks = Schema.Array(FakeChunk)

const request = LLM.request({
  id: "req_1",
  model: LLM.model({
    id: "fake-model",
    provider: "fake-provider",
    protocol: "openai-chat",
  }),
  prompt: "hello",
})

const raiseChunk = (chunk: FakeChunk): import("../src/schema").LLMEvent =>
  chunk.type === "finish"
    ? { type: "request-finish", reason: chunk.reason }
    : { type: "text-delta", text: chunk.text }

const fake = Adapter.define<FakeDraft, FakeDraft>({
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
      ].join("\n"),
    }),
  toHttp: (target) =>
    Effect.succeed(
      HttpClientRequest.post("https://fake.local/chat").pipe(
        HttpClientRequest.setHeader("content-type", "application/json"),
        HttpClientRequest.bodyText(encodeJson(target), "application/json"),
      ),
    ),
  parse: (response) =>
    Stream.fromEffect(
      response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(FakeChunks)),
        Effect.orDie,
      ),
    ).pipe(
      Stream.flatMap(Stream.fromIterable),
      Stream.map(raiseChunk),
    ),
})

const gemini = Adapter.define<FakeDraft, FakeDraft>({
  ...fake,
  id: "gemini-fake",
  protocol: "gemini",
})

const providerFake = Adapter.compose({
  id: "provider-fake",
  provider: "fake-provider",
  base: fake,
  prepare: (request) => fake.prepare(request).pipe(Effect.map((draft) => ({ ...draft, body: `provider:${draft.body}` }))),
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
  it.effect("prepare applies target patches with trace", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({
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
      const llm = LLMClient.make({ adapters: [fake] })
      const events = Array.from(yield* llm.stream(request).pipe(Stream.runCollect))
      const response = yield* llm.generate(request)

      expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
      expect(response.events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
    }),
  )

  it.effect("selects adapters by request protocol", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: [fake, gemini] }).prepare(
        LLM.updateRequest(request, { model: updateModel(request.model, { protocol: "gemini" }) }),
      )

      expect(prepared.adapter).toBe("gemini-fake")
    }),
  )

  it.effect("prefers provider-specific adapters over protocol fallbacks", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({ adapters: [fake, providerFake] }).prepare(request)

      expect(prepared.adapter).toBe("provider-fake")
      expect(prepared.target).toEqual({ body: "provider:hello" })
    }),
  )

  it.effect("request, prompt, and tool-schema patches run before adapter prepare", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({
        adapters: [fake],
        patches: [
          Patch.request("test.id", {
            reason: "rewrite request id",
            apply: (request) => LLM.updateRequest(request, { id: "req_patched" }),
          }),
          Patch.prompt("test.message", {
            reason: "rewrite prompt text",
            apply: mapText(() => "patched"),
          }),
          Patch.toolSchema("test.description", {
            reason: "rewrite tool description",
            apply: (tool) => updateToolDefinition(tool, { description: "patched tool" }),
          }),
        ],
      }).prepare(
        LLM.updateRequest(request, {
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

  it.effect("request patches feed into prompt-patch predicates so phases see updated context", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({
        adapters: [fake],
        patches: [
          // Earlier phase rewrites the provider, later phase only fires for the
          // rewritten provider. If `compile` re-uses a stale PatchContext this
          // test fails because the prompt patch's `when` would not match.
          Patch.request("rewrite-provider", {
            reason: "swap provider before prompt phase",
            apply: (request) => LLM.updateRequest(request, { model: updateModel(request.model, { provider: "rewritten" }) }),
          }),
          Patch.prompt("rewrite-only-when-rewritten", {
            reason: "rewrite prompt text only after provider swap",
            when: (ctx) => ctx.model.provider === "rewritten",
            apply: mapText((text) => `rewrote-${text}`),
          }),
        ],
      }).prepare(request)

      expect(prepared.target).toEqual({ body: "rewrote-hello" })
      expect(prepared.patchTrace.map((item) => item.id)).toEqual([
        "request.rewrite-provider",
        "prompt.rewrite-only-when-rewritten",
      ])
    }),
  )

  it.effect("patches with the same order sort by id for deterministic application", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.make({
        adapters: [fake],
        patches: [
          Patch.prompt("zeta", {
            reason: "later id",
            order: 1,
            apply: mapText((text) => `${text}|zeta`),
          }),
          Patch.prompt("alpha", {
            reason: "earlier id",
            order: 1,
            apply: mapText((text) => `${text}|alpha`),
          }),
        ],
      }).prepare(request)

      expect(prepared.target).toEqual({ body: "hello|alpha|zeta" })
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

  it.effect("stream patches transform multiple events per stream", () =>
    Effect.gen(function* () {
      // Verifies stream patches run on every event, not just the first.
      const seen: string[] = []
      const llm = LLMClient.make({
        adapters: [fake],
        patches: [
          Patch.stream("test.tap", {
            reason: "record every event type",
            apply: (event) => {
              seen.push(event.type)
              return event
            },
          }),
        ],
      })

      yield* llm.stream(request).pipe(Stream.runDrain)

      expect(seen).toEqual(["text-delta", "request-finish"])
    }),
  )

  it.effect("rejects protocol mismatch", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.make({ adapters: [fake] })
        .prepare(
          LLM.updateRequest(request, { model: updateModel(request.model, { protocol: "gemini" }) }),
        )
        .pipe(Effect.flip)

      expect(error.message).toContain("No LLM adapter")
    }),
  )
})
