import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import type { Catalog } from "../../src/acp/catalog"
import { configOptions, parseModelSelection } from "../../src/acp/config-option"

const model = (providerID: string, id: string, name: string, variants: string[] = []) => ({
  ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
  name,
  variants: variants.map((variant) => ({ id: Model.VariantID.make(variant) })),
})

const catalog: Catalog = {
  models: [
    model("anthropic", "claude/sonnet-4", "Claude Sonnet 4", ["default", "high", "very-high"]),
    model("anthropic", "claude-haiku", "Claude Haiku"),
    model("openai", "gpt-5", "GPT-5", ["minimal", "low"]),
    model("test", "effort", "Effort", ["low", "default", "high"]),
  ],
  defaultModel: { providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") },
  modes: [{ id: Agent.ID.make("build"), name: "Build" }],
  defaultModeID: Agent.ID.make("build"),
  commands: [],
}

const effortOption = (providerID: string, id: string) =>
  configOptions(catalog, {
    model: {
      providerID: Provider.ID.make(providerID),
      id: Model.ID.make(id),
      variant: Model.VariantID.make("missing"),
    },
  }).find((option) => option.id === "effort")

describe("acp config options", () => {
  test("builds effort option from variants and falls back to default when current variant is invalid", () => {
    expect(effortOption("test", "effort")).toEqual({
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
    expect(effortOption("openai", "gpt-5")?.currentValue).toBe("minimal")
  })

  test.each([
    ["openai/gpt-5", { providerID: Provider.ID.openai, id: Model.ID.make("gpt-5") }],
    [
      "openai/gpt-5/low",
      { providerID: Provider.ID.openai, id: Model.ID.make("gpt-5"), variant: Model.VariantID.make("low") },
    ],
    ["anthropic/claude/sonnet-4", { providerID: Provider.ID.anthropic, id: Model.ID.make("claude/sonnet-4") }],
    [
      "anthropic/claude/sonnet-4/high",
      {
        providerID: Provider.ID.anthropic,
        id: Model.ID.make("claude/sonnet-4"),
        variant: Model.VariantID.make("high"),
      },
    ],
    [
      "anthropic/claude/sonnet-4/missing",
      { providerID: Provider.ID.anthropic, id: Model.ID.make("claude/sonnet-4/missing") },
    ],
  ])("parses the model selection %s, preferring exact slash-containing model ids", (value, expected) => {
    expect(parseModelSelection(value, catalog.models)).toEqual(expected)
  })
})
