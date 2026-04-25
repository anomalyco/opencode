import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { Adapter, client } from "../../src/llm-core/adapter"
import { Patch } from "../../src/llm-core/patch"
import {
  LLMRequest,
  ModelCapabilities,
  ModelLimits,
  ModelRef,
  TransportRequest,
} from "../../src/llm-core/schema"
import type { Transport } from "../../src/llm-core/transport"

type FakeDraft = {
  readonly body: string
  readonly includeUsage?: boolean
}

type FakeChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "finish"; readonly reason: "stop" }

const capabilities = new ModelCapabilities({
  input: { text: true, image: false, audio: false, video: false, pdf: false },
  output: { text: true, reasoning: false },
  tools: { calls: true, streamingInput: true, providerExecuted: false },
  cache: { prompt: false, messageBlocks: false, contentBlocks: false },
  reasoning: { efforts: [], summaries: false, encryptedContent: false },
})

const request = new LLMRequest({
  id: "req_1",
  model: new ModelRef({
    id: "fake-model",
    provider: "fake-provider",
    protocol: "openai-chat",
    capabilities,
    limits: new ModelLimits({}),
  }),
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  tools: [],
  generation: {},
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
      body: request.messages
        .flatMap((message) => message.content)
        .filter((part) => part.type === "text")
        .map((part) => part.text)
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
    Stream.fromEffect(Effect.promise(async () => (await response.json()) as FakeChunk[])).pipe(Stream.flatMap(Stream.fromIterable)),
  raise: (chunk) => {
    if (chunk.type === "finish") return Stream.make({ type: "request-finish", reason: chunk.reason })
    return Stream.make({ type: "text-delta", text: chunk.text })
  },
})

const transport: Transport = {
  fetch: (request) =>
    Effect.succeed(
      new Response(JSON.stringify([{ type: "text", text: `echo:${request.body}` }, { type: "finish", reason: "stop" }])),
    ),
}

describe("llm-core adapter", () => {
  test("prepare applies target and transport patches with trace", async () => {
    const llm = client({
      adapter: fake.withPatches([
        fake.patch("include-usage", {
          reason: "fake target patch",
          apply: (draft) => ({ ...draft, includeUsage: true }),
        }),
      ]),
      transport,
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

  test("stream and generate use the adapter pipeline", async () => {
    const llm = client({ adapter: fake, transport })
    const events = Array.from(await Effect.runPromise(llm.stream(request).pipe(Stream.runCollect)))
    const response = await Effect.runPromise(llm.generate(request))

    expect(events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
    expect(response.events.map((event) => event.type)).toEqual(["text-delta", "request-finish"])
  })

  test("rejects protocol mismatch", async () => {
    const llm = client({ adapter: fake, transport })

    await expect(
      Effect.runPromise(
        llm.prepare(
          new LLMRequest({
            ...request,
            model: new ModelRef({ ...request.model, protocol: "gemini" }),
          }),
        ),
      ),
    ).rejects.toThrow("No LLM adapter")
  })
})
