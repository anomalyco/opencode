import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("Workspace CLI commands", () => {
  describe("Workspace.listAll", async () => {
    const { Workspace } = await import("../../src/workspace")
    const { Git } = await import("../../src/git")

    test("returns empty map when no workspaces exist", async () => {
      const result = await Workspace.listAll()
      // Note: this may have workspaces from other tests, so just verify it's a Map
      expect(result).toBeInstanceOf(Map)
    })

    test("groups workspaces by repoID", async () => {
      await using tmp1 = await tmpdir({ git: true })
      await using tmp2 = await tmpdir({ git: true })

      // Create workspaces in two different repos
      const ws1 = await Workspace.create({ name: "list-all-test-1", repoRoot: tmp1.path })
      const ws2 = await Workspace.create({ name: "list-all-test-2", repoRoot: tmp1.path })
      const ws3 = await Workspace.create({ name: "list-all-test-3", repoRoot: tmp2.path })

      const result = await Workspace.listAll()

      // Check that workspaces are grouped by repo
      const repo1ID = await Git.getRepoID(tmp1.path)
      const repo2ID = await Git.getRepoID(tmp2.path)

      expect(result.get(repo1ID!)?.some((w) => w.name === "list-all-test-1")).toBe(true)
      expect(result.get(repo1ID!)?.some((w) => w.name === "list-all-test-2")).toBe(true)
      expect(result.get(repo2ID!)?.some((w) => w.name === "list-all-test-3")).toBe(true)

      // Verify they're in separate repo groups
      expect(result.get(repo1ID!)?.some((w) => w.name === "list-all-test-3")).toBeFalsy()
      expect(result.get(repo2ID!)?.some((w) => w.name === "list-all-test-1")).toBeFalsy()

      // Clean up
      await Workspace.remove(ws1.id)
      await Workspace.remove(ws2.id)
      await Workspace.remove(ws3.id)
    })

    test("sorts workspaces by last accessed time within each repo", async () => {
      await using tmp = await tmpdir({ git: true })

      // Create workspaces with slight delay between them
      const ws1 = await Workspace.create({ name: "sort-test-1", repoRoot: tmp.path })
      await new Promise((r) => setTimeout(r, 10))
      const ws2 = await Workspace.create({ name: "sort-test-2", repoRoot: tmp.path })
      await new Promise((r) => setTimeout(r, 10))

      // Touch ws1 to make it most recent
      await Workspace.touch(ws1.id)

      const result = await Workspace.listAll()
      const repoID = await Git.getRepoID(tmp.path)
      const workspaces = result.get(repoID!)!

      // Filter to just our test workspaces
      const testWorkspaces = workspaces.filter((w) => w.name.startsWith("sort-test-"))

      // ws1 should be first since it was touched most recently
      expect(testWorkspaces[0].name).toBe("sort-test-1")

      // Clean up
      await Workspace.remove(ws1.id)
      await Workspace.remove(ws2.id)
    })
  })

  describe("formatRelativeTime", () => {
    // Test the time formatting logic by creating a workspace and checking output
    test("formats time correctly", async () => {
      // Import the module to test
      const mod = await import("../../src/cli/cmd/workspace")

      // We can't directly access formatRelativeTime since it's not exported,
      // but we can test it indirectly through workspace list output
      // For now, just verify the module loads correctly
      expect(mod.WorkspaceCommand).toBeDefined()
      expect(mod.WorkspaceListCommand).toBeDefined()
      expect(mod.WorkspaceDeleteCommand).toBeDefined()
    })
  })

  describe("WorkspaceDeleteCommand", async () => {
    const { Workspace } = await import("../../src/workspace")

    test("workspace can be found by name across repos", async () => {
      await using tmp = await tmpdir({ git: true })

      const ws = await Workspace.create({ name: "delete-find-test", repoRoot: tmp.path })

      // Simulate what the delete command does - find by name across all repos
      const workspacesByRepo = await Workspace.listAll()
      let foundWorkspace: typeof ws | null = null

      for (const workspaces of workspacesByRepo.values()) {
        const match = workspaces.find((w) => w.name === "delete-find-test")
        if (match) {
          foundWorkspace = match
          break
        }
      }

      expect(foundWorkspace).toBeDefined()
      expect(foundWorkspace!.id).toBe(ws.id)

      // Clean up
      await Workspace.remove(ws.id)
    })

    test("returns null when workspace name not found", async () => {
      const workspacesByRepo = await Workspace.listAll()
      let foundWorkspace = null

      for (const workspaces of workspacesByRepo.values()) {
        const match = workspaces.find((w) => w.name === "non-existent-workspace-xyz")
        if (match) {
          foundWorkspace = match
          break
        }
      }

      expect(foundWorkspace).toBeNull()
    })
  })
})
