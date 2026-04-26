import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ContentPart, LLMEvent, LLMRequest, ModelCapabilities, ModelID, ModelLimits, ModelRef, ProviderID } from "../src/schema"

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

  test("rejects invalid protocol", () => {
    expect(() =>
      Schema.decodeUnknownSync(LLMRequest)({
        model: { ...model, protocol: "bogus" },
        system: [],
        messages: [],
        tools: [],
        generation: {},
      }),
    ).toThrow()
  })

  test("rejects invalid event type", () => {
    expect(() => Schema.decodeUnknownSync(LLMEvent)({ type: "bogus" })).toThrow()
  })

  test("content part tagged union exposes guards", () => {
    expect(ContentPart.guards.text({ type: "text", text: "hi" })).toBe(true)
    expect(ContentPart.guards.media({ type: "text", text: "hi" })).toBe(false)
  })
})
