import { describe, expect, test } from "bun:test"
import { formatRef, parse, switchLabel } from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "invalid", modelID: "" })
  })

  test("includes the selected variant in model refs", () => {
    expect(formatRef({ providerID: "anthropic", id: "sonnet", variant: "thinking" })).toBe("anthropic/sonnet/thinking")
    expect(formatRef({ providerID: "anthropic", id: "sonnet" })).toBe("anthropic/sonnet")
  })

  test("includes the selected variant in model switch notices", () => {
    expect(switchLabel({ providerID: "anthropic", id: "sonnet", variant: "thinking" })).toBe(
      "Switched model to anthropic/sonnet/thinking",
    )
  })

  test("uses the catalog display name in model switch notices", () => {
    const models = [
      { providerID: "openai", id: "gpt-5.5-fast", name: "GPT-5.5 Fast" },
      { providerID: "anthropic", id: "sonnet", name: "Claude Sonnet" },
    ]
    expect(switchLabel({ providerID: "openai", id: "gpt-5.5-fast", variant: "high" }, models)).toBe(
      "Switched model to GPT-5.5 Fast (high)",
    )
    expect(switchLabel({ providerID: "anthropic", id: "sonnet" }, models)).toBe("Switched model to Claude Sonnet")
    expect(switchLabel({ providerID: "anthropic", id: "sonnet", variant: "default" }, models)).toBe(
      "Switched model to Claude Sonnet",
    )
    expect(switchLabel({ providerID: "removed", id: "gone", variant: "high" }, models)).toBe(
      "Switched model to removed/gone/high",
    )
  })
})
