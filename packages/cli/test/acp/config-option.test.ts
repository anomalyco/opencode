import { describe, expect, test } from "bun:test"
import { buildEffortSelectOption, parseModelSelection, type ConfigOptionProvider } from "../../src/acp/config-option"

const providers: ConfigOptionProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: [
      { id: "claude/sonnet-4", name: "Claude Sonnet 4", variants: ["default", "high", "very-high"] },
      { id: "claude-haiku", name: "Claude Haiku" },
    ],
  },
  { id: "openai", name: "OpenAI", models: [{ id: "gpt-5", name: "GPT-5", variants: ["minimal", "low"] }] },
]

describe("acp config options", () => {
  test("builds effort option from variants and falls back to default when current variant is invalid", () => {
    expect(buildEffortSelectOption({ variants: ["low", "default", "high"], currentVariant: "missing" })).toEqual({
      id: "effort",
      name: "Effort",
      description: "Available effort levels for this model",
      category: "thought_level",
      type: "select",
      currentValue: "default",
      options: [
        { value: "low", name: "Low" },
        { value: "default", name: "Default" },
        { value: "high", name: "High" },
      ],
    })
    expect(buildEffortSelectOption({ variants: ["minimal", "low"], currentVariant: "missing" }).currentValue).toBe(
      "minimal",
    )
  })

  test.each([
    ["openai/gpt-5", { model: { providerID: "openai", modelID: "gpt-5" } }],
    ["openai/gpt-5/low", { model: { providerID: "openai", modelID: "gpt-5" }, variant: "low" }],
    ["anthropic/claude/sonnet-4", { model: { providerID: "anthropic", modelID: "claude/sonnet-4" } }],
    [
      "anthropic/claude/sonnet-4/high",
      { model: { providerID: "anthropic", modelID: "claude/sonnet-4" }, variant: "high" },
    ],
    ["anthropic/claude/sonnet-4/missing", { model: { providerID: "anthropic", modelID: "claude/sonnet-4/missing" } }],
  ])("parses the model selection %s, preferring exact slash-containing model ids", (value, expected) => {
    expect(parseModelSelection(value, providers)).toEqual(expected)
  })
})
