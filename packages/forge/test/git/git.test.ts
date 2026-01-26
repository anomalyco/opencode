import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { $ } from "bun"
import { Git } from "../../src/git"
import path from "path"
import fs from "fs/promises"
import os from "os"

describe("Git", () => {
  describe("getMainWorktree", () => {
    let tempDir: string
    let mainRepoPath: string
    let linkedWorktreePath: string

    beforeAll(async () => {
      // Create a temp directory for our test repo
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-test-"))
      mainRepoPath = path.join(tempDir, "main-repo")
      linkedWorktreePath = path.join(tempDir, "linked-worktree")

      // Initialize a git repo
      await fs.mkdir(mainRepoPath, { recursive: true })
      await $`git init`.cwd(mainRepoPath).quiet()
      await $`git config user.email "test@test.com"`.cwd(mainRepoPath).quiet()
      await $`git config user.name "Test"`.cwd(mainRepoPath).quiet()

      // Create initial commit (required for worktrees)
      await fs.writeFile(path.join(mainRepoPath, "README.md"), "# Test")
      await $`git add .`.cwd(mainRepoPath).quiet()
      await $`git commit -m "Initial commit"`.cwd(mainRepoPath).quiet()

      // Create a linked worktree
      await $`git worktree add ${linkedWorktreePath} -b test-branch`.cwd(mainRepoPath).quiet()
    })

    afterAll(async () => {
      // Clean up
      try {
        await $`git worktree remove ${linkedWorktreePath} --force`.cwd(mainRepoPath).quiet().nothrow()
      } catch {}
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it("returns the main worktree when called from the main repo", async () => {
      const mainWorktree = await Git.getMainWorktree(mainRepoPath)

      expect(mainWorktree).not.toBeNull()
      // Use realpath to handle macOS /var -> /private/var symlinks
      const expectedPath = await fs.realpath(mainRepoPath)
      const actualPath = await fs.realpath(mainWorktree!.path)
      expect(actualPath).toBe(expectedPath)
      // Branch could be "master" or "main" depending on git config
      expect(mainWorktree!.branch).not.toBeNull()
      expect(["master", "main"]).toContain(mainWorktree!.branch!)
    })

    it("returns the main worktree when called from a linked worktree", async () => {
      const mainWorktree = await Git.getMainWorktree(linkedWorktreePath)

      expect(mainWorktree).not.toBeNull()
      // Use realpath to handle macOS /var -> /private/var symlinks
      const expectedPath = await fs.realpath(mainRepoPath)
      const actualPath = await fs.realpath(mainWorktree!.path)
      expect(actualPath).toBe(expectedPath)
      // Main worktree should have "master" or "main" branch, not "test-branch"
      expect(mainWorktree!.branch).not.toBe("test-branch")
    })

    it("returns null for non-git directory", async () => {
      const mainWorktree = await Git.getMainWorktree(os.tmpdir())

      expect(mainWorktree).toBeNull()
    })
  })

  describe("parseWorktreeOutput", () => {
    it("parses standard worktree list output", () => {
      const output = `worktree /path/to/main
HEAD abc123def456
branch refs/heads/main

worktree /path/to/linked
HEAD def789abc012
branch refs/heads/feature-branch
`
      const worktrees = Git.parseWorktreeOutput(output)

      expect(worktrees).toHaveLength(2)
      expect(worktrees[0]).toEqual({
        path: "/path/to/main",
        head: "abc123def456",
        branch: "main",
      })
      expect(worktrees[1]).toEqual({
        path: "/path/to/linked",
        head: "def789abc012",
        branch: "feature-branch",
      })
    })

    it("handles detached HEAD state", () => {
      const output = `worktree /path/to/detached
HEAD abc123def456
detached
`
      const worktrees = Git.parseWorktreeOutput(output)

      expect(worktrees).toHaveLength(1)
      expect(worktrees[0].branch).toBeNull()
    })
  })
})
