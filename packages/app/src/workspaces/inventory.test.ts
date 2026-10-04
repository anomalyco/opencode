import { ProjectID } from "@opencode/schema/project-id"
import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { WorktreeDirectory } from "@opencode/client/promise"
import { createWorktreeInventory, withWorktreeInventory, worktreeInventoryKey } from "./inventory"
import { ServerScope } from "@/runtime/server/scope"
import { normalizeProjectInfo, updateProjectInfo } from "@/runtime/server/global-sync/utils"

function setup(list: (directory: string) => Promise<WorktreeDirectory[]>) {
  const client = new QueryClient()
  const refreshed = Promise.withResolvers<void>()
  const refreshes: string[] = []
  const calls: string[] = []
  const updates: Array<[string, WorktreeDirectory[]]> = []
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: (input) => {
        const directory = input.projectID
        calls.push(directory)
        return list(directory)
      },
      refresh: (input) => {
        refreshes.push(input.projectID)
        return refreshed.promise
      },
    }),
    updated: (directory, items) => {
      updates.push([directory, items])
    },
  })
  return { client, calls, updates, inventory, refreshed, refreshes }
}

describe("createWorktreeInventory", () => {
  test("lists a project, shares in-flight work, and publishes each result", async () => {
    const gate = Promise.withResolvers<void>()
    const setupResult = setup(async (directory) => {
      await gate.promise
      return [{ directory }, { directory: `${directory}/feature`, strategy: "git" }]
    })
    const first = setupResult.inventory.list(ProjectID.make("/repo", { disableChecks: true }))
    const second = setupResult.inventory.list(ProjectID.make("/repo", { disableChecks: true }))
    expect(setupResult.calls).toEqual(["/repo"])
    gate.resolve()
    expect(await first).toHaveLength(2)
    expect(await second).toHaveLength(2)
    await setupResult.inventory.list(ProjectID.make("/repo", { disableChecks: true }))
    expect(setupResult.calls).toEqual(["/repo", "/repo"])
    expect(setupResult.updates).toEqual([
      ["/repo", [{ directory: "/repo" }, { directory: "/repo/feature", strategy: "git" }]],
      ["/repo", [{ directory: "/repo" }, { directory: "/repo/feature", strategy: "git" }]],
    ])
    expect(setupResult.inventory.cached(ProjectID.make("/repo", { disableChecks: true }))).toHaveLength(2)
    expect(setupResult.refreshes).toEqual([])
    setupResult.client.clear()
  })

  test("list reads saved inventory without discovery", async () => {
    const setupResult = setup(async (directory) => [{ directory }])
    await setupResult.inventory.list(ProjectID.make("/opened", { disableChecks: true }))
    expect(setupResult.calls).toEqual(["/opened"])
    expect(setupResult.refreshes).toEqual([])
    setupResult.client.clear()
  })

  test("a failed list is not cached and never rejects the caller", async () => {
    let fail = true
    const setupResult = setup(async (directory) => {
      if (fail) throw new Error("Location unavailable")
      return [{ directory }]
    })
    expect(await setupResult.inventory.list(ProjectID.make("/repo", { disableChecks: true }))).toBeUndefined()
    expect(setupResult.inventory.cached(ProjectID.make("/repo", { disableChecks: true }))).toBeUndefined()
    fail = false
    expect(await setupResult.inventory.list(ProjectID.make("/repo", { disableChecks: true }))).toEqual([
      { directory: "/repo" },
    ])
    expect(setupResult.calls).toEqual(["/repo", "/repo"])
    setupResult.client.clear()
  })

  test("keys are partitioned by server and use opaque project IDs", () => {
    const remote = "https://remote.example" as typeof ServerScope.local
    expect(worktreeInventoryKey(ServerScope.local, ProjectID.make("project", { disableChecks: true }))).not.toEqual(
      worktreeInventoryKey(ServerScope.local, ProjectID.make("project/", { disableChecks: true })),
    )
    expect(worktreeInventoryKey(ServerScope.local, ProjectID.make("/repo", { disableChecks: true }))).not.toEqual(
      worktreeInventoryKey(remote, ProjectID.make("/repo", { disableChecks: true })),
    )
  })

  test("refresh discovers without changing cached inventory until the next list", async () => {
    const rows = [{ directory: "/repo" }]
    const result = setup(async () => [...rows])
    expect(await result.inventory.list(ProjectID.make("project", { disableChecks: true }))).toEqual(rows)
    const pending = result.inventory.refresh(ProjectID.make("project", { disableChecks: true }))
    rows.push({ directory: "/external" })
    expect(result.inventory.cached(ProjectID.make("project", { disableChecks: true }))).toEqual([
      { directory: "/repo" },
    ])
    result.refreshed.resolve()
    expect(await pending).toBeUndefined()
    expect(result.calls).toEqual(["project"])
    expect(result.refreshes).toEqual(["project"])
    expect(await result.inventory.list(ProjectID.make("project", { disableChecks: true }))).toEqual(rows)
    result.client.clear()
  })
})

describe("withWorktreeInventory", () => {
  const metadata = {
    id: ProjectID.make("project", { disableChecks: true }),
    canonical: "/repo",
    name: "Before",
    time: { created: 1, updated: 1, active: 1 },
    sandboxes: [],
  }

  test("derives the workspace list from the inventory, excluding the project root", () => {
    const worktrees = [
      { directory: "/repo/" },
      { directory: "/repo/feature", strategy: "git" },
      { directory: "/elsewhere" },
    ]
    expect(withWorktreeInventory(normalizeProjectInfo(metadata), worktrees)).toMatchObject({
      worktree: "/repo",
      sandboxes: ["/repo/feature", "/elsewhere"],
      worktrees,
    })
  })

  test("leaves metadata untouched without an inventory and survives metadata updates", () => {
    const project = normalizeProjectInfo(metadata)
    expect(withWorktreeInventory(project, undefined)).toBe(project)
    const cached = [{ directory: "/repo" }, { directory: "/repo/feature", strategy: "git" }]
    const updated = updateProjectInfo(
      { ...withWorktreeInventory(project, cached), worktree: "/old-repo" },
      { ...metadata, name: "After" },
    )
    expect(updated).toMatchObject({ worktree: "/repo", worktrees: cached })
    expect(withWorktreeInventory(updated, cached)).toMatchObject({ name: "After", sandboxes: ["/repo/feature"] })
  })
})
