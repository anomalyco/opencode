import { describe, expect, test } from "bun:test"
import { DISMISS_DURATION, majorUpdateVisible } from "./major-update"

describe("major update offer", () => {
  const now = Date.UTC(2026, 10, 13)

  test("shows once OpenCode 2 is on offer and hides while it is not", () => {
    expect(majorUpdateVisible("available", undefined, now)).toBe(true)
    expect(majorUpdateVisible("failed", undefined, now)).toBe(true)
    expect(majorUpdateVisible("unavailable", undefined, now)).toBe(false)
  })

  test("stays hidden for a week after Dismiss, then returns", () => {
    const dismissedUntil = now + DISMISS_DURATION

    expect(majorUpdateVisible("available", dismissedUntil, now)).toBe(false)
    expect(majorUpdateVisible("available", dismissedUntil, dismissedUntil - 1)).toBe(false)
    expect(majorUpdateVisible("available", dismissedUntil, dismissedUntil)).toBe(true)
  })

  test("a dismissal never hides an upgrade that is already underway", () => {
    const dismissedUntil = now + DISMISS_DURATION

    expect(majorUpdateVisible("installing", dismissedUntil, now)).toBe(true)
    expect(majorUpdateVisible("installed", dismissedUntil, now)).toBe(true)
  })
})
