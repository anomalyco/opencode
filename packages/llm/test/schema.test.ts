import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  ContentPart,
  LLMEvent,
  LLMRequest,
  ModelID,
  ModelLimits,
  ModelRef,
  ProviderID,
} from "../src/schema"

const model = new ModelRef({
  id: ModelID.make("fake-model"),
  provider: ProviderID.make("fake-provider"),
  route: "openai-chat",
  baseURL: "https://fake.local",
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

  test("accepts custom route ids", () => {
    const decoded = Schema.decodeUnknownSync(LLMRequest)({
      model: { ...model, route: "custom-route" },
      system: [],
      messages: [],
      tools: [],
      generation: {},
    })

    expect(decoded.model.route).toBe("custom-route")
  })

  test("rejects invalid event type", () => {
    expect(() => Schema.decodeUnknownSync(LLMEvent)({ type: "bogus" })).toThrow()
  })

  test("content part tagged union exposes guards", () => {
    expect(ContentPart.guards.text({ type: "text", text: "hi" })).toBe(true)
    expect(ContentPart.guards.media({ type: "text", text: "hi" })).toBe(false)
  })
})
