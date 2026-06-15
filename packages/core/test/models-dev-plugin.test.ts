import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { variants } from "@opencode-ai/core/plugin/models-dev"

const model = (input: Partial<ModelsDev.Model> & { id: string }): ModelsDev.Model => ({
  name: input.id,
  release_date: "2026-01-01",
  attachment: false,
  reasoning: true,
  temperature: true,
  tool_call: true,
  limit: { context: 200_000, output: 64_000 },
  ...input,
})

describe("ModelsDevPlugin reasoning_options", () => {
  test("generates anthropic effort variants as semantic thinking + effort options", () => {
    const result = variants(
      model({
        id: "claude-sonnet-4-6",
        reasoning_options: [
          { type: "effort", values: ["low", "medium", "high", "max"] },
          { type: "budget_tokens", min: 1024 },
        ],
      }),
      "anthropic",
      "@ai-sdk/anthropic",
    )

    expect(result.map((variant) => variant.id)).toEqual(
      ["low", "medium", "high", "max"].map((id) => ModelV2.VariantID.make(id)),
    )
    expect(result[2]).toMatchObject({
      id: "high",
      headers: {},
      body: {},
      options: { thinking: { type: "adaptive" }, effort: "high" },
    })
  })

  test("merges effort variants after curated experimental modes, skipping null values and collisions", () => {
    const result = variants(
      model({
        id: "deepseek-v4",
        reasoning_options: [{ type: "toggle" }, { type: "effort", values: [null, "high", "max"] }],
        experimental: {
          modes: {
            high: { provider: { body: { reasoning_effort: "high", custom: true } } },
          },
        },
      }),
      "compat",
      "@ai-sdk/openai-compatible",
    )

    expect(result.map((variant) => variant.id)).toEqual(["high", "max"].map((id) => ModelV2.VariantID.make(id)))
    expect(result[0]).toMatchObject({
      id: "high",
      body: { custom: true },
      options: { reasoningEffort: "high" },
    })
    expect(result[1]).toMatchObject({
      id: "max",
      body: {},
      options: { reasoningEffort: "max" },
    })
  })
})
