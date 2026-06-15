import { describe, expect, test } from "bun:test"
import { CostDisplay } from "./cost-display"

describe("CostDisplay", () => {
  test("formats USD by default", () => {
    expect(CostDisplay.format("en", 1.25)).toBe("$1.25")
  })

  test("formats configured CNY cost with the yuan symbol", () => {
    expect(CostDisplay.format("zh-Hans", 1.25, { currency: "CNY" })).toBe("¥9.00")
  })

  test("uses configured display currency rate", () => {
    expect(CostDisplay.format("zh-Hans", 1.25, { currency: "CNY", currency_rate: 7 })).toBe("¥8.75")
  })

  test("ignores display currency rate when currency is not configured", () => {
    expect(CostDisplay.format("en", 1.25, { currency_rate: 7 })).toBe("$1.25")
  })

  test("formats configured CNY source cost without converting again", () => {
    expect(CostDisplay.format("zh-Hans", 1.25, { cost_currency: "CNY", currency: "CNY" })).toBe("¥1.25")
  })

  test("converts configured CNY source cost to USD", () => {
    expect(CostDisplay.format("en", 7.2, { cost_currency: "CNY", currency: "USD" })).toBe("$1.00")
  })
})
