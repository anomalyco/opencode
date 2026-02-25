import { describe, expect, test } from "bun:test"
import { shouldShowNewSession, hasExistingSessions } from "./sidebar-workspace-helpers"

describe("shouldShowNewSession", () => {
  test("shows new session when not loading and no sessions exist", () => {
    expect(shouldShowNewSession(false, 0)).toBe(true)
  })

  test("hides new session when sessions exist", () => {
    expect(shouldShowNewSession(false, 1)).toBe(false)
    expect(shouldShowNewSession(false, 5)).toBe(false)
  })

  test("hides new session while loading even with no sessions", () => {
    expect(shouldShowNewSession(true, 0)).toBe(false)
  })

  test("hides new session while loading with sessions", () => {
    expect(shouldShowNewSession(true, 3)).toBe(false)
  })
})

describe("hasExistingSessions", () => {
  test("returns false when no sessions", () => {
    expect(hasExistingSessions(0)).toBe(false)
  })

  test("returns true when sessions exist", () => {
    expect(hasExistingSessions(1)).toBe(true)
    expect(hasExistingSessions(10)).toBe(true)
  })
})
