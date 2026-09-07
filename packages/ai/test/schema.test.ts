import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import * as OpenAIResponses from "../src/protocols/openai-responses.js"
import {
  AIError,
  AIErrorReason,
  AuthenticationError,
  ContentPart,
  ContentPolicyError,
  HttpContext,
  InvalidProviderOutputError,
  InvalidRequestError,
  LLMEvent,
  LLMRequest,
  LanguageModel,
  ModelID,
  NoRouteError,
  ProviderID,
  ProviderInternalError,
  QuotaExceededError,
  RateLimitError,
  RouteID,
  ToolResultValue,
  TransportError,
  UnknownProviderError,
  UnsupportedOperationError,
  Usage,
} from "../src/schema/index.js"
import { ProviderShared } from "../src/protocols/shared.js"
import { it } from "./lib/effect.js"

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

describe("ToolResultValue", () => {
  test("uses the canonical schema guard", () => {
    const cases: ReadonlyArray<{ readonly value: unknown; readonly expected: boolean }> = [
      { value: { type: "json", value: { ok: true } }, expected: true },
      { value: { type: "text", value: "done" }, expected: true },
      { value: { type: "error", value: "failed" }, expected: true },
      { value: { type: "content", value: [{ type: "text", text: "done" }] }, expected: true },
      { value: { type: "content", value: [{ type: "text" }] }, expected: false },
      { value: { type: "content", value: "done" }, expected: false },
      { value: { type: "json" }, expected: false },
      { value: { type: "unknown", value: "done" }, expected: false },
    ]

    for (const item of cases) {
      expect(Schema.is(ToolResultValue)(item.value)).toBe(item.expected)
      expect(ToolResultValue.is(item.value)).toBe(item.expected)
    }
  })

  test("accepts canonical results with extra fields", () => {
    expect(ToolResultValue.is({ type: "json", value: { ok: true }, metadata: { source: "tool" } })).toBe(true)
    expect(
      ToolResultValue.is({
        type: "content",
        value: [{ type: "file", uri: "https://example.test/result.txt", mime: "text/plain", checksum: "abc" }],
        metadata: { source: "tool" },
      }),
    ).toBe(true)
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

  it.effect("sseFraming maps decoder failures to AI errors", () =>
    Effect.gen(function* () {
      const error = yield* ProviderShared.sseFraming(
        Stream.make(new TextEncoder().encode(`data: ${"x".repeat(10 * 1024 * 1024)}`)),
      ).pipe(Stream.runCollect, Effect.flip)

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
    }),
  )

  it.effect("sseFraming ignores retry directives without ending the stream", () =>
    Effect.gen(function* () {
      const encoder = new TextEncoder()
      const frames = yield* ProviderShared.sseFraming(
        Stream.make(
          encoder.encode("retry: 1000\n\n"),
          encoder.encode('data: {"first":true}\n\n'),
          encoder.encode("retry: 2000\n\n"),
          encoder.encode('data: {"second":true}\n\n'),
        ).pipe(Stream.rechunk(1)),
      ).pipe(Stream.runCollect)

      expect(Array.from(frames)).toEqual(['{"first":true}', '{"second":true}'])
    }),
  )

  it.effect("sseFraming preserves event data around retry directives", () =>
    Effect.gen(function* () {
      const encoder = new TextEncoder()
      const frames = yield* ProviderShared.sseFraming(
        Stream.make(
          encoder.encode("event: update\ndata: first\n"),
          encoder.encode("retry: 1000\n"),
          encoder.encode("data: second\n\n"),
        ).pipe(Stream.rechunk(1)),
        new Set(["update"]),
      ).pipe(Stream.runCollect)

      expect(Array.from(frames)).toEqual(["first\nsecond"])
    }),
  )

  test("visibleOutputTokens clamps reasoning > output to zero", () => {
    expect(new Usage({ outputTokens: 10, reasoningTokens: 4 }).visibleOutputTokens).toBe(6)
    expect(new Usage({ outputTokens: 10 }).visibleOutputTokens).toBe(10)
    expect(new Usage({ outputTokens: 4, reasoningTokens: 10 }).visibleOutputTokens).toBe(0)
    expect(new Usage({}).visibleOutputTokens).toBe(0)
  })
})

it.effect("AI errors expose the shared runtime tag", () =>
  Effect.gen(function* () {
    const error = new AIError({
      reason: new InvalidRequestError({ message: "invalid" }),
    })
    expect(error._tag).toBe("AI.Error")
    expect(error.message).toBe("invalid")
    expect(error.cause).toBe(error.reason)
    expect(error.reason.cause).toBeUndefined()
    expect(yield* Effect.fail(error).pipe(Effect.catchTag("AI.Error", () => Effect.succeed("caught")))).toBe("caught")
  }),
)

test("transport errors serialize execution facts", () => {
  const reason = new TransportError({
    message: "Connection closed",
    transport: "websocket",
    operation: "read",
    phase: "receive",
    delivery: "ambiguous",
    recovery: "fail",
  })

  expect(Schema.encodeSync(TransportError)(reason)).toEqual({
    _tag: "Transport",
    message: "Connection closed",
    transport: "websocket",
    operation: "read",
    phase: "receive",
    delivery: "ambiguous",
    recovery: "fail",
  })
  expect(Schema.decodeUnknownSync(TransportError)(Schema.encodeSync(TransportError)(reason))).toEqual(reason)
})

test("AI errors serialize diagnostics only on their typed reason", () => {
  const cause = new SyntaxError("Unexpected end of JSON input")
  const error = new AIError({
    reason: new InvalidRequestError({
      message: "Invalid provider response",
      body: '{"error":',
      http: new HttpContext({
        url: "https://provider.test/v1/messages",
        status: 400,
        headers: { "request-id": "req_123" },
      }),
      cause,
      parameter: "messages",
      classification: "context-overflow",
    }),
  })
  const encoded = Schema.encodeSync(AIError)(error)
  expect(encoded).toEqual({
    _tag: "AI.Error",
    reason: {
      _tag: "InvalidRequest",
      message: "Invalid provider response",
      body: '{"error":',
      http: {
        url: "https://provider.test/v1/messages",
        status: 400,
        headers: { "request-id": "req_123" },
      },
      cause: { name: "SyntaxError", message: cause.message, stack: cause.stack },
      parameter: "messages",
      classification: "context-overflow",
    },
  })
  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(AIError))(
    Schema.encodeSync(Schema.fromJsonString(AIError))(error),
  )

  expect(error).not.toHaveProperty("body")
  expect(error).not.toHaveProperty("http")
  expect(error.cause).toBe(error.reason)
  expect(error.reason.cause).toBe(cause)
  expect(decoded).toBeInstanceOf(AIError)
  expect(decoded.reason).toBeInstanceOf(InvalidRequestError)
  expect(decoded.message).toBe("Invalid provider response")
  expect(decoded.reason.message).toBe(decoded.message)
  expect(decoded.reason.body).toBe('{"error":')
  expect(decoded.reason.http).toEqual(error.reason.http)
  expect(decoded.cause).toBe(decoded.reason)
  expect(decoded.reason.cause).toBeInstanceOf(Error)
  expect(decoded.reason.cause).toMatchObject({ name: "SyntaxError", message: cause.message, stack: cause.stack })
  expect(decoded.reason).toMatchObject({ parameter: "messages", classification: "context-overflow" })
})

test("AI error reasons are tagged Errors with required messages", () => {
  const reasons = [
    new InvalidRequestError({ message: "Invalid request" }),
    new UnsupportedOperationError({
      message: "Unsupported operation",
      operation: "compact",
      provider: model.provider,
      route: "fake-route",
    }),
    new NoRouteError({
      message: "No route",
      route: RouteID.make("missing"),
      provider: model.provider,
      model: model.id,
    }),
    new AuthenticationError({ message: "Missing credentials" }),
    new RateLimitError({ message: "Rate limited" }),
    new QuotaExceededError({ message: "Quota exceeded" }),
    new ContentPolicyError({ message: "Content blocked" }),
    new ProviderInternalError({ message: "Provider failed" }),
    new TransportError({ message: "Connection failed", transport: "http", operation: "request" }),
    new InvalidProviderOutputError({ message: "Invalid output" }),
    new UnknownProviderError({ message: "Unknown failure" }),
  ]
  expect(reasons.map((reason) => reason._tag)).toEqual([
    "InvalidRequest",
    "UnsupportedOperation",
    "NoRoute",
    "Authentication",
    "RateLimit",
    "QuotaExceeded",
    "ContentPolicy",
    "ProviderInternal",
    "Transport",
    "InvalidProviderOutput",
    "UnknownProvider",
  ])
  reasons.forEach((reason) => {
    expect(reason).toBeInstanceOf(Error)
    const encoded = Schema.encodeSync(AIErrorReason)(reason)
    const decoded = Schema.decodeUnknownSync(AIErrorReason)(encoded)
    expect(decoded).toBeInstanceOf(reason.constructor)
    expect(decoded.message).toBe(reason.message)
    expect(Schema.decodeUnknownOption(AIErrorReason)({ ...encoded, message: undefined })._tag).toBe("None")
  })
})

test("AI error reason enrichment preserves non-enumerable diagnostics", () => {
  const cause = new Error("socket disconnected")
  const reason = new TransportError({
    message: "Connection closed",
    body: "close frame detail",
    http: new HttpContext({ url: "https://provider.test/responses", status: 101, headers: { upgrade: "websocket" } }),
    cause,
    transport: "websocket",
    operation: "read",
    phase: "close",
  })
  expect(Object.prototype.propertyIsEnumerable.call(reason, "message")).toBe(false)
  expect(Object.prototype.propertyIsEnumerable.call(reason, "cause")).toBe(false)
  const enriched = AIErrorReason.make({
    // oxlint-disable-next-line typescript-eslint/no-misused-spread -- Copy fields rather than iterating the yieldable error.
    ...reason,
    message: reason.message,
    cause: reason.cause,
    delivery: "ambiguous",
    recovery: "retry-full",
  })
  const error = new AIError({ reason: enriched })

  expect(enriched).toBeInstanceOf(TransportError)
  expect(error.message).toBe(reason.message)
  expect(error.cause).toBe(enriched)
  expect(enriched.cause).toBe(cause)
  expect(enriched.body).toBe(reason.body)
  expect(enriched.http).toBe(reason.http)
  expect(enriched).toMatchObject({ phase: "close", delivery: "ambiguous", recovery: "retry-full" })
})

test("AI errors support reason-specific handlers", async () => {
  const limited = new AIError({ reason: new RateLimitError({ message: "Slow down", retryAfterMs: 2000 }) })
  const invalid = new AIError({ reason: new InvalidRequestError({ message: "Invalid request", parameter: "model" }) })
  expect(
    await Effect.runPromise(
      Effect.fail(limited).pipe(
        Effect.catchReason("AI.Error", "RateLimit", (reason) => {
          expect(reason).toBe(limited.reason)
          expect(reason).toBeInstanceOf(RateLimitError)
          return Effect.succeed(reason.retryAfterMs)
        }),
      ),
    ),
  ).toBe(2000)
  expect(
    await Effect.runPromise(
      Effect.forEach([limited, invalid], (error) =>
        Effect.fail(error).pipe(
          Effect.catchReasons("AI.Error", {
            RateLimit: (reason) => Effect.succeed(reason.message),
            InvalidRequest: (reason) => Effect.succeed(reason.parameter),
          }),
        ),
      ),
    ),
  ).toEqual(["Slow down", "model"])
})

test("HTTP error context requires an observed response", () => {
  const decode = Schema.decodeUnknownOption(HttpContext)
  expect(decode({ status: 400, headers: {} })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", headers: {} })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", status: 400 })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", status: 0, headers: {} })._tag).toBe("None")
  expect(decode({ url: "https://provider.test", status: Number.NaN, headers: {} })._tag).toBe("None")
})
