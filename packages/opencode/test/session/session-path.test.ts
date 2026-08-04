import { describe, expect, test } from "bun:test"
import path from "path"
import { sessionPath } from "@/session/session"

describe("sessionPath", () => {
  test("returns the worktree-relative path for git projects", () => {
    expect(sessionPath("D:\\repo", "D:\\repo\\sub\\dir", path.win32)).toBe("sub/dir")
    expect(sessionPath("/repo", "/repo/src", path.posix)).toBe("src")
  })

  test("returns undefined when the directory is on a different volume than the worktree", () => {
    // A cross-volume directory cannot be expressed relative to the
    // worktree; the relative() result is an absolute path that the session
    // list query can never match.
    expect(sessionPath("C:\\", "D:\\repo", path.win32)).toBeUndefined()
    expect(sessionPath("C:\\", "//server/share", path.win32)).toBeUndefined()
  })

  test("keeps same-volume relative results", () => {
    // When the directory shares the worktree root, the result is a
    // consistent relative path and is preserved.
    expect(sessionPath("C:\\", "C:\\Users\\me\\proj", path.win32)).toBe("Users/me/proj")
  })

  test("keeps POSIX non-git behavior unchanged", () => {
    // POSIX has a single root, so worktree "/" resolves deterministically
    // and the relative result is consistent.
    expect(sessionPath("/", "/workspace", path.posix)).toBe("workspace")
  })

  test("returns an empty path for the worktree root itself", () => {
    expect(sessionPath("/repo", "/repo", path.posix)).toBe("")
  })
})
