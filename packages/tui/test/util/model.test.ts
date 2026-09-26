import { describe, expect, test } from "bun:test"
import { parse, contextLimit } from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "invalid", modelID: "" })
  })

  test("contextLimit returns input limit when available", () => {
    const model = { limit: { context: 400_000, input: 272_000, output: 128_000 } }
    expect(contextLimit(model)).toBe(272_000)
  })

  test("contextLimit falls back to context limit when input is 0", () => {
    const model = { limit: { context: 200_000, input: 0, output: 32_000 } }
    expect(contextLimit(model)).toBe(200_000)
  })

  test("contextLimit falls back to context limit when input is undefined", () => {
    const model = { limit: { context: 1_000_000, output: 128_000 } }
    expect(contextLimit(model)).toBe(1_000_000)
  })

  test("contextLimit returns undefined for undefined model", () => {
    expect(contextLimit(undefined)).toBeUndefined()
  })

  test("contextLimit returns undefined when both limits are 0", () => {
    const model = { limit: { context: 0, output: 0 } }
    expect(contextLimit(model)).toBeUndefined()
  })
})
