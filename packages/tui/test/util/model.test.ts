import { describe, expect, test } from "bun:test"
import { formatRef, parse, switchLabel } from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "", modelID: "" })
  })

  test("parses variant from model identifier if present", () => {
    expect(parse("anthropic/claude-3-5-sonnet#thinking")).toEqual({
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet",
      variant: "thinking",
    })
    expect(parse("openrouter/anthropic/claude-3.5-sonnet#high")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-3.5-sonnet",
      variant: "high",
    })
  })

  test("rejects empty variants and extra separators as invalid", () => {
    expect(parse("provider/model#")).toEqual({ providerID: "", modelID: "" })
    expect(parse("provider/mo#de#l")).toEqual({ providerID: "", modelID: "" })
    expect(parse("openai/gpt-5#high#extra")).toEqual({ providerID: "", modelID: "" })
  })

  test("handles undefined, null, non-string, and empty model identifiers safely", () => {
    expect(parse(undefined as any)).toEqual({ providerID: "", modelID: "" })
    expect(parse(null as any)).toEqual({ providerID: "", modelID: "" })
    expect(parse({} as any)).toEqual({ providerID: "", modelID: "" })
    expect(parse(true as any)).toEqual({ providerID: "", modelID: "" })
    expect(parse("")).toEqual({ providerID: "", modelID: "" })
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

  test("distinguishes variant-only switches from model switches", () => {
    const previous = { providerID: "openai", id: "gpt-5.5", variant: "medium" }

    expect(switchLabel({ ...previous, variant: "high" }, undefined, previous)).toBe("Switched variant to high")
    expect(switchLabel({ providerID: "openai", id: "gpt-5.5" }, undefined, previous)).toBe(
      "Switched variant to default",
    )
    expect(switchLabel({ providerID: "anthropic", id: "sonnet", variant: "high" }, undefined, previous)).toBe(
      "Switched model to anthropic/sonnet/high",
    )
  })

  test("handles empty or invalid model in switchLabel safely", () => {
    expect(switchLabel(undefined as any)).toBe("")
    expect(switchLabel({} as any)).toBe("")
    expect(switchLabel({ providerID: "anthropic" } as any)).toBe("")
  })
})
