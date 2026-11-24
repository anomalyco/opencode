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

  test("reads a switch between a model's speeds as a change of speed", () => {
    const fast = { base: "gpt-5.5", id: "fast" }
    const models = [
      { providerID: "openai", id: "gpt-5.5", name: "GPT-5.5" },
      { providerID: "openai", id: "gpt-5.5-fast", name: "GPT-5.5 Fast", experimental: { speed: fast } },
      {
        providerID: "openai",
        id: "gpt-5.5-flex",
        name: "GPT-5.5 Flex",
        experimental: { speed: { ...fast, id: "flex" } },
      },
      { providerID: "openai", id: "gpt-6", name: "GPT-6" },
    ]
    const ref = (id: string) => ({ providerID: "openai", id })

    expect(switchLabel(ref("gpt-5.5-fast"), models, ref("gpt-5.5"))).toBe("Switched speed to fast")
    expect(switchLabel(ref("gpt-5.5-flex"), models, ref("gpt-5.5-fast"))).toBe("Switched speed to flex")
    expect(switchLabel(ref("gpt-5.5"), models, ref("gpt-5.5-fast"))).toBe("Switched speed to standard")
    expect(switchLabel(ref("gpt-5.5-fast"), models, ref("gpt-6"))).toBe("Switched model to GPT-5.5 Fast")
  })
})
