import { describe, expect, test } from "bun:test"
import {
  cycleModelVariant,
  getConfiguredAgentVariant,
  getConfiguredModelVariant,
  resolveModelVariant,
} from "./model-variant"

describe("model variant", () => {
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

  test("infers configured model variant from matching options", () => {
    const value = getConfiguredModelVariant({
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
        options: { reasoningEffort: "high" },
        variants: { low: { reasoningEffort: "low" }, high: { reasoningEffort: "high" } },
      },
    })

    expect(value).toBe("high")
  })

  test("infers configured model variant when built-in variant adds extra defaults", () => {
    const value = getConfiguredModelVariant({
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
        options: { reasoningEffort: "high" },
        variants: {
          low: { reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
          high: { reasoningEffort: "high", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
        },
      },
    })

    expect(value).toBe("high")
  })

  test("infers configured model variant from nested options", () => {
    const value = getConfiguredModelVariant({
      model: {
        providerID: "google",
        modelID: "gemini-3",
        options: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } },
        variants: {
          low: { thinkingConfig: { thinkingLevel: "low", includeThoughts: true } },
          high: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } },
        },
      },
    })

    expect(value).toBe("high")
  })

  test("does not infer a variant from auxiliary defaults alone", () => {
    const value = getConfiguredModelVariant({
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
        options: { reasoningSummary: "auto" },
        variants: {
          low: { reasoningEffort: "low", reasoningSummary: "auto" },
          high: { reasoningEffort: "high", reasoningSummary: "auto" },
        },
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

  test("lets an explicit default override the inferred model variant", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "high",
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

  test("wraps from configured last variant to first", () => {
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
})
