import { describe, expect, test } from "bun:test"
import { workspaceOpenState, shouldShowNewSession, hasExistingSessions } from "./sidebar-workspace-helpers"

describe("workspaceOpenState", () => {
  test("defaults to local workspace open", () => {
    expect(workspaceOpenState({}, "/tmp/root", true)).toBe(true)
  })

  test("uses persisted expansion state when present", () => {
    expect(workspaceOpenState({ "/tmp/root": false }, "/tmp/root", true)).toBe(false)
    expect(workspaceOpenState({ "/tmp/branch": true }, "/tmp/branch", false)).toBe(true)
  })
})

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
