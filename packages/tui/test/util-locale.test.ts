import { expect, test } from "bun:test"
import { truncate, truncateLeft, truncateMiddle } from "@opencode-ai/tui/util/locale"

const input = "abcdefghij"

test("truncate returns the input when it fits", () => {
  expect(truncate(input, 10)).toBe(input)
  expect(truncateLeft(input, 10)).toBe(input)
  expect(truncateMiddle(input, 10)).toBe(input)
})

test("truncateLeft never returns more than the requested budget", () => {
  for (const len of [0, 1, 2, 3, 5, 9]) {
    expect(truncateLeft(input, len).length).toBeLessThanOrEqual(Math.max(1, len))
  }
  expect(truncateLeft(input, 1)).toBe("…")
  expect(truncateLeft(input, 2)).toBe("…j")
})

test("truncateMiddle never returns more than the requested budget", () => {
  for (const len of [0, 1, 2, 3, 5, 9]) {
    expect(truncateMiddle(input, len).length).toBeLessThanOrEqual(Math.max(1, len))
  }
  expect(truncateMiddle(input, 1)).toBe("…")
  expect(truncateMiddle(input, 3)).toBe("a…j")
})

test("truncateMiddle keeps both ends of the input", () => {
  expect(truncateMiddle(input, 5)).toBe("ab…ij")
})
