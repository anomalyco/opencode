import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import * as OpenAIResponses from "../src/protocols/openai-responses.js"
import {
  AIError,
  ContentPart,
  HttpContext,
  InvalidRequestReason,
  LLMEvent,
  LLMRequest,
  LanguageModel,
  ModelID,
  ProviderID,
  TransportReason,
  Usage,
} from "../src/schema/index.js"
import { ProviderShared } from "../src/protocols/shared.js"

const model = new LanguageModel({
  id: ModelID.make("fake-model"),
  provider: ProviderID.make("fake-provider"),
  route: OpenAIChat.route,
})

const decodeLLMRequest = Schema.decodeUnknownSync(LLMRequest as unknown as Schema.Decoder<LLMRequest>)
const decodeLLMEvent = Schema.decodeUnknownSync(LLMEvent as unknown as Schema.Decoder<LLMEvent>)

describe("llm schema", () => {
  test("decodes a minimal request", () => {
    const input: unknown = {
      id: "req_1",
      model,
      system: [{ type: "text", text: "You are terse." }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      generation: {},
    }

    const decoded = decodeLLMRequest(input)

    expect(decoded.id).toBe("req_1")
    expect(decoded.messages[0]?.content[0]?.type).toBe("text")
  })

  test("accepts custom route ids", () => {
    const decoded = decodeLLMRequest({
      model: LanguageModel.update(model, { route: OpenAIResponses.route }),
      system: [],
      messages: [],
      tools: [],
      generation: {},
    })

    expect(decoded.model.route.id).toBe("openai-responses")
  })

  test("rejects invalid event type", () => {
    expect(() => decodeLLMEvent({ type: "bogus" })).toThrow()
  })

  test("finish constructors accept usage input", () => {
    expect(
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" }, usage: { inputTokens: 1 } }).usage,
    ).toBeInstanceOf(Usage)
    expect(LLMEvent.finish({ reason: { normalized: "stop" }, usage: { outputTokens: 2 } }).usage).toBeInstanceOf(Usage)
  })

  test("content part tagged union exposes guards", () => {
    expect(ContentPart.guards.text({ type: "text", text: "hi" })).toBe(true)
    expect(ContentPart.guards.media({ type: "text", text: "hi" })).toBe(false)
  })
})

describe("AI.Usage", () => {
  test("subtractTokens clamps non-sensical breakdowns to zero", () => {
    // Defense against a provider reporting cached_tokens > prompt_tokens or
    // reasoning_tokens > completion_tokens — the negative would otherwise
    // round-trip through the pipeline and crash strict downstream schemas.
    expect(ProviderShared.subtractTokens(5, 3)).toBe(2)
    expect(ProviderShared.subtractTokens(5, 10)).toBe(0)
    expect(ProviderShared.subtractTokens(5, undefined)).toBe(5)
    expect(ProviderShared.subtractTokens(undefined, 3)).toBeUndefined()
    expect(ProviderShared.subtractTokens(undefined, undefined)).toBeUndefined()
  })

  test("sumTokens returns undefined only when every input is undefined", () => {
    expect(ProviderShared.sumTokens(1, 2, 3)).toBe(6)
    expect(ProviderShared.sumTokens(1, undefined, 3)).toBe(4)
    expect(ProviderShared.sumTokens(undefined, undefined, undefined)).toBeUndefined()
    expect(ProviderShared.sumTokens()).toBeUndefined()
  })

  test("sseFraming maps decoder failures to AI errors", async () => {
    const error = await Effect.runPromise(
      ProviderShared.sseFraming(Stream.make(new TextEncoder().encode(`data: ${"x".repeat(10 * 1024 * 1024)}`))).pipe(
        Stream.runCollect,
        Effect.flip,
      ),
    )

    expect(error).toBeInstanceOf(AIError)
    expect(error.reason._tag).toBe("InvalidProviderOutput")
  })

  test("sseFraming ignores retry directives without ending the stream", async () => {
    const encoder = new TextEncoder()
    const frames = await Effect.runPromise(
      ProviderShared.sseFraming(
        Stream.make(
          encoder.encode("retry: 1000\n\n"),
          encoder.encode('data: {"first":true}\n\n'),
          encoder.encode("retry: 2000\n\n"),
          encoder.encode('data: {"second":true}\n\n'),
        ).pipe(Stream.rechunk(1)),
      ).pipe(Stream.runCollect),
    )

    expect(Array.from(frames)).toEqual(['{"first":true}', '{"second":true}'])
  })

  test("sseFraming preserves event data around retry directives", async () => {
    const encoder = new TextEncoder()
    const frames = await Effect.runPromise(
      ProviderShared.sseFraming(
        Stream.make(
          encoder.encode("event: update\ndata: first\n"),
          encoder.encode("retry: 1000\n"),
          encoder.encode("data: second\n\n"),
        ).pipe(Stream.rechunk(1)),
        new Set(["update"]),
      ).pipe(Stream.runCollect),
    )

    expect(Array.from(frames)).toEqual(["first\nsecond"])
  })

  test("visibleOutputTokens clamps reasoning > output to zero", () => {
    expect(new Usage({ outputTokens: 10, reasoningTokens: 4 }).visibleOutputTokens).toBe(6)
    expect(new Usage({ outputTokens: 10 }).visibleOutputTokens).toBe(10)
    expect(new Usage({ outputTokens: 4, reasoningTokens: 10 }).visibleOutputTokens).toBe(0)
    expect(new Usage({}).visibleOutputTokens).toBe(0)
  })
})

test("AI errors expose the shared runtime tag", async () => {
  const error = new AIError({
    message: "invalid",
    reason: new InvalidRequestReason({}),
  })
  expect(error._tag).toBe("AI.Error")
  expect(error.message).toBe("invalid")
  expect(error.cause).toBeUndefined()
  expect(
    await Effect.runPromise(Effect.fail(error).pipe(Effect.catchTag("AI.Error", () => Effect.succeed("caught")))),
  ).toBe("caught")
})

test("transport errors serialize execution facts", () => {
  const reason = new TransportReason({
    transport: "websocket",
    operation: "read",
    phase: "receive",
    delivery: "ambiguous",
    recovery: "fail",
  })

  expect(Schema.encodeSync(TransportReason)(reason)).toEqual({
    _tag: "Transport",
    transport: "websocket",
    operation: "read",
    phase: "receive",
    delivery: "ambiguous",
    recovery: "fail",
  })
  expect(Schema.decodeUnknownSync(TransportReason)(Schema.encodeSync(TransportReason)(reason))).toEqual(reason)
})

test("AI errors retain diagnostics independently of the classified reason", () => {
  const cause = new SyntaxError("Unexpected end of JSON input")
  const error = new AIError({
    message: "Invalid provider response",
    reason: new InvalidRequestReason({}),
    body: '{"error":',
    http: new HttpContext({
      url: "https://provider.test/v1/messages",
      status: 400,
      headers: { "request-id": "req_123" },
    }),
    cause,
  })
  const decoded = Schema.decodeUnknownSync(AIError)(Schema.encodeSync(AIError)(error))

  expect(decoded.message).toBe("Invalid provider response")
  expect(decoded.body).toBe('{"error":')
  expect(decoded.http).toEqual(error.http)
  expect(error.cause).toBe(cause)
  expect(decoded.cause).toBeInstanceOf(Error)
  expect(decoded.cause).toMatchObject({ name: "SyntaxError", message: cause.message, stack: cause.stack })
  expect(decoded.reason).toEqual({ _tag: "InvalidRequest" })
})

test("HTTP error context requires an observed response", () => {
  const decode = Schema.decodeUnknownOption(HttpContext)
  expect(decode({ status: 400, headers: {} })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", headers: {} })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", status: 400 })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", status: 0, headers: {} })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", status: Number.NaN, headers: {} })._tag).toBe("None")
})
