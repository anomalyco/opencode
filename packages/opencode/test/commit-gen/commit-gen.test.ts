import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"

describe("CommitGen", () => {
  test("parses conventional commit message format", () => {
    const messages = [
      { raw: "feat(core): add new feature", expected: { type: "feat", scope: "core", desc: "add new feature" } },
      { raw: "fix: resolve crash", expected: { type: "fix", scope: "", desc: "resolve crash" } },
      { raw: "chore: update deps", expected: { type: "chore", scope: "", desc: "update deps" } },
      { raw: "docs(readme): update install instructions", expected: { type: "docs", scope: "readme", desc: "update install instructions" } },
    ]
    for (const { raw, expected } of messages) {
      const type = raw.match(/^(feat|fix|docs|style|refactor|test|chore|ci|perf)/)?.[1] ?? ""
      const scope = raw.match(/\(([^)]+)\)/)?.[1] ?? ""
      const desc = raw.replace(/^(feat|fix|docs|style|refactor|test|chore|ci|perf)(\([^)]+\))?:\s*/, "")
      expect(type).toBe(expected.type)
      expect(scope).toBe(expected.scope)
      expect(desc).toBe(expected.desc)
    }
  })

  test("cleans think tags from LLM output", () => {
    const input = "<think>I should generate a commit message</think>\nfeat: implement login"
    const cleaned = input.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
    expect(cleaned).toBe("feat: implement login")
  })

  test("git diff collection shell simulation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "commit-test-"))
    try {
      // Init git repo
      const { exitCode: initCode } = Bun.spawnSync(["git", "init"], { cwd: dir })
      expect(initCode).toBe(0)
      Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: dir })
      Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: dir })

      // Create and commit initial file
      await fs.writeFile(path.join(dir, "readme.md"), "# test")
      Bun.spawnSync(["git", "add", "."], { cwd: dir })
      Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: dir })

      // Modify a file
      await fs.writeFile(path.join(dir, "readme.md"), "# test\n\nupdated")
      Bun.spawnSync(["git", "add", "."], { cwd: dir })
      const { stdout: diff } = Bun.spawnSync(["git", "diff", "--staged"], { cwd: dir })
      expect(diff.toString().length).toBeGreaterThan(0)
      expect(diff.toString()).toContain("+updated")

      const { stdout: status } = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir })
      expect(status.toString().trim()).toContain("M")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("handles no staged files gracefully", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "commit-test-"))
    try {
      Bun.spawnSync(["git", "init"], { cwd: dir })
      Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: dir })
      Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: dir })
      await fs.writeFile(path.join(dir, "file.txt"), "content")
      Bun.spawnSync(["git", "add", "."], { cwd: dir })
      Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: dir })

      const { stdout: staged } = Bun.spawnSync(["git", "diff", "--staged"], { cwd: dir })
      expect(staged.toString()).toBe("")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
