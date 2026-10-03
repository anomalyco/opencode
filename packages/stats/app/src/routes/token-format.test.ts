import { expect, test } from "bun:test"
import { formatTrillionTokens } from "./token-format"

test("formats trillion-token usage with one decimal, including whole totals", () => {
  expect(formatTrillionTokens(1)).toBe("1.0T")
  expect(formatTrillionTokens(9.15)).toBe("9.2T")
  expect(formatTrillionTokens(12)).toBe("12.0T")
  expect(formatTrillionTokens(21.34)).toBe("21.3T")
})
