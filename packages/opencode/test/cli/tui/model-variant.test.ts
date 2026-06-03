import { describe, expect, test } from "bun:test"
import {
  cycleModelVariant,
  getConfiguredAgentVariant,
  migrateVariantSelection,
  resolveModelVariant,
} from "../../../src/cli/cmd/tui/context/model-variant"

describe("tui model variant", () => {
  test("resolves configured agent variant when model matches", () => {
    const value = getConfiguredAgentVariant({
      agent: {
        model: { providerID: "openai", modelID: "gpt-5.2" },
        variant: "xhigh",
      },
      model: {
        providerID: "openai",
        modelID: "gpt-5.2",
        variants: { low: {}, high: {}, xhigh: {} },
      },
    })

    expect(value).toBe("xhigh")
  })

  test("ignores configured variant when model does not match", () => {
    const value = getConfiguredAgentVariant({
      agent: {
        model: { providerID: "openai", modelID: "gpt-5.2" },
        variant: "xhigh",
      },
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variants: { low: {}, high: {}, xhigh: {} },
      },
    })

    expect(value).toBeUndefined()
  })

  test("prefers selected variant over configured variant", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: "high",
      configured: "xhigh",
    })

    expect(value).toBe("high")
  })

  test("lets an explicit default override the configured variant", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "xhigh",
    })

    expect(value).toBeUndefined()
  })

  test("cycles from configured variant to next", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: "high",
    })

    expect(value).toBe("xhigh")
  })

  test("cycles from configured last variant to first", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: "xhigh",
    })

    expect(value).toBe("low")
  })

  test("cycles from an explicit default to the first variant", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "xhigh",
    })

    expect(value).toBe("low")
  })

  test("ignores legacy model-keyed variant cache entries", () => {
    const value = migrateVariantSelection(
      {
        build: "high",
        big: null,
        "openai/gpt-5.4": "xhigh",
      },
      ["build", "big", "plan"],
    )

    expect(value).toEqual({
      build: "high",
      big: null,
    })
  })

  test("keeps agent names with slashes when they are known", () => {
    const value = migrateVariantSelection(
      {
        "custom/build": "high",
        "openai/gpt-5.4": "xhigh",
      },
      ["custom/build"],
    )

    expect(value).toEqual({
      "custom/build": "high",
    })
  })
})
