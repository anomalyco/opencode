import { describe, expect, test } from "bun:test"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./variant"

const variants = ["low", "high", "xhigh"]

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
    { name: "prefers the selected variant over configuration", selected: "high", expected: "high" },
    { name: "lets an explicit default override configuration", selected: null, expected: undefined },
  ])("resolve $name", ({ selected, expected }) => {
    expect(resolveModelVariant({ variants, selected, configured: "xhigh" })).toBe(expected)
  })

  test.each([
    { name: "a configured variant to the next", selected: undefined, configured: "high", expected: "xhigh" },
    { name: "the configured last variant to default", selected: undefined, configured: "xhigh", expected: undefined },
    { name: "an explicit default to the first variant", selected: null, configured: "xhigh", expected: "low" },
  ])("cycles from $name", ({ selected, configured, expected }) => {
    expect<string | undefined>(cycleModelVariant({ variants, selected, configured })).toBe(expected)
  })

  test("prefers a saved variant to configuration, including explicit Default", () => {
    const input = { variants: ["low", "high"], selected: undefined, configured: "high" }
    expect(resolveModelVariant({ ...input, preferred: "low" })).toBe("low")
    expect(resolveModelVariant({ ...input, preferred: "default" })).toBeUndefined()
    expect(resolveModelVariant({ ...input, preferred: "low", selected: null })).toBeUndefined()
    expect(resolveModelVariant({ ...input, preferred: "low", selected: "high" })).toBe("high")
    expect(cycleModelVariant({ ...input, preferred: "high" })).toBeUndefined()
    expect(cycleModelVariant({ ...input, preferred: "default" })).toBe("low")
  })

  test("normalizes unavailable selections instead of silently applying another variant", () => {
    expect(resolveModelVariant({ variants: ["low"], selected: "high", configured: "low" })).toBeUndefined()
    expect(
      resolveModelVariant({ variants: ["low"], selected: undefined, preferred: "high", configured: "low" }),
    ).toBeUndefined()
    expect(cycleModelVariant({ variants: [], selected: undefined, configured: undefined })).toBeUndefined()
  })
})
