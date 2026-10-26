import { describe, expect, test } from "bun:test"
import { ServerDirectory } from "../src/server-directory"

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

  test("parses Windows-native paths under the Windows profile", () => {
    expect(String(ServerDirectory.parse("C:/Work/Repo", { kind: "win32" }))).toBe("C:\\Work\\Repo")
    expect(String(ServerDirectory.parse("C:\\Work\\Repo", { kind: "win32" }))).toBe("C:\\Work\\Repo")
    expect(String(ServerDirectory.parse("\\\\server\\share\\repo", { kind: "win32" }))).toBe("\\\\server\\share\\repo")
  })

  test("preserves relative paths under the Windows profile", () => {
    for (const input of ["relative/repo", "relative\\repo", "../repo", "..\\repo", "foo/../repo"]) {
      expect(String(ServerDirectory.parse(input, { kind: "win32" }))).toBe(input)
    }
  })

  test("rejects foreign POSIX-rooted syntax under the Windows profile", () => {
    expectReason("/tmp/repo", "foreign", { kind: "win32" })
    expectReason("file:///tmp/repo", "invalid", { kind: "win32" })
    expectReason("C:Work\\Repo", "drive-relative", { kind: "win32" })
  })

  test("reports exact parse reasons", () => {
    expectReason("", "empty", { kind: "posix" })
    expectReason("/tmp/\0repo", "nul", { kind: "posix" })
  })

  test("detects the native server profile without probing the filesystem", () => {
    expect(ServerDirectory.profile({ platform: "win32", env: { WSL_DISTRO_NAME: "Ubuntu" } })).toEqual({
      kind: "win32",
    })
    expect(ServerDirectory.profile({ platform: "linux", env: {} })).toEqual({ kind: "posix" })
    expect(
      ServerDirectory.profile({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" }, mountRoot: "/drives" }),
    ).toEqual({
      kind: "wsl",
      mountRoot: "/drives",
      distro: "Ubuntu",
    })
    expect(ServerDirectory.profile({ platform: "linux", env: { WSL_INTEROP: "interop" } })).toEqual({
      kind: "wsl",
      mountRoot: "/mnt",
    })
    expect(ServerDirectory.profile({ platform: "darwin", env: { WSL_DISTRO_NAME: "Ubuntu" } })).toEqual({
      kind: "posix",
    })
  })

  test("reports NUL and incomplete UNC failures under Windows", () => {
    expectReason("C:\\repo\0name", "nul", { kind: "win32" })
    expectReason("\\\\server", "invalid", { kind: "win32" })
    expectReason("//server", "invalid", { kind: "win32" })
  })
})
