import { describe, expect, test } from "bun:test"
import { toModelAggregate } from "./inference"
import { modelAuthor, normalizeInferenceModel } from "./model-normalization"

describe("inference stat normalization", () => {
  test("normalizes model suffixes used by router/provider variants", () => {
    expect(normalizeInferenceModel("deepseek-v4-flash-free")).toBe("deepseek-v4-flash")
    expect(normalizeInferenceModel("deepseek-v4-flash:global")).toBe("deepseek-v4-flash")
    expect(normalizeInferenceModel("mimo-v2.5-free")).toBe("mimo-v2.5")
    expect(normalizeInferenceModel("nemotron-3-super-free")).toBe("nemotron-3-super")
    expect(normalizeInferenceModel("mimo-v2.5-free:global")).toBe("mimo-v2.5")
  })

  test("maps normalized model ids to public authors", () => {
    expect(modelAuthor("big-pickle")).toBe("opencode")
    expect(modelAuthor("claude-sonnet-4-5")).toBe("anthropic")
    expect(modelAuthor("deepseek-v4-pro")).toBe("deepseek")
    expect(modelAuthor("gemini-3.5-flash")).toBe("google")
    expect(modelAuthor("glm-5.1")).toBe("zhipu")
    expect(modelAuthor("gpt-5.5-pro")).toBe("openai")
    expect(modelAuthor("grok-build-0.1")).toBe("xai")
    expect(modelAuthor("hy3-preview")).toBe("tencent")
    expect(modelAuthor("kimi-k2.6")).toBe("moonshot")
    expect(modelAuthor("mimo-v2-omni")).toBe("xiaomi")
    expect(modelAuthor("minimax-m2.7")).toBe("minimax")
    expect(modelAuthor("nemotron-3-super-free")).toBe("nvidia")
    expect(modelAuthor("qwen3.7-max")).toBe("qwen")
    expect(modelAuthor("alpha-gpt-next")).toBeUndefined()
  })

  test("model aggregates ignore datalake provider and use normalized author/model", () => {
    expect(toModelAggregate(aggregate("alpha-gpt-next", "openai"))).toEqual([])

    expect(toModelAggregate(aggregate("deepseek-v4-flash-free", "not-public-provider"))).toMatchObject([
      {
        period_key: "2026-05-20",
        provider: "deepseek",
        model: "deepseek-v4-flash",
      },
    ])
  })

  test("model aggregates use ISO week period keys", () => {
    expect(
      toModelAggregate({
        ...aggregate("gpt-5.5-pro", "openai"),
        grain: "week",
        period_key: "2026-W20",
      }),
    ).toMatchObject([{ period_key: "2026-W20" }])
  })
})

function aggregate(model: string, provider: string) {
  return {
    grain: "day",
    period_key: "2026-05-20",
    dataset: "zen",
    tier: "Paid",
    provider,
    model,
    sessions: "1",
    requests: "1",
    sample_count: "1",
  }
}
