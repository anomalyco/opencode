import { describe, expect, test } from "bun:test"
import { Currency } from "@opencode-ai/core/currency"

describe("currency", () => {
  test("identity conversion returns the amount unchanged", () => {
    expect(Currency.convert(1.5, "USD", "USD")).toBe(1.5)
  })

  test("identity conversion ignores case and whitespace", () => {
    expect(Currency.convert(2.25, " usd ", "USD")).toBe(2.25)
  })

  test("converts between builtin rates", () => {
    expect(Currency.convert(1.5, "USD", "CNY")).toBeCloseTo(1.5 * 7.15, 10)
  })

  test("converts via USD cross rate", () => {
    expect(Currency.convert(10, "EUR", "CNY")).toBeCloseTo((10 / 0.86) * 7.15, 10)
  })

  test("normalizes currency codes", () => {
    expect(Currency.convert(1, " cny ", "usd")).toBeCloseTo(1 / 7.15, 10)
  })

  test("overrides take precedence over builtin rates", () => {
    expect(Currency.convert(1.5, "USD", "CNY", { CNY: 7.2 })).toBeCloseTo(1.5 * 7.2, 10)
  })

  test("overrides can introduce currencies missing from the builtin table", () => {
    expect(Currency.convert(2, "USD", "BTC", { BTC: 0.00001 })).toBeCloseTo(0.00002, 12)
  })

  test("override lookup ignores key casing", () => {
    expect(Currency.convert(1.5, "USD", "CNY", { cny: 7.2 })).toBeCloseTo(1.5 * 7.2, 10)
  })

  test("returns undefined when a rate is unknown", () => {
    expect(Currency.convert(1, "USD", "XYZ")).toBeUndefined()
    expect(Currency.convert(1, "XYZ", "USD")).toBeUndefined()
  })

  test("returns undefined when the source currency is missing or empty", () => {
    expect(Currency.convert(1, "", "USD")).toBeUndefined()
    expect(Currency.convert(1, "   ", "CNY")).toBeUndefined()
  })

  test("an invalid override disables conversion instead of falling back", () => {
    expect(Currency.convert(1, "USD", "CNY", { CNY: 0 })).toBeUndefined()
    expect(Currency.convert(1, "USD", "CNY", { CNY: -7 })).toBeUndefined()
    expect(Currency.convert(1, "USD", "CNY", { CNY: Number.NaN })).toBeUndefined()
  })

  test("invalid overrides do not introduce unknown currencies", () => {
    expect(Currency.convert(1, "USD", "XYZ", { XYZ: 0 })).toBeUndefined()
  })

  test("rate resolves overrides before builtin table", () => {
    expect(Currency.rate("CNY")).toBe(7.15)
    expect(Currency.rate("CNY", { CNY: 7.2 })).toBe(7.2)
    expect(Currency.rate("CNY", { CNY: 0 })).toBeUndefined()
    expect(Currency.rate("XYZ")).toBeUndefined()
  })

  test("formats amounts with the currency symbol", () => {
    expect(Currency.format(10.8, "CNY")).toContain("10.8")
    expect(Currency.format(10.8, "USD")).toContain("10.8")
  })

  test("format falls back to a plain label for codes Intl rejects", () => {
    expect(Currency.format(1.234, "X")).toBe("1.23 X")
  })
})
