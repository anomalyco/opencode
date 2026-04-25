import { describe, expect, test } from "bun:test"
import { LLM, ProviderPatch } from "../src"
import { Model, Patch, Request, context, plan } from "../src/patch"

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
    const ctx = context({ request, small: true, flags: { experimental: true } })

    expect(Model.provider("mistral").and(Request.small())(ctx)).toBe(true)
    expect(Model.provider("anthropic").or(Model.idIncludes("devstral"))(ctx)).toBe(true)
    expect(Request.flag("experimental").not()(ctx)).toBe(false)
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
})
