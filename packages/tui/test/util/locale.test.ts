import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("util.locale", () => {
  describe("number", () => {
    test("returns the raw value below 1,000", () => {
      expect(Locale.number(0)).toBe("0")
      expect(Locale.number(999)).toBe("999")
    })

    test("formats thousands with a K suffix", () => {
      expect(Locale.number(1000)).toBe("1.0K")
      expect(Locale.number(1500)).toBe("1.5K")
      expect(Locale.number(999499)).toBe("999.5K")
      expect(Locale.number(999949)).toBe("999.9K")
    })

    test("formats millions with an M suffix", () => {
      expect(Locale.number(1000000)).toBe("1.0M")
      expect(Locale.number(1500000)).toBe("1.5M")
    })

    test("promotes to M when the thousands value rounds up to 1000.0K", () => {
      expect(Locale.number(999950)).toBe("1.0M")
      expect(Locale.number(999999)).toBe("1.0M")
    })
  })
})
