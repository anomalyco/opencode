import { expect, test } from "bun:test"
import { firstChars, lastChars } from "./text.js"

test("firstChars and lastChars never keep half an emoji", () => {
  expect(firstChars("ab😀c", 3)).toBe("ab")
  expect(firstChars("ab😀c", 4)).toBe("ab😀")
  expect(firstChars("ab", 5)).toBe("ab")
  expect(lastChars("a😀bc", 3)).toBe("bc")
  expect(lastChars("a😀bc", 4)).toBe("😀bc")
  expect(lastChars("ab", 5)).toBe("ab")
})
