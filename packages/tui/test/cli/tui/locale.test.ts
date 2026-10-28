import { expect, test } from "bun:test"
import { Locale } from "../../../src/util/locale"

test("truncateMiddle keeps short widths inside the requested size", () => {
  expect(Locale.truncateMiddle("abcdefghij", 2)).toBe("a…")
  expect(Locale.truncateMiddle("abcdefghij", 1)).toBe("…")
})
