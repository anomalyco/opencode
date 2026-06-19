import { describe, expect, test } from "bun:test"
import { duration } from "../../src/util/locale"

describe("util.locale", () => {
  describe("duration", () => {
    test("formats milliseconds, seconds, and minutes", () => {
      expect(duration(500)).toBe("500ms")
      expect(duration(1_500)).toBe("1.5s")
      expect(duration(90_000)).toBe("1m 30s")
    })

    test("formats hours and minutes under a day", () => {
      expect(duration(3_600_000)).toBe("1h 0m")
      expect(duration(12_600_000)).toBe("3h 30m")
    })

    test("formats days and hours at and above a day", () => {
      expect(duration(86_400_000)).toBe("1d 0h")
      expect(duration(183_600_000)).toBe("2d 3h")
      expect(duration(187_200_000)).toBe("2d 4h")
    })
  })
})
