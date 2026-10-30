import { describe, expect, test } from "bun:test"
import path from "path"
import { darwinDeveloperDirs, resolveGitExecutable } from "@opencode/core/util/git-executable"

describe("Git executable", () => {
  test("uses an absolute executable on Windows", () => {
    expect(resolveGitExecutable("win32", "bin/git.exe")).toBe(path.resolve("bin/git.exe"))
  })

  test("uses a non-shim PATH executable on macOS without probing developer directories", () => {
    let calls = 0
    const resolved = resolveGitExecutable("darwin", "/opt/homebrew/bin/git", {
      developerDirs: ["/Library/Developer/CommandLineTools"],
      exists: () => {
        calls += 1
        return true
      },
    })
    expect(resolved).toBe("/opt/homebrew/bin/git")
    expect(calls).toBe(0)
  })

  test("resolves the Apple shim on macOS from developer directories", () => {
    const resolved = resolveGitExecutable("darwin", "/usr/bin/git", {
      developerDirs: ["/Applications/Xcode.app/Contents/Developer", "/Library/Developer/CommandLineTools"],
      exists: (file) => file === "/Library/Developer/CommandLineTools/usr/bin/git",
    })
    expect(resolved).toBe("/Library/Developer/CommandLineTools/usr/bin/git")
  })

  test("falls back to PATH lookup on macOS when no developer tools exist or candidate is invalid", () => {
    expect(
      resolveGitExecutable("darwin", "/usr/bin/git", {
        developerDirs: ["/Applications/Xcode.app/Contents/Developer", "/Library/Developer/CommandLineTools"],
        exists: () => false,
      }),
    ).toBe("git")
    expect(
      resolveGitExecutable("darwin", "/usr/bin/git", {
        developerDirs: ["relative/dir"],
        exists: () => true,
      }),
    ).toBe("git")
    expect(
      resolveGitExecutable("darwin", "/usr/bin/git", {
        developerDirs: ["/"],
        exists: () => true,
      }),
    ).toBe("git")
    expect(
      resolveGitExecutable("darwin", null, {
        developerDirs: ["/Library/Developer/CommandLineTools"],
        exists: () => true,
      }),
    ).toBe("git")
  })

  test("orders macOS developer directory candidates by DEVELOPER_DIR then xcode-select link", () => {
    expect(darwinDeveloperDirs("/Custom/Developer", () => "/Library/Developer/CommandLineTools")).toEqual([
      "/Custom/Developer",
    ])
    expect(darwinDeveloperDirs("", () => "/Applications/Xcode-beta.app/Contents/Developer")).toEqual([
      "/Applications/Xcode-beta.app/Contents/Developer",
      "/Applications/Xcode.app/Contents/Developer",
      "/Library/Developer/CommandLineTools",
    ])
    expect(darwinDeveloperDirs(undefined, () => null)).toEqual([
      "/Applications/Xcode.app/Contents/Developer",
      "/Library/Developer/CommandLineTools",
    ])
  })

  test("leaves lookup to the process on Linux", () => {
    expect(resolveGitExecutable("linux", "/usr/bin/git")).toBe("git")
  })

  test("falls back to PATH lookup when Git is unresolved", () => {
    expect(resolveGitExecutable("win32", null)).toBe("git")
  })
})
