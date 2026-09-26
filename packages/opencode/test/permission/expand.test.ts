import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"

describe("Permission.expand", () => {
  test("keeps non-path permission patterns untouched", () => {
    expect(Permission.expand("ls")).toBe("ls")
    expect(Permission.expand("*.env")).toBe("*.env")
    expect(Permission.expand("src/index.ts")).toBe("src/index.ts")
  })

  test("expands tilde and $HOME to the home directory", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
    expect(Permission.expand("~/foo").startsWith(home)).toBe(true)
    expect(Permission.expand("$HOME/foo").startsWith(home)).toBe(true)
    expect(Permission.expand("~/foo")).toContain("foo")
  })

  if (process.platform === "win32") {
    test("normalises a windows drive whitelist path via realpath (junction-resolving)", () => {
      const resolved = Permission.expand("C:/Users/test/.claude/skills/skill/*")
      // Either the real path resolves (junction) or it stays as given — the drive
      // prefix and trailing wildcard must survive.
      expect(resolved).toMatch(/^[A-Za-z]:[\\/]/)
      expect(resolved.replaceAll("\\", "/").endsWith("*")).toBe(true)
    })
  }
})