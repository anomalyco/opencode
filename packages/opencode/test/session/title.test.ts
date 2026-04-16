import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"

describe("Session.isDefaultTitle", () => {
  test("returns true for default parent title", () => {
    expect(Session.isDefaultTitle("New session - 2026-04-16T12:00:00.000Z")).toBe(true)
  })

  test("returns true for default child title", () => {
    expect(Session.isDefaultTitle("Child session - 2026-04-16T12:00:00.000Z")).toBe(true)
  })

  test("returns false for a git branch name", () => {
    expect(Session.isDefaultTitle("feat/autotitle-branch")).toBe(false)
  })

  test("returns false for main branch", () => {
    expect(Session.isDefaultTitle("main")).toBe(false)
  })

  test("returns false for a custom title", () => {
    expect(Session.isDefaultTitle("My custom session")).toBe(false)
  })
})
