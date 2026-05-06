import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  ContentPart,
  InvalidRequestError,
  LLMError,
  LLMEvent,
  LLMRequest,
  ModelCapabilities,
  ModelID,
  ModelLimits,
  ModelRef,
  ProviderID,
  ResponseFormat,
  ToolResultValue,
} from "../src/schema"

const capabilities = new ModelCapabilities({
  input: { text: true, image: false, audio: false, video: false, pdf: false },
  output: { text: true, reasoning: false },
  tools: { calls: true, streamingInput: true, providerExecuted: false },
  cache: { prompt: false, messageBlocks: false, contentBlocks: false },
  reasoning: { efforts: [], summaries: false, encryptedContent: false },
})

const model = new ModelRef({
  id: ModelID.make("fake-model"),
  provider: ProviderID.make("fake-provider"),
  adapter: "openai-chat",
  protocol: "openai-chat",
  capabilities,
  limits: new ModelLimits({}),
})

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

    const decoded = Schema.decodeUnknownSync(LLMRequest)(input)

    expect(decoded.id).toBe("req_1")
    expect(decoded.messages[0]?.content[0]?.type).toBe("text")
  })

  test("accepts custom adapter and protocol ids", () => {
    const decoded = Schema.decodeUnknownSync(LLMRequest)({
      model: { ...model, adapter: "custom-adapter", protocol: "custom-protocol" },
      system: [],
      messages: [],
      tools: [],
      generation: {},
    })

    expect(decoded.model.adapter).toBe("custom-adapter")
    expect(decoded.model.protocol).toBe("custom-protocol")
  })

  test("rejects invalid event type", () => {
    expect(() => Schema.decodeUnknownSync(LLMEvent)({ type: "bogus" })).toThrow()
  })

  test("content part tagged union exposes guards", () => {
    expect(ContentPart.guards.text({ type: "text", text: "hi" })).toBe(true)
    expect(ContentPart.guards.media({ type: "text", text: "hi" })).toBe(false)
  })

  test("tagged unions expose consistent camel-case is helpers", () => {
    expect(ContentPart.is.toolCall({ type: "tool-call", id: "call_1", name: "lookup", input: {} })).toBe(true)
    expect(ContentPart.is.toolResult({ type: "tool-call", id: "call_1", name: "lookup", input: {} })).toBe(false)
    expect(ResponseFormat.is.json({ type: "json", schema: { type: "object" } })).toBe(true)
    expect(ToolResultValue.is.error({ type: "error", value: "Nope" })).toBe(true)
    expect(LLMEvent.is.providerError({ type: "provider-error", message: "Nope" })).toBe(true)
  })

  test("LLMError exposes tagged error guards and matching", () => {
    const error = new InvalidRequestError({ message: "Bad request" })

    expect(LLMError.is.invalidRequest(error)).toBe(true)
    expect(LLMError.is.invalidRequestError(error)).toBe(true)
    expect(LLMError.guards["LLM.InvalidRequestError"](error)).toBe(true)
    expect(LLMError.match(error, {
      "LLM.InvalidRequestError": (value) => value.message,
      "LLM.NoAdapterError": (value) => value.protocol,
      "LLM.ProviderChunkError": (value) => value.adapter,
      "LLM.ProviderRequestError": (value) => String(value.status),
      "LLM.TransportError": (value) => value.reason ?? value.message,
    })).toBe("Bad request")
  })
})
