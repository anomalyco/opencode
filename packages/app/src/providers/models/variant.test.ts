import { describe, expect, test } from "bun:test"
import {
  cycleModelVariant,
  DEFAULT_VARIANT,
  durableVariantSelection,
  getConfiguredAgentVariant,
  INHERIT_VARIANT,
  resolveModelVariant,
  variantSelectionFrom,
} from "./variant"

const variants = ["low", "high", "xhigh"]

const named = (value: string) => ({ type: "named", value }) as const

describe("model variant", () => {
  test.each([
    { name: "applies when the model matches", providerID: "openai", modelID: "gpt-5.2", expected: "xhigh" },
    { name: "is ignored for another model", providerID: "anthropic", modelID: "claude-sonnet-4", expected: undefined },
  ])("the configured agent variant $name", ({ providerID, modelID, expected }) => {
    const value = getConfiguredAgentVariant({
      agent: { model: { providerID: "openai", modelID: "gpt-5.2" }, variant: "xhigh" },
      model: { providerID, modelID, variants: { low: {}, high: {}, xhigh: {} } },
    })

    expect(value).toBe(expected)
  })

  test.each([
    { name: "prefers the selected variant over configuration", selected: named("high"), expected: "high" },
    { name: "lets an explicit default override configuration", selected: DEFAULT_VARIANT, expected: undefined },
  ])("resolve $name", ({ selected, expected }) => {
    expect(resolveModelVariant({ variants, selected, configured: "xhigh" })).toBe(expected)
  })

  test.each([
    { name: "a configured variant to the next", selected: INHERIT_VARIANT, configured: "high", expected: "xhigh" },
    {
      name: "the configured last variant to default",
      selected: INHERIT_VARIANT,
      configured: "xhigh",
      expected: undefined,
    },
    { name: "an explicit default to the first variant", selected: DEFAULT_VARIANT, configured: "xhigh", expected: "low" },
  ])("cycles from $name", ({ selected, configured, expected }) => {
    expect<string | undefined>(cycleModelVariant({ variants, selected, configured })).toBe(expected)
  })

  test("prefers a saved variant to configuration, including explicit Default", () => {
    const input = { variants: ["low", "high"], selected: INHERIT_VARIANT, configured: "high" }
    expect(resolveModelVariant({ ...input, preferred: "low" })).toBe("low")
    expect(resolveModelVariant({ ...input, preferred: "default" })).toBeUndefined()
    expect(resolveModelVariant({ ...input, preferred: "low", selected: DEFAULT_VARIANT })).toBeUndefined()
    expect(resolveModelVariant({ ...input, preferred: "low", selected: named("high") })).toBe("high")
    expect(cycleModelVariant({ ...input, preferred: "high" })).toBeUndefined()
    expect(cycleModelVariant({ ...input, preferred: "default" })).toBe("low")
  })

  test("normalizes unavailable selections instead of silently applying another variant", () => {
    expect(resolveModelVariant({ variants: ["low"], selected: named("high"), configured: "low" })).toBeUndefined()
    expect(
      resolveModelVariant({ variants: ["low"], selected: INHERIT_VARIANT, preferred: "high", configured: "low" }),
    ).toBeUndefined()
    expect(cycleModelVariant({ variants: [], selected: INHERIT_VARIANT, configured: undefined })).toBeUndefined()
  })

  test("reads the prompt mirror's null as the explicit Default and a committed absence as Default too", () => {
    expect(variantSelectionFrom(null)).toEqual(DEFAULT_VARIANT)
    expect(variantSelectionFrom(undefined)).toEqual(INHERIT_VARIANT)
    expect(variantSelectionFrom("high")).toEqual(named("high"))
    expect(durableVariantSelection(undefined)).toEqual(DEFAULT_VARIANT)
    expect(durableVariantSelection("high")).toEqual(named("high"))
  })
})
