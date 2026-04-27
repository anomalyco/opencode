import { describe, expect, test } from "bun:test"
import { LLM, ProviderPatch } from "../src"
import { Model, Patch, context, plan } from "../src/patch"

const request = LLM.request({
  id: "req_1",
  model: LLM.model({
    id: "devstral-small",
    provider: "mistral",
    protocol: "openai-chat",
  }),
  prompt: "hi",
})

describe("llm patch", () => {
  test("constructors prefix ids and registry groups by phase", () => {
    const prompt = Patch.prompt("mistral.test", {
      reason: "test prompt",
      when: Model.provider("mistral"),
      apply: (request) => request,
    })
    const target = Patch.target("fake.test", {
      reason: "test target",
      apply: (draft: { value: number }) => draft,
    })

    const registry = Patch.registry([prompt, target])

    expect(prompt.id).toBe("prompt.mistral.test")
    expect(target.id).toBe("target.fake.test")
    expect(registry.prompt).toEqual([prompt])
    expect(registry.target.map((item) => item.id)).toEqual([target.id])
  })

  test("predicates compose", () => {
    const ctx = context({ request })

    expect(Model.provider("mistral").and(Model.protocol("openai-chat"))(ctx)).toBe(true)
    expect(Model.provider("anthropic").or(Model.idIncludes("devstral"))(ctx)).toBe(true)
    expect(Model.provider("mistral").not()(ctx)).toBe(false)
  })

  test("plan filters, sorts, applies, and traces deterministically", () => {
    const patches = [
      Patch.prompt("b", {
        reason: "second alphabetically",
        order: 1,
        apply: (request) => ({ ...request, metadata: { ...request.metadata, b: true } }),
      }),
      Patch.prompt("a", {
        reason: "first alphabetically",
        order: 1,
        apply: (request) => ({ ...request, metadata: { ...request.metadata, a: true } }),
      }),
      Patch.prompt("skip", {
        reason: "not selected",
        when: Model.provider("anthropic"),
        apply: (request) => ({ ...request, metadata: { ...request.metadata, skip: true } }),
      }),
    ]

    const patchPlan = plan({ phase: "prompt", context: context({ request }), patches })
    const output = patchPlan.apply(request)

    expect(patchPlan.trace.map((item) => item.id)).toEqual(["prompt.a", "prompt.b"])
    expect(output.metadata).toEqual({ a: true, b: true })
  })

  test("provider patch examples remove empty Anthropic content", () => {
    const input = LLM.request({
      id: "anthropic_empty",
      model: LLM.model({ id: "claude-sonnet", provider: "anthropic", protocol: "anthropic-messages" }),
      system: "",
      messages: [
        LLM.user([{ type: "text", text: "" }, { type: "text", text: "hello" }]),
        LLM.assistant({ type: "reasoning", text: "" }),
      ],
    })
    const output = plan({
      phase: "prompt",
      context: context({ request: input }),
      patches: [ProviderPatch.removeEmptyAnthropicContent],
    }).apply(input)

    expect(output.system).toEqual([])
    expect(output.messages).toHaveLength(1)
    expect(output.messages[0]?.content).toEqual([{ type: "text", text: "hello" }])
  })

  test("provider patch examples scrub model-specific tool call ids", () => {
    const input = LLM.request({
      id: "mistral_tool_ids",
      model: LLM.model({ id: "devstral-small", provider: "mistral", protocol: "openai-chat" }),
      messages: [
        LLM.assistant([LLM.toolCall({ id: "call.bad/value-long", name: "lookup", input: {} })]),
        LLM.toolMessage({ id: "call.bad/value-long", name: "lookup", result: "ok", resultType: "text" }),
      ],
    })
    const output = plan({
      phase: "prompt",
      context: context({ request: input }),
      patches: [ProviderPatch.scrubMistralToolIds],
    }).apply(input)

    expect(output.messages[0]?.content[0]).toMatchObject({ type: "tool-call", id: "callbadva" })
    expect(output.messages[1]?.content[0]).toMatchObject({ type: "tool-result", id: "callbadva" })
  })

  // Cache hint policy: mark first-2 system + last-2 messages with ephemeral
  // cache hints, gated on `model.capabilities.cache.prompt`. Adapters
  // (Anthropic, Bedrock) lower the hint to `cache_control` / `cachePoint`.
  describe("cachePromptHints", () => {
    const cacheCapableModel = (overrides: { provider: string; protocol: "anthropic-messages" | "bedrock-converse" }) =>
      LLM.model({
        id: "test-model",
        provider: overrides.provider,
        protocol: overrides.protocol,
        capabilities: LLM.capabilities({ cache: { prompt: true, contentBlocks: true } }),
      })

    const runCachePatch = (input: ReturnType<typeof LLM.request>) =>
      plan({
        phase: "prompt",
        context: context({ request: input }),
        patches: [ProviderPatch.cachePromptHints],
      }).apply(input)

    test("marks first 2 system parts with an ephemeral cache hint", () => {
      const input = LLM.request({
        id: "cache_system",
        model: cacheCapableModel({ provider: "anthropic", protocol: "anthropic-messages" }),
        system: ["First", "Second", "Third"].map(LLM.system),
        prompt: "hello",
      })
      const output = runCachePatch(input)

      expect(output.system).toHaveLength(3)
      expect(output.system[0]).toMatchObject({ text: "First", cache: { type: "ephemeral" } })
      expect(output.system[1]).toMatchObject({ text: "Second", cache: { type: "ephemeral" } })
      expect(output.system[2]).toMatchObject({ text: "Third" })
      expect(output.system[2]?.cache).toBeUndefined()
    })

    test("marks the last text part of the last 2 messages on cache-capable models", () => {
      const input = LLM.request({
        id: "cache_messages",
        model: cacheCapableModel({ provider: "anthropic", protocol: "anthropic-messages" }),
        messages: [
          LLM.user([{ type: "text", text: "m0" }]),
          LLM.user([{ type: "text", text: "m1" }]),
          LLM.user([{ type: "text", text: "m2" }]),
        ],
      })
      const output = runCachePatch(input)

      expect(output.messages).toHaveLength(3)
      // First message untouched.
      const first = output.messages[0].content[0]
      expect(first).toMatchObject({ type: "text", text: "m0" })
      expect("cache" in first ? first.cache : undefined).toBeUndefined()
      // Last 2 messages: cache on the (only) text part.
      expect(output.messages[1].content[0]).toMatchObject({ type: "text", text: "m1", cache: { type: "ephemeral" } })
      expect(output.messages[2].content[0]).toMatchObject({ type: "text", text: "m2", cache: { type: "ephemeral" } })
    })

    test("targets the last text part when a message has trailing non-text content", () => {
      const input = LLM.request({
        id: "cache_trailing_tool",
        model: cacheCapableModel({ provider: "anthropic", protocol: "anthropic-messages" }),
        messages: [
          LLM.assistant([
            { type: "text", text: "calling tool" },
            LLM.toolCall({ id: "call_1", name: "lookup", input: { q: "weather" } }),
          ]),
        ],
      })
      const output = runCachePatch(input)

      const content = output.messages[0].content
      expect(content[0]).toMatchObject({ type: "text", text: "calling tool", cache: { type: "ephemeral" } })
      expect(content[1]).toMatchObject({ type: "tool-call", id: "call_1" })
    })

    test("returns the message unchanged when it has no text part", () => {
      const input = LLM.request({
        id: "cache_no_text",
        model: cacheCapableModel({ provider: "anthropic", protocol: "anthropic-messages" }),
        messages: [
          LLM.toolMessage({ id: "call_1", name: "lookup", result: { ok: true } }),
        ],
      })
      const output = runCachePatch(input)

      expect(output.messages[0].content[0]).toMatchObject({ type: "tool-result", id: "call_1" })
      // No text part to mark, so the content array is identity-equal — the
      // `findLastIndex === -1` short-circuit avoids reallocating.
      expect(output.messages[0].content).toBe(input.messages[0].content)
    })

    test("is a no-op when the model does not advertise prompt caching", () => {
      const input = LLM.request({
        id: "cache_no_capability",
        model: LLM.model({
          id: "gpt-5",
          provider: "openai",
          protocol: "openai-responses",
          // capabilities.cache.prompt defaults to false
        }),
        system: ["A", "B"].map(LLM.system),
        messages: [LLM.user([{ type: "text", text: "hi" }])],
      })
      const output = runCachePatch(input)

      // Every text part should be free of cache hints.
      for (const part of output.system) expect(part.cache).toBeUndefined()
      for (const message of output.messages) {
        for (const part of message.content) {
          if (part.type === "text") expect(part.cache).toBeUndefined()
        }
      }
    })
  })
})
