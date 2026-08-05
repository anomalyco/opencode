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
    ["move", ["mv", "logs", "/tmp/logs-backup"]],
    ["copy can overwrite", ["cp", "source", "destination"]],
    ["git worktree prune", ["git", "worktree", "prune"]],
    ["git worktree through global option", ["git", "-C", "repo", "worktree", "prune"]],
    ["git branch delete", ["git", "branch", "-D", "stale"]],
    ["database mutation", ["psql", "$DATABASE_URL", "-c", "CREATE DATABASE app_test"]],
    ["shell interpreter", ["bash", "-c", "rm -rf build"]],
    ["command wrapper", ["command", "mv", "logs", "/tmp/logs-backup"]],
    ["environment wrapper", ["env", "MODE=test", "git", "worktree", "prune"]],
    ["inline program", ["bun", "-e", "Bun.spawnSync([\"rm\", \"-rf\", \"build\"])"]],
    ["database mutation through long option", ["psql", "--command=DROP DATABASE app_test"]],
    ["credential file", ["cat", "~/.netrc"]],
  ])("requires a one-time confirmation for %s", (_label, tokens) => {
    expect(ShellSafety.requiresConfirmation(tokens)).toBe(true)
  })

  test.each([
    ["test", ["bun", "test"]],
    ["build", ["bun", "run", "build"]],
    ["git status", ["git", "status", "--short"]],
    ["git worktree list", ["git", "worktree", "list"]],
    ["read-only SQL", ["psql", "$DATABASE_URL", "-c", "SELECT 1"]],
    ["read-only search", ["rg", "TODO"]],
  ])("keeps normal development command autonomous for %s", (_label, tokens) => {
    expect(ShellSafety.requiresConfirmation(tokens)).toBe(false)
  })

  test("does not pass server credentials to shell commands", () => {
    expect(
      ShellSafety.shellEnvironment({
        HOME: "/home/user",
        PATH: "/usr/bin",
        OPENROUTER_API_KEY: "test-key",
        OPENCODE_SERVER_PASSWORD: "test-password",
        DATABASE_URL: "postgres://test",
        POSTGRES_URL: "postgres://test",
      }),
    ).toEqual({ HOME: "/home/user", PATH: "/usr/bin" })
  })
})
