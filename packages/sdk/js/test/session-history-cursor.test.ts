import { expect, test } from "bun:test"
import { SessionHistoryCursor } from "../src/v2/client"

test("constructs an initial opaque Session history cursor", () => {
  expect(SessionHistoryCursor.after(0)).toBe("eyJhZnRlciI6MH0")
  expect(() => SessionHistoryCursor.after(-1)).toThrow(RangeError)
})
