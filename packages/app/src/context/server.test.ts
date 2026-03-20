import { describe, expect, test } from "bun:test"
import { normalizeWorktree } from "./server"

describe("normalizeWorktree", () => {
  test("trims and removes trailing separators", () => {
    expect(normalizeWorktree(" /tmp/repo/ ")).toBe("/tmp/repo")
    expect(normalizeWorktree("C:\\repo\\")).toBe("C:\\repo")
  })

  test("keeps root separators stable", () => {
    expect(normalizeWorktree("/")).toBe("/")
    expect(normalizeWorktree("\\")).toBe("\\")
  })

  test("keeps values without trailing separators", () => {
    expect(normalizeWorktree("/tmp/repo")).toBe("/tmp/repo")
    expect(normalizeWorktree("C:\\repo")).toBe("C:\\repo")
  })
})
