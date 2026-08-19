import { describe, expect, test } from "bun:test"
import {
  cycleModelVariant,
  getConfiguredAgentVariant,
  resolveModelVariant,
  resolveModelVariantForRequest,
  resolveModelVariantFromMessage,
} from "../../src/util/model-variant"

describe("model variant", () => {
  test("resolves configured agent variant when model matches", () => {
    const value = getConfiguredAgentVariant({
      configured: {
        providerID: "openai",
        id: "gpt-5.2",
        variant: "xhigh",
      },
      model: {
        providerID: "openai",
        id: "gpt-5.2",
        variants: { low: {}, high: {}, xhigh: {} },
      },
    })

    expect(value).toBe("xhigh")
  })

  test("ignores configured variant when model does not match", () => {
    const value = getConfiguredAgentVariant({
      configured: {
        providerID: "openai",
        id: "gpt-5.2",
        variant: "xhigh",
      },
      model: {
        providerID: "anthropic",
        id: "claude-sonnet-4",
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

  test("cycles through all variants from explicit selection", () => {
    const variants = ["low", "high", "xhigh"]
    const first = cycleModelVariant({ variants, selected: undefined, configured: undefined })
    const second = cycleModelVariant({ variants, selected: first, configured: undefined })
    const third = cycleModelVariant({ variants, selected: second, configured: undefined })
    const fourth = cycleModelVariant({ variants, selected: third, configured: undefined })

    expect(first).toBe("low")
    expect(second).toBe("high")
    expect(third).toBe("xhigh")
    expect(fourth).toBeUndefined()
  })

  test("sends explicit default as request sentinel", () => {
    const value = resolveModelVariantForRequest({ selected: null, current: undefined })

    expect(value).toBe("default")
  })

  test("keeps current variant for requests without explicit default", () => {
    const value = resolveModelVariantForRequest({ selected: undefined, current: "xhigh" })

    expect(value).toBe("xhigh")
  })

  test("restores explicit default from message sentinel", () => {
    const value = resolveModelVariantFromMessage({ variant: "default", configured: "high" })

    expect(value).toBeNull()
  })

  test("keeps absent message variant as inherit", () => {
    const value = resolveModelVariantFromMessage({ variant: undefined, configured: "high" })

    expect(value).toBeUndefined()
  })

  test("restores a configured message variant as inherit", () => {
    const value = resolveModelVariantFromMessage({ variant: "high", configured: "high" })

    expect(value).toBeUndefined()
  })

  test("restores a non-configured message variant as an override", () => {
    const value = resolveModelVariantFromMessage({ variant: "high", configured: "low" })

    expect(value).toBe("high")
  })
})
