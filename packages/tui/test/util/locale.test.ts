import { describe, expect, test } from "bun:test"
import { number } from "../../src/util/locale"

describe("util.locale.number", () => {
  test("formats counts below a thousand as-is", () => {
    expect(number(0)).toBe("0")
    expect(number(999)).toBe("999")
  })

  test("formats thousands with a K suffix", () => {
    expect(number(1000)).toBe("1.0K")
    expect(number(1500)).toBe("1.5K")
    expect(number(999949)).toBe("999.9K")
  })

  test("rolls over to M once the K value would round to 1000.0", () => {
    expect(number(999950)).toBe("1.0M")
    expect(number(999999)).toBe("1.0M")
  })

  test("formats millions with an M suffix", () => {
    expect(number(1000000)).toBe("1.0M")
    expect(number(1500000)).toBe("1.5M")
  })
})
