import { describe, expect, test } from "bun:test"
import { isDefaultTitle, nextArchivedAt } from "../../src/util/session"

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  describe("nextArchivedAt", () => {
    test("archives an active session with the provided timestamp", () => {
      expect(nextArchivedAt(undefined, 1_700_000_000_000)).toBe(1_700_000_000_000)
      expect(nextArchivedAt(null, 1_700_000_000_000)).toBe(1_700_000_000_000)
    })

    test("unarchives an archived session by clearing the timestamp", () => {
      expect(nextArchivedAt(1_650_000_000_000, 1_700_000_000_000)).toBeNull()
      expect(nextArchivedAt(0, 1_700_000_000_000)).toBeNull()
    })
  })
})
