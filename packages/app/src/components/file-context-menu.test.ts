import { describe, expect, test } from "bun:test"
import { resolveAbsoluteFilePath } from "./file-context-menu"

describe("resolveAbsoluteFilePath", () => {
  const root = "/repo"

  test("keeps absolute paths unchanged", () => {
    expect(resolveAbsoluteFilePath("/repo/src/a.ts", root)).toBe("/repo/src/a.ts")
    expect(resolveAbsoluteFilePath("C:\\repo\\a.ts", root)).toBe("C:\\repo\\a.ts")
    expect(resolveAbsoluteFilePath("D:/repo/a.ts", root)).toBe("D:/repo/a.ts")
  })

  test("joins relative paths with the worktree root", () => {
    expect(resolveAbsoluteFilePath("src/a.ts", root)).toBe("/repo/src/a.ts")
    expect(resolveAbsoluteFilePath("src/a.ts", "/repo/")).toBe("/repo/src/a.ts")
  })

  test("returns the input when no base directory is available", () => {
    expect(resolveAbsoluteFilePath("src/a.ts", "")).toBe("src/a.ts")
  })
})
