import { describe, test, expect } from "bun:test"
import { Worktree } from "../../src/parallel/worktree"
import { tmpdir } from "os"
import path from "path"

describe("Worktree", () => {
  describe("generatePath", () => {
    test("should generate path in system temp directory", () => {
      const branchName = "feature-test-123"
      const result = Worktree.generatePath(branchName)
      expect(result).toBe(path.join(tmpdir(), `opencode-worktree-${branchName}`))
    })

    test("should include branch name in path", () => {
      const branchName = "my-branch"
      const result = Worktree.generatePath(branchName)
      expect(result).toContain("opencode-worktree-my-branch")
    })

    test("should handle branch names with special characters", () => {
      const branchName = "feature/auth-123"
      const result = Worktree.generatePath(branchName)
      expect(result).toContain("opencode-worktree-feature/auth-123")
    })
  })
})
