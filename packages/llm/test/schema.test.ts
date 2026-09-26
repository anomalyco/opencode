import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import * as OpenAIChat from "../src/protocols/openai-chat"
import * as OpenAIResponses from "../src/protocols/openai-responses"
import {
  ContentPart,
  InvalidRequestReason,
  LLMError,
  LLMEvent,
  LLMRequest,
  Model,
  ModelID,
  ProviderFailureClassification,
  ProviderID,
  ProviderMetadata,
  Usage,
} from "../src/schema"
import { ProviderShared } from "../src/protocols/shared"

const model = new Model({
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
      model: Model.update(model, { route: OpenAIResponses.route }),
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
    expect(LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 1 } }).usage).toBeInstanceOf(Usage)
    expect(LLMEvent.finish({ reason: "stop", usage: { outputTokens: 2 } }).usage).toBeInstanceOf(Usage)
  })

  test("content part tagged union exposes guards", () => {
    expect(ContentPart.guards.text({ type: "text", text: "hi" })).toBe(true)
    expect(ContentPart.guards.media({ type: "text", text: "hi" })).toBe(false)
  })
})

describe("LLM.Usage", () => {
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

  test("visibleOutputTokens clamps reasoning > output to zero", () => {
    expect(new Usage({ outputTokens: 10, reasoningTokens: 4 }).visibleOutputTokens).toBe(6)
    expect(new Usage({ outputTokens: 10 }).visibleOutputTokens).toBe(10)
    expect(new Usage({ outputTokens: 4, reasoningTokens: 10 }).visibleOutputTokens).toBe(0)
    expect(new Usage({}).visibleOutputTokens).toBe(0)
  })
})

describe("LLM.ProviderFailureClassification (M1-T01)", () => {
  const decodeClassification = Schema.decodeUnknownSync(ProviderFailureClassification)
  const encodeClassification = Schema.encodeSync(ProviderFailureClassification)
  const decodeEvent = Schema.decodeUnknownSync(LLMEvent)
  const encodeEvent = Schema.encodeSync(LLMEvent)
  const classifications = ["context-overflow", "incomplete-stream"] as const
  const metadata = { openai: { nested: { deep: true } } } satisfies ProviderMetadata
  const decodeProviderError = (input: unknown) => {
    const decoded = decodeEvent(input)
    if (decoded.type !== "provider-error") throw new Error(`expected provider-error, got ${decoded.type}`)
    return decoded
  }

  test("accepts both literals on the scalar schema with a lossless round-trip", () => {
    for (const classification of classifications) {
      expect(decodeClassification(classification)).toBe(classification)
      expect(encodeClassification(classification)).toBe(classification)
    }
  })

  test("rejects unsupported classification values", () => {
    expect(() => decodeClassification("network-error")).toThrow()
    expect(() => decodeClassification("")).toThrow()
    expect(() => decodeClassification(null)).toThrow()
    expect(() => decodeClassification(1)).toThrow()
    expect(() => decodeClassification(undefined)).toThrow()
  })

  test("round-trips both literals through ProviderErrorEvent with nested metadata intact", () => {
    for (const classification of classifications) {
      const event = LLMEvent.providerError({
        message: "m1 classification probe",
        retryable: false,
        classification,
        providerMetadata: metadata,
      })
      expect(LLMEvent.is.providerError(event)).toBe(true)
      const decoded = decodeProviderError(encodeEvent(event))
      expect(decoded).toMatchObject({
        type: "provider-error",
        message: "m1 classification probe",
        retryable: false,
        classification,
      })
      expect(decoded.providerMetadata).toEqual(metadata)
      expect(encodeEvent(decoded)).toEqual(encodeEvent(event))
    }
  })

  test("round-trips both literals through real InvalidRequestReason and LLMError instances", () => {
    const decodeReason = Schema.decodeUnknownSync(InvalidRequestReason)
    const decodeError = Schema.decodeUnknownSync(LLMError)
    for (const classification of classifications) {
      const reason = new InvalidRequestReason({ message: "m1 real class probe", classification })
      expect(decodeReason(reason).classification).toBe(classification)
      const error = new LLMError({ module: "m1.module", method: "probe", reason })
      const decodedError = decodeError(error)
      expect(decodedError.reason._tag).toBe("InvalidRequest")
      if (decodedError.reason._tag !== "InvalidRequest") throw new Error("expected InvalidRequest reason")
      expect(decodedError.reason.classification).toBe(classification)
      expect(decodedError.retryable).toBe(false)
    }
  })

  test("keeps absent and explicit-undefined classification interchangeable", () => {
    const absent = decodeProviderError({ type: "provider-error", message: "unclassified" })
    const explicit = decodeProviderError({
      type: "provider-error",
      message: "unclassified",
      classification: undefined,
    })
    expect(absent.classification).toBeUndefined()
    expect(explicit.classification).toBeUndefined()
    const encodedAbsent = JSON.parse(JSON.stringify(encodeEvent(absent)))
    const encodedExplicit = JSON.parse(JSON.stringify(encodeEvent(explicit)))
    expect(encodedAbsent).toEqual({ type: "provider-error", message: "unclassified" })
    expect(encodedExplicit).toEqual(encodedAbsent)
  })

  test("leaves the pre-existing context-overflow payload untouched", () => {
    const event = LLMEvent.providerError({
      message: "Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
      retryable: false,
      classification: "context-overflow",
      providerMetadata: metadata,
    })
    const decoded = decodeProviderError(encodeEvent(event))
    expect(decoded).toMatchObject({
      type: "provider-error",
      message: "Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
      retryable: false,
      classification: "context-overflow",
    })
    expect(decoded.providerMetadata).toEqual(metadata)
    // The dedicated overflow reader must still match only context-overflow.
    expect(decoded.classification === "incomplete-stream").toBe(false)
  })
})
