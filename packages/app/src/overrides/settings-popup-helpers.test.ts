import { describe, expect, test } from "bun:test"
import { hasAllAccess, addAllAccess, removeAllAccess, filterDisplayUsers } from "./settings-popup-helpers"

describe("hasAllAccess", () => {
  test("returns true when list contains wildcard", () => {
    expect(hasAllAccess(["alice", "*"])).toBe(true)
  })

  test("returns true when list is only wildcard", () => {
    expect(hasAllAccess(["*"])).toBe(true)
  })

  test("returns false when list has no wildcard", () => {
    expect(hasAllAccess(["alice", "bob"])).toBe(false)
  })

  test("returns false for empty list", () => {
    expect(hasAllAccess([])).toBe(false)
  })
})

describe("addAllAccess", () => {
  test("adds wildcard to list without one", () => {
    expect(addAllAccess(["alice", "bob"])).toEqual(["alice", "bob", "*"])
  })

  test("adds wildcard to empty list", () => {
    expect(addAllAccess([])).toEqual(["*"])
  })

  test("returns same list if wildcard already present", () => {
    const list = ["alice", "*"]
    expect(addAllAccess(list)).toBe(list)
  })

  test("does not duplicate wildcard", () => {
    const result = addAllAccess(["*"])
    expect(result).toEqual(["*"])
    expect(result.filter((u) => u === "*")).toHaveLength(1)
  })
})

describe("removeAllAccess", () => {
  test("removes wildcard and preserves other users", () => {
    expect(removeAllAccess(["alice", "*", "bob"])).toEqual(["alice", "bob"])
  })

  test("returns empty list when wildcard is only entry", () => {
    expect(removeAllAccess(["*"])).toEqual([])
  })

  test("returns same entries when no wildcard present", () => {
    expect(removeAllAccess(["alice", "bob"])).toEqual(["alice", "bob"])
  })

  test("handles empty list", () => {
    expect(removeAllAccess([])).toEqual([])
  })
})

describe("filterDisplayUsers", () => {
  test("removes wildcard from display list", () => {
    expect(filterDisplayUsers(["alice", "*", "bob"])).toEqual(["alice", "bob"])
  })

  test("returns all users when no wildcard", () => {
    expect(filterDisplayUsers(["alice", "bob"])).toEqual(["alice", "bob"])
  })

  test("returns empty list when only wildcard", () => {
    expect(filterDisplayUsers(["*"])).toEqual([])
  })

  test("handles empty list", () => {
    expect(filterDisplayUsers([])).toEqual([])
  })
})
