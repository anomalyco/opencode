import { describe, expect, test } from "bun:test"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

function model(id: string, extra?: Partial<Provider.Model>) {
  return {
    providerID: "local",
    api: { id, url: "http://localhost:8080/v1", npm: "@ai-sdk/openai-compatible" },
    ...extra,
  } as Provider.Model
}

describe("provider.transform tier sampling", () => {
  test("per-model config sampling wins over the substring ladders", () => {
    const configured = model("qwen3.6-35b-a3b", { sampling: { temperature: 0.7, topP: 0.8, topK: 50 } })
    expect(ProviderTransform.temperature(configured)).toBe(0.7)
    expect(ProviderTransform.topP(configured)).toBe(0.8)
    expect(ProviderTransform.topK(configured)).toBe(50)
  })

  test("minimal tier pins the llama.cpp launch tuning", () => {
    const minimal = model("qwen3.5-4b")
    expect(ProviderTransform.temperature(minimal)).toBe(0.1)
    expect(ProviderTransform.topP(minimal)).toBe(0.95)
    expect(ProviderTransform.topK(minimal)).toBe(20)
  })

  test("default tier falls back to tier defaults only when the ladder has no entry", () => {
    const unknown = model("some-model-35b")
    expect(ProviderTransform.temperature(unknown)).toBe(0.1)
    expect(ProviderTransform.topP(unknown)).toBe(0.95)
    expect(ProviderTransform.topK(unknown)).toBe(20)

    // ladder entries stay authoritative for default-tier models they know
    expect(ProviderTransform.temperature(model("glm-4.6"))).toBe(1.0)
    expect(ProviderTransform.temperature(model("qwen3.6-35b-a3b"))).toBe(0.55)
    expect(ProviderTransform.topP(model("qwen3.6-35b-a3b"))).toBe(1)

    // bare fall-through models without size evidence keep ladder output untouched
    expect(ProviderTransform.temperature(model("deepseek-v4-flash"))).toBeUndefined()
    expect(ProviderTransform.topK(model("deepseek-v4-flash"))).toBeUndefined()
    // explicit config tier is positive evidence
    expect(ProviderTransform.temperature(model("deepseek-v4-flash", { tier: "default" }))).toBe(0.1)
  })

  test("frontier ladder output is unchanged", () => {
    expect(ProviderTransform.temperature(model("claude-sonnet-4-5"))).toBeUndefined()
    expect(ProviderTransform.topP(model("claude-sonnet-4-5"))).toBeUndefined()
    expect(ProviderTransform.topK(model("claude-sonnet-4-5"))).toBeUndefined()
    expect(ProviderTransform.temperature(model("gemini-2.5-pro"))).toBe(1.0)
    expect(ProviderTransform.topP(model("gemini-2.5-pro"))).toBe(0.95)
    expect(ProviderTransform.topK(model("gemini-2.5-pro"))).toBe(64)
    expect(ProviderTransform.temperature(model("kimi-k2"))).toBe(0.6)
    expect(ProviderTransform.temperature(model("kimi-k2-thinking"))).toBe(1.0)
    expect(ProviderTransform.temperature(model("gpt-5.2"))).toBeUndefined()
  })

  test("config-declared options reach the openai-compatible providerOptions namespace", () => {
    const result = ProviderTransform.providerOptions(model("qwen3.5-4b"), {
      chat_template_kwargs: { enable_thinking: false },
      reasoning: { effort: "low" },
    })
    expect(result).toEqual({
      local: {
        chat_template_kwargs: { enable_thinking: false },
        reasoning: { effort: "low" },
      },
    })
  })
})
