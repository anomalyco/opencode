import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import * as OpenAIChat from "../src/protocols/openai-chat"
import * as OpenAIResponses from "../src/protocols/openai-responses"
import { ContentPart, LLMEvent, LLMRequest, Model, ModelID, ProviderID, Usage } from "../src/schema"
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
