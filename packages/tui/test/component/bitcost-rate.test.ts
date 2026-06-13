import { describe, expect, test } from "bun:test"
import { localRate, rateSummary } from "../../src/component/bitcost-rate"

describe("bitcost-rate.localRate", () => {
  test("undefined when there is no cost", () => {
    expect(localRate(undefined)).toBeUndefined()
  })

  test("undefined for an unpriced model (input & output both 0)", () => {
    expect(localRate({ input: 0, output: 0 })).toBeUndefined()
  })

  test("returns the base input/output rates", () => {
    expect(localRate({ input: 1.25, output: 10 })).toEqual({ input_price: 1.25, output_price: 10 })
  })
})

describe("bitcost-rate.rateSummary", () => {
  test("formats input and output rates", () => {
    expect(rateSummary({ input_price: 1.25, output_price: 10 })).toBe("$1.25 in · $10 out")
  })
})
