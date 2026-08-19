import { describe, expect, test } from "bun:test"
import { modelHasPricing } from "../../src/feature-plugins/sidebar/cost"

describe("modelHasPricing", () => {
  test("returns false when the model is undefined", () => {
    expect(modelHasPricing(undefined)).toBe(false)
  })

  test("returns false when the model has no cost entry", () => {
    expect(modelHasPricing({} as never)).toBe(false)
  })

  test("returns false when input and output are zero", () => {
    expect(modelHasPricing({ cost: { input: 0, output: 0, cache: { read: 0, write: 0 } } } as never)).toBe(false)
  })

  test("returns true when input is non-zero", () => {
    expect(
      modelHasPricing({ cost: { input: 0.14, output: 0, cache: { read: 0.028, write: 0 } } } as never),
    ).toBe(true)
  })

  test("returns true when output is non-zero", () => {
    expect(
      modelHasPricing({ cost: { input: 0, output: 0.28, cache: { read: 0, write: 0 } } } as never),
    ).toBe(true)
  })

  test("returns false when only cache pricing is non-zero", () => {
    expect(
      modelHasPricing({ cost: { input: 0, output: 0, cache: { read: 0.028, write: 0 } } } as never),
    ).toBe(false)
  })
})
