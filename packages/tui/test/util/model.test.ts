import { describe, expect, test } from "bun:test"
import { contextLimit, contextPercent, parse } from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "invalid", modelID: "" })
  })

  test("uses the input limit when present for context display", () => {
    const splitWindow = { limit: { context: 400_000, input: 272_000, output: 128_000 } }
    const sharedWindow = { limit: { context: 200_000, output: 8_192 } }

    expect(contextLimit(splitWindow)).toBe(272_000)
    expect(contextPercent(270_000, splitWindow)).toBe(99)
    expect(contextLimit(sharedWindow)).toBe(200_000)
    expect(contextPercent(100_000, sharedWindow)).toBe(50)
  })
})
