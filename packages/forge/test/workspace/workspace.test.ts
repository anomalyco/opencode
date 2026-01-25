import { describe, expect, test, beforeAll } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("Workspace", () => {
  describe("Git operations", async () => {
    const { Git } = await import("../../src/git")

    test("getRepoRoot returns the git repository root", async () => {
      await using tmp = await tmpdir({ git: true })
      const root = await Git.getRepoRoot(tmp.path)
      expect(root).toBe(tmp.path)
    })

    test("getRepoRoot returns null for non-git directory", async () => {
      await using tmp = await tmpdir()
      const root = await Git.getRepoRoot(tmp.path)
      expect(root).toBeNull()
    })

    test("getCurrentBranch returns the current branch name", async () => {
      await using tmp = await tmpdir({ git: true })
      const branch = await Git.getCurrentBranch(tmp.path)
      // Default branch is typically master or main
      expect(branch).toBeTruthy()
      expect(["master", "main"]).toContain(branch!)
    })

    test("createWorktree creates a new worktree with branch", async () => {
      await using tmp = await tmpdir({ git: true })
      const worktreePath = path.join(tmp.path, "..", "worktree-test")
      const branchName = "test-branch"

      await Git.createWorktree(tmp.path, worktreePath, branchName)

      // Check that worktree exists
      const exists = await Bun.file(path.join(worktreePath, ".git")).exists()
      expect(exists).toBe(true)

      // Clean up manually since it's outside tmp
      await $`git worktree remove ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    })

    test("listWorktrees returns all worktrees", async () => {
      await using tmp = await tmpdir({ git: true })
      const worktreePath = path.join(tmp.path, "..", "worktree-list-test")

      await Git.createWorktree(tmp.path, worktreePath, "list-test-branch")
      const worktrees = await Git.listWorktrees(tmp.path)

      expect(worktrees.length).toBeGreaterThanOrEqual(2)
      expect(worktrees.some((w) => w.path === tmp.path)).toBe(true)
      expect(worktrees.some((w) => w.branch === "list-test-branch")).toBe(true)

      await $`git worktree remove ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    })

    test("parseWorktreeOutput parses single worktree", () => {
      const output = `worktree /path/to/repo
HEAD abc123def456
branch refs/heads/main
`
      const result = Git.parseWorktreeOutput(output)
      expect(result).toEqual([
        { path: "/path/to/repo", head: "abc123def456", branch: "main" },
      ])
    })

    test("parseWorktreeOutput parses multiple worktrees", () => {
      const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main

worktree /path/to/worktree1
HEAD def456
branch refs/heads/feature-branch
`
      const result = Git.parseWorktreeOutput(output)
      expect(result).toEqual([
        { path: "/path/to/repo", head: "abc123", branch: "main" },
        { path: "/path/to/worktree1", head: "def456", branch: "feature-branch" },
      ])
    })

    test("parseWorktreeOutput handles detached HEAD", () => {
      const output = `worktree /path/to/repo
HEAD abc123
detached
`
      const result = Git.parseWorktreeOutput(output)
      expect(result).toEqual([{ path: "/path/to/repo", head: "abc123", branch: null }])
    })

    test("parseWorktreeOutput handles output without trailing newline", () => {
      const output = `worktree /path/to/repo
HEAD abc123
branch refs/heads/main`
      const result = Git.parseWorktreeOutput(output)
      expect(result).toEqual([
        { path: "/path/to/repo", head: "abc123", branch: "main" },
      ])
    })

    test("removeWorktree removes an existing worktree", async () => {
      await using tmp = await tmpdir({ git: true })
      const worktreePath = path.join(tmp.path, "..", "worktree-remove-test")

      await Git.createWorktree(tmp.path, worktreePath, "remove-test-branch")
      await Git.removeWorktree(tmp.path, worktreePath)

      const worktrees = await Git.listWorktrees(tmp.path)
      expect(worktrees.some((w) => w.branch === "remove-test-branch")).toBe(false)
    })

    test("getRepoID returns consistent ID for same repo", async () => {
      await using tmp = await tmpdir({ git: true })
      const id1 = await Git.getRepoID(tmp.path)
      const id2 = await Git.getRepoID(tmp.path)
      expect(id1).toBe(id2)
      expect(id1).toBeTruthy()
    })
  })

  describe("Name generation", async () => {
    const { Names } = await import("../../src/workspace/names")

    test("sanitizeForBranch converts spaces to dashes", () => {
      expect(Names.sanitizeForBranch("my feature")).toBe("my-feature")
    })

    test("sanitizeForBranch removes invalid characters", () => {
      expect(Names.sanitizeForBranch("feature@#$%test")).toBe("feature-test")
    })

    test("sanitizeForBranch handles multiple consecutive invalid chars", () => {
      expect(Names.sanitizeForBranch("feature---test")).toBe("feature-test")
    })

    test("sanitizeForBranch trims leading/trailing dashes", () => {
      expect(Names.sanitizeForBranch("-my-feature-")).toBe("my-feature")
    })

    test("sanitizeForBranch lowercases the string", () => {
      expect(Names.sanitizeForBranch("MyFeature")).toBe("myfeature")
    })

    test("getGitUsername returns a username or fallback", async () => {
      const username = await Names.getGitUsername()
      expect(username).toBeTruthy()
      expect(typeof username).toBe("string")
    })

    test("generateRandomName returns username/adjective-noun format", async () => {
      const name = await Names.generateRandomName()
      expect(name).toMatch(/^[\w-]+\/[\w]+-[\w]+$/)
    })
  })

  describe("Workspace CRUD", async () => {
    const { Workspace } = await import("../../src/workspace")
    const { Git } = await import("../../src/git")

    test("create creates a new workspace with provided name", async () => {
      await using tmp = await tmpdir({ git: true })

      const workspace = await Workspace.create({
        name: "test-workspace",
        repoRoot: tmp.path,
      })

      expect(workspace.name).toBe("test-workspace")
      expect(workspace.id).toBeTruthy()
      expect(workspace.repoRoot).toBe(tmp.path)
      expect(workspace.branch).toBe("test-workspace")

      // Clean up
      await Workspace.remove(workspace.id)
    })

    test("create generates name when not provided", async () => {
      await using tmp = await tmpdir({ git: true })

      const workspace = await Workspace.create({
        repoRoot: tmp.path,
      })

      expect(workspace.name).toBeTruthy()
      expect(workspace.name).toMatch(/\//) // Should have username/ prefix

      // Clean up
      await Workspace.remove(workspace.id)
    })

    test("get retrieves existing workspace", async () => {
      await using tmp = await tmpdir({ git: true })

      const created = await Workspace.create({
        name: "get-test",
        repoRoot: tmp.path,
      })

      const retrieved = await Workspace.get(created.name, tmp.path)
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)

      await Workspace.remove(created.id)
    })

    test("get returns null for non-existent workspace", async () => {
      await using tmp = await tmpdir({ git: true })
      const workspace = await Workspace.get("non-existent", tmp.path)
      expect(workspace).toBeNull()
    })

    test("list returns all workspaces for a repo", async () => {
      await using tmp = await tmpdir({ git: true })

      const ws1 = await Workspace.create({ name: "list-test-1", repoRoot: tmp.path })
      const ws2 = await Workspace.create({ name: "list-test-2", repoRoot: tmp.path })

      const repoID = await Git.getRepoID(tmp.path)
      const workspaces = await Workspace.list(repoID!)

      expect(workspaces.length).toBeGreaterThanOrEqual(2)
      expect(workspaces.some((w) => w.name === "list-test-1")).toBe(true)
      expect(workspaces.some((w) => w.name === "list-test-2")).toBe(true)

      await Workspace.remove(ws1.id)
      await Workspace.remove(ws2.id)
    })

    test("exists returns true for existing workspace", async () => {
      await using tmp = await tmpdir({ git: true })

      const ws = await Workspace.create({ name: "exists-test", repoRoot: tmp.path })
      const exists = await Workspace.exists("exists-test", tmp.path)
      expect(exists).toBe(true)

      await Workspace.remove(ws.id)
    })

    test("exists returns false for non-existent workspace", async () => {
      await using tmp = await tmpdir({ git: true })
      const exists = await Workspace.exists("non-existent", tmp.path)
      expect(exists).toBe(false)
    })

    test("remove deletes workspace and worktree", async () => {
      await using tmp = await tmpdir({ git: true })

      const ws = await Workspace.create({ name: "remove-test", repoRoot: tmp.path })
      await Workspace.remove(ws.id)

      const exists = await Workspace.exists("remove-test", tmp.path)
      expect(exists).toBe(false)
    })
  })
})
