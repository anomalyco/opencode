import { describe, expect, test } from "bun:test"
import { LATER_DURATION, majorUpdateVisible } from "./major-update"

describe("major update offer", () => {
  const now = Date.UTC(2026, 10, 13)

  test("shows only once OpenCode 2 is downloaded", () => {
    expect(majorUpdateVisible("unavailable", undefined, now)).toBe(false)
    expect(majorUpdateVisible("downloading", undefined, now)).toBe(false)
    expect(majorUpdateVisible("ready", undefined, now)).toBe(true)
  })

  test("stays hidden for a week after Later, then returns", () => {
    const laterUntil = now + LATER_DURATION

    expect(majorUpdateVisible("ready", laterUntil, now)).toBe(false)
    expect(majorUpdateVisible("ready", laterUntil, laterUntil - 1)).toBe(false)
    expect(majorUpdateVisible("ready", laterUntil, laterUntil)).toBe(true)
  })

  test("Later never hides an upgrade the user already chose", () => {
    expect(majorUpdateVisible("scheduled", now + LATER_DURATION, now)).toBe(true)
  })
})
