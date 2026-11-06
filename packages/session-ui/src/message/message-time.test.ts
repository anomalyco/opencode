import { afterEach, expect, setSystemTime, test } from "bun:test"
import { messageTime } from "./message-time"

afterEach(() => setSystemTime())

test("names today and yesterday by calendar day, then dates, with the year once it differs", () => {
  setSystemTime(new Date(2026, 10, 6, 0, 30))

  expect(messageTime(new Date(2026, 10, 6, 0, 5).getTime(), "en-GB")).toBe("Today, 00:05")
  // Forty minutes ago, but before midnight.
  expect(messageTime(new Date(2026, 10, 5, 23, 50).getTime(), "en-GB")).toBe("Yesterday, 23:50")
  expect(messageTime(new Date(2026, 10, 4, 9, 15).getTime(), "en-GB")).toBe("4 Nov, 9:15")
  expect(messageTime(new Date(2025, 10, 4, 9, 15).getTime(), "en-GB")).toBe("4 Nov 2025, 09:15")
})

test("leaves today's time bare only when asked", () => {
  setSystemTime(new Date(2026, 10, 6, 18, 0))

  expect(messageTime(new Date(2026, 10, 6, 14, 32).getTime(), "en-GB", { bareToday: true })).toBe("14:32")
  expect(messageTime(new Date(2026, 10, 5, 23, 10).getTime(), "en-GB", { bareToday: true })).toBe("Yesterday, 23:10")
})
