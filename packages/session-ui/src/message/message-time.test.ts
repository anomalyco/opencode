import { expect, test } from "bun:test"
import { messageTime } from "./message-time"

const at = (...parts: [number, number, number, number, number]) => new Date(...parts).getTime()

test("names today and yesterday by calendar day, then dates, with the year once it differs", () => {
  const today = at(2026, 10, 6, 0, 30)

  expect(messageTime(at(2026, 10, 6, 0, 5), today, "en-GB")).toBe("Today, 00:05")
  // Forty minutes ago, but before midnight.
  expect(messageTime(at(2026, 10, 5, 23, 50), today, "en-GB")).toBe("Yesterday, 23:50")
  expect(messageTime(at(2026, 10, 4, 9, 15), today, "en-GB")).toBe("4 Nov, 9:15")
  expect(messageTime(at(2025, 10, 4, 9, 15), today, "en-GB")).toBe("4 Nov 2025, 09:15")
})

test("leaves today's time bare only when asked", () => {
  const today = at(2026, 10, 6, 18, 0)

  expect(messageTime(at(2026, 10, 6, 14, 32), today, "en-GB", { bareToday: true })).toBe("14:32")
  expect(messageTime(at(2026, 10, 5, 23, 10), today, "en-GB", { bareToday: true })).toBe("Yesterday, 23:10")
})
