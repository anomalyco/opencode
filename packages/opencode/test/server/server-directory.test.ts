import { describe, expect, test } from "bun:test"
import { ServerDirectory } from "@opencode-ai/server/server-directory"

function expectReason(input: string, reason: ServerDirectory.ParseReason, profile: ServerDirectory.Profile) {
  try {
    ServerDirectory.parse(input, profile)
  } catch (error) {
    expect(error).toBeInstanceOf(ServerDirectory.ParseError)
    expect((error as ServerDirectory.ParseError).reason).toBe(reason)
    return
  }
  throw new Error(`Expected ${input} to fail with ${reason}`)
}

describe("ServerDirectory", () => {
  test("accepts POSIX absolute and relative paths without changing lexical value", () => {
    expect(String(ServerDirectory.parse("/tmp/repo", { kind: "posix" }))).toBe("/tmp/repo")
    expect(String(ServerDirectory.parse("relative/repo", { kind: "posix" }))).toBe("relative/repo")
  })

  test("preserves POSIX paths that contain literal backslashes", () => {
    expect(String(ServerDirectory.parse("/tmp/literal\\slash", { kind: "posix" }))).toBe("/tmp/literal\\slash")
    expect(String(ServerDirectory.parse("\\relative", { kind: "posix" }))).toBe("\\relative")
  })

  test("rejects foreign Windows rooted syntax on POSIX", () => {
    expectReason("C:\\Work\\Repo", "foreign", { kind: "posix" })
    expectReason("C:/Work/Repo", "foreign", { kind: "posix" })
    expectReason("\\\\server\\share\\repo", "foreign", { kind: "posix" })
    expectReason("//server/share/repo", "foreign", { kind: "posix" })
  })

  test("keeps WSL mount paths server-native", () => {
    expect(String(ServerDirectory.parse("/mnt/c/Work/Repo", { kind: "wsl", mountRoot: "/mnt" }))).toBe(
      "/mnt/c/Work/Repo",
    )
  })

  test("reports exact parse reasons", () => {
    expectReason("", "empty", { kind: "posix" })
    expectReason("/tmp/\0repo", "nul", { kind: "posix" })
    expectReason("C:Work\\Repo", "drive-relative", { kind: "win32" })
  })
})
