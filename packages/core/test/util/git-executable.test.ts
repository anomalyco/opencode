import { describe, expect, test } from "bun:test"
import path from "path"
import { resolveGitExecutable } from "@opencode/core/util/git-executable"

describe("Git executable", () => {
  test("uses an absolute executable on Windows", () => {
    expect(resolveGitExecutable("win32", "bin/git.exe")).toBe(path.resolve("bin/git.exe"))
  })

  test("leaves lookup to the process outside Windows", () => {
    expect(resolveGitExecutable("linux", "/usr/bin/git")).toBe("git")
  })

  test("falls back to PATH lookup when Git is unresolved", () => {
    expect(resolveGitExecutable("win32", null)).toBe("git")
  })
})
