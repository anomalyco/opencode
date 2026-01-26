import { describe, expect, test, beforeEach } from "bun:test"
import { Session } from "../../src/session"

describe("Session.directory", () => {
  beforeEach(() => {
    // Reset to undefined before each test
    Session.directory.set(undefined)
  })

  test("should return custom directory when set", () => {
    const customDir = "/custom/worktree/path"
    Session.directory.set(customDir)
    expect(Session.directory.get()).toBe(customDir)
  })

  test("should update when set multiple times", () => {
    Session.directory.set("/first/path")
    expect(Session.directory.get()).toBe("/first/path")

    Session.directory.set("/second/path")
    expect(Session.directory.get()).toBe("/second/path")
  })
})
