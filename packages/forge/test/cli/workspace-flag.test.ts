import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("Workspace CLI flag", () => {
  describe("resolveWorkspace", async () => {
    const { resolveWorkspace } = await import("../../src/cli/cmd/agent-context")
    const { Workspace } = await import("../../src/workspace")
    const { Git } = await import("../../src/git")

    test("creates new workspace when name provided and doesn't exist", async () => {
      await using tmp = await tmpdir({ git: true })

      const result = await resolveWorkspace("new-workspace", tmp.path)

      expect(result).toBeDefined()
      expect(result!.name).toBe("new-workspace")
      expect(result!.worktreePath).toBeTruthy()

      // Clean up
      await Workspace.remove(result!.id)
    })

    test("reuses existing workspace when name matches", async () => {
      await using tmp = await tmpdir({ git: true })

      // Create workspace first
      const existing = await Workspace.create({
        name: "existing-workspace",
        repoRoot: tmp.path,
      })

      const result = await resolveWorkspace("existing-workspace", tmp.path)

      expect(result).toBeDefined()
      expect(result!.id).toBe(existing.id)
      expect(result!.name).toBe("existing-workspace")

      // Clean up
      await Workspace.remove(existing.id)
    })

    test("generates random name when empty string provided", async () => {
      await using tmp = await tmpdir({ git: true })

      const result = await resolveWorkspace("", tmp.path)

      expect(result).toBeDefined()
      expect(result!.name).toBeTruthy()
      expect(result!.name).toMatch(/^[\w-]+\/[\w]+-[\w]+$/) // username/adjective-noun format

      // Clean up
      await Workspace.remove(result!.id)
    })

    test("returns null when workspace flag not provided", async () => {
      await using tmp = await tmpdir({ git: true })

      const result = await resolveWorkspace(undefined, tmp.path)

      expect(result).toBeNull()
    })

    test("updates accessed time when reusing workspace", async () => {
      await using tmp = await tmpdir({ git: true })

      // Create workspace first
      const existing = await Workspace.create({
        name: "touch-test",
        repoRoot: tmp.path,
      })

      const originalAccessed = existing.time.accessed

      // Wait a bit to ensure time difference
      await new Promise((r) => setTimeout(r, 10))

      const result = await resolveWorkspace("touch-test", tmp.path)

      expect(result).toBeDefined()
      expect(result!.time.accessed).toBeGreaterThan(originalAccessed)

      // Clean up
      await Workspace.remove(existing.id)
    })

    test("verifies worktree exists when reusing workspace", async () => {
      await using tmp = await tmpdir({ git: true })
      const { Git } = await import("../../src/git")

      // Create workspace first
      const existing = await Workspace.create({
        name: "verify-worktree-test",
        repoRoot: tmp.path,
      })

      const result = await resolveWorkspace("verify-worktree-test", tmp.path)

      expect(result).toBeDefined()

      // Verify worktree still exists
      const worktrees = await Git.listWorktrees(tmp.path)
      expect(worktrees.some((w) => w.path === existing.worktreePath)).toBe(true)

      // Clean up
      await Workspace.remove(existing.id)
    })
  })
})
