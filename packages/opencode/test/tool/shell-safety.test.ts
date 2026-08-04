import { describe, expect, test } from "bun:test"
import { ShellSafety } from "../../src/tool/shell/safety"

describe("ShellSafety", () => {
  test.each([
    ["rm -rf build", ["rm", "-rf", "build"]],
    ["git reset --hard", ["git", "reset", "--hard"]],
    ["git push", ["git", "push", "origin", "main"]],
    ["find -delete", ["find", ".", "-delete"]],
    ["sed in-place", ["sed", "-i", "s/a/b/", "file"]],
    ["package publish", ["bun", "publish"]],
  ])("requires a one-time confirmation for %s", (_label, tokens) => {
    expect(ShellSafety.requiresConfirmation(tokens)).toBe(true)
  })

  test.each([
    ["test", ["bun", "test"]],
    ["build", ["bun", "run", "build"]],
    ["git status", ["git", "status", "--short"]],
    ["read-only search", ["rg", "TODO"]],
  ])("keeps normal development command autonomous for %s", (_label, tokens) => {
    expect(ShellSafety.requiresConfirmation(tokens)).toBe(false)
  })
})
