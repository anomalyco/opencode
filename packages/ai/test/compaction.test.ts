import { expect, test } from "bun:test"
import { Schema } from "effect"
import { CompactionPart, CompactionResponse, LLMEvent, LLMResponse, Message, ProviderID } from "../src/schema/index.js"
import { LLM, LLMClient, LLMRequest, LanguageModel } from "../src/index.js"
import { OpenAI, Anthropic } from "../src/providers.js"

test("runtime capability checks follow model and route updates", () => {
  const supported = OpenAI.configure({ apiKey: "test" }).responses("fixture")
  const unsupported = Anthropic.configure({ apiKey: "test" }).model("fixture")
  const request = LLM.request({ model: supported, prompt: "hello" })
  expect(LLMClient.canCompact(request)).toBe(true)
  expect(LLMClient.canCompact(LLMRequest.update(request, { messages: [] }))).toBe(true)
  expect(LLMClient.canCompact(LLMRequest.update(request, { model: unsupported }))).toBe(false)
  expect(
    LLMClient.canCompact(LLM.request({ model: LanguageModel.update(supported, { route: unsupported.route }) })),
  ).toBe(false)
  expect(LLMClient.canCompact(LLM.request({ model: LanguageModel.update(supported, { route: undefined }) }))).toBe(true)
})

test("explicit compaction serializes a replacement window without a messages alias", () => {
  const response = new CompactionResponse({
    replacement: [
      Message.user("retained input"),
      Message.assistant(CompactionPart.make({ provider: ProviderID.make("openai"), encrypted: "checkpoint" })),
    ],
  })
  const codec = Schema.fromJsonString(CompactionResponse)
  const decoded = Schema.decodeSync(codec)(Schema.encodeSync(codec)(response))
  expect(decoded.replacement).toEqual(response.replacement)
  expect("messages" in decoded).toBe(false)
})

test("compaction survives event assembly and message serialization without becoming text", () => {
  const part = CompactionPart.make({
    provider: ProviderID.make("openai"),
    id: "cmp_1",
    encrypted: "opaque",
  })
  const response = LLMResponse.fromEvents([
    LLMEvent.textStart({ id: "before" }),
    LLMEvent.textDelta({ id: "before", text: "Before" }),
    LLMEvent.textEnd({ id: "before" }),
    part,
    LLMEvent.textStart({ id: "after" }),
    LLMEvent.textDelta({ id: "after", text: "After" }),
    LLMEvent.textEnd({ id: "after" }),
    LLMEvent.finish({ reason: { normalized: "stop" } }),
  ])!
  expect(response.message.content.map((part) => part.type)).toEqual(["text", "compaction", "text"])
  expect(response.text).toBe("BeforeAfter")
  expect(response.reasoning).toBe("")
  expect(response.events.filter(LLMEvent.is.compaction)).toEqual([part])
  const codec = Schema.fromJsonString(Message)
  expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(response.message))).toEqual(response.message)
})

test("compaction requires exactly one typed representation", () => {
  const provider = ProviderID.make("anthropic")
  expect(CompactionPart.make({ provider, text: null })).toEqual({ type: "compaction", provider, text: null })
  const decode = Schema.decodeUnknownSync(CompactionPart)
  expect(() => decode({ type: "compaction", provider })).toThrow()
  expect(() => decode({ type: "compaction", provider, text: "summary", encrypted: "opaque" })).toThrow()
})

test("tagged content and event guards accept both checkpoint representations", () => {
  for (const part of [
    CompactionPart.make({ provider: ProviderID.make("openai"), encrypted: "opaque" }),
    CompactionPart.make({ provider: ProviderID.make("anthropic"), text: "summary" }),
    CompactionPart.make({ provider: ProviderID.make("anthropic"), text: null }),
  ]) {
    expect(LLMEvent.is.compaction(part)).toBe(true)
    expect(LLMEvent.guards.compaction(part)).toBe(true)
    const codec = Schema.fromJsonString(Message)
    const message = Message.assistant(part)
    expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(message))).toEqual(message)
  }
})
