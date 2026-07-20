import { describe, expect, test } from "bun:test"
import {
  buildConfigOptions,
  formatVariantName,
  parseModelSelection,
  type ConfigOptionProvider,
} from "../../src/acp/config-option"

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
  test("builds model, effort, and mode options", () => {
    const options = buildConfigOptions({
      providers,
      currentModel: { providerID: "anthropic", modelID: "claude/sonnet-4" },
      currentVariant: "high",
      modes: [
        { id: "build", name: "Build" },
        { id: "plan", name: "Plan" },
      ],
      currentModeId: "build",
    })
    expect(options.map((option) => option.id)).toEqual(["model", "effort", "mode"])
    expect(options[0]?.currentValue).toBe("anthropic/claude/sonnet-4")
    expect(options[1]?.currentValue).toBe("high")
  })

  test("parses slash-containing model ids before variants", () => {
    expect(parseModelSelection("anthropic/claude/sonnet-4", providers)).toEqual({
      model: { providerID: "anthropic", modelID: "claude/sonnet-4" },
    })
    expect(parseModelSelection("anthropic/claude/sonnet-4/high", providers)).toEqual({
      model: { providerID: "anthropic", modelID: "claude/sonnet-4" },
      variant: "high",
    })
  })

  test("formats variant names", () => {
    expect(formatVariantName("very_high-effort")).toBe("Very High Effort")
  })
})
