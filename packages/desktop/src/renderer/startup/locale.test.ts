import { describe, expect, test } from "bun:test"
import { storedLocaleValue } from "./locale-value"

describe("desktop stored locale", () => {
  test("extracts the current locale field", () => {
    expect(storedLocaleValue('{"locale":"fr"}')).toBe("fr")
    expect(storedLocaleValue('{"other":true,"locale" : "zht"}')).toBe("zht")
  })

  test("ignores missing locale data", () => {
    expect(storedLocaleValue(null)).toBeUndefined()
    expect(storedLocaleValue("{}")).toBeUndefined()
  })
})
