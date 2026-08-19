import { describe, expect, test } from "bun:test"
import path from "path"
import { sessionPath } from "@/session/session"

describe("sessionPath", () => {
  test("resolves sessions relative to the repository worktree", () => {
    const worktree = path.join(path.parse(process.cwd()).root, "repo")
    expect(sessionPath(worktree, path.join(worktree, "packages", "opencode"))).toBe("packages/opencode")
    expect(sessionPath(worktree, worktree)).toBe("")
  })

  test("anchors the synthetic / worktree to the directory's own root", () => {
    const cases =
      process.platform === "win32"
        ? ["C:\\Users\\wxj20", "D:\\Dev\\code"]
        : ["/home/wxj20", "/srv/dev/code"]
    for (const cwd of cases) {
      const root = path.parse(cwd).root
      expect(sessionPath("/", cwd)).toBe(path.relative(root, cwd).replaceAll("\\", "/"))
    }
  })

  test("never produces a cross-drive absolute path for the synthetic worktree", () => {
    if (process.platform !== "win32") return
    // With a CWD on C:, the un-anchored resolve("/") used to return "C:/Users/..."
    // for a directory on another drive. The anchored form must stay relative.
    expect(sessionPath("/", "C:\\Users\\wxj20")).not.toMatch(/^[A-Za-z]:\//)
    expect(sessionPath("/", "D:\\Dev\\code")).not.toMatch(/^[A-Za-z]:\//)
  })
})