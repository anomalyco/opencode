import { describe, expect, test } from "bun:test"
import { createSessionContextFormatter } from "./session-context-format"

describe("createSessionContextFormatter", () => {
  test("keeps compact USD symbols for English cost", () => {
    expect(createSessionContextFormatter("en").cost(1.25)).toBe("$1.25")
  })

  test("formats configured CNY cost with the yuan symbol", () => {
    expect(createSessionContextFormatter("zh-Hans", { currency: "CNY" }).cost(1.25)).toBe("¥9.00")
  })

  test("uses configured display currency rate", () => {
    expect(createSessionContextFormatter("zh-Hans", { currency: "CNY", currency_rate: 7 }).cost(1.25)).toBe("¥8.75")
  })

  test("ignores display currency rate when currency is not configured", () => {
    expect(createSessionContextFormatter("en", { currency_rate: 7 }).cost(1.25)).toBe("$1.25")
  })

  test("formats configured CNY source cost without converting again", () => {
    expect(createSessionContextFormatter("zh-Hans", { cost_currency: "CNY", currency: "CNY" }).cost(1.25)).toBe("¥1.25")
  })
})
