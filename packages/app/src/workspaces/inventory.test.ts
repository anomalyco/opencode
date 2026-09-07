import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { WorktreeDirectory } from "@opencode-ai/client/promise"
import { createWorktreeInventory, withWorktreeInventory, worktreeInventoryKey } from "./inventory"
import { ServerScope } from "@/runtime/server/scope"
import { normalizeProjectInfo, updateProjectInfo } from "@/runtime/server/global-sync/utils"

function setup(list: (directory: string) => Promise<WorktreeDirectory[]>) {
  const client = new QueryClient()
  const calls: string[] = []
  const updates: Array<[string, WorktreeDirectory[]]> = []
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: (input) => {
        const directory = input!.location!.directory!
        calls.push(directory)
        return list(directory)
      },
    }),
    updated: (directory, items) => updates.push([directory, items]),
  })
  return { client, calls, updates, inventory }
}

describe("createWorktreeInventory", () => {
  test("loads once per project, shares in-flight work, and publishes the result", async () => {
    const gate = Promise.withResolvers<void>()
    const setupResult = setup(async (directory) => {
      await gate.promise
      return [{ directory }, { directory: `${directory}/feature`, strategy: "git" }]
    })
    const first = setupResult.inventory.load("/repo")
    const second = setupResult.inventory.load("/repo/")
    expect(setupResult.calls).toEqual(["/repo"])
    gate.resolve()
    expect(await first).toHaveLength(2)
    expect(await second).toHaveLength(2)
    await setupResult.inventory.load("/repo")
    expect(setupResult.calls).toEqual(["/repo"])
    expect(setupResult.updates).toEqual([
      ["/repo", [{ directory: "/repo" }, { directory: "/repo/feature", strategy: "git" }]],
    ])
    expect(setupResult.inventory.cached("/repo/")).toHaveLength(2)
    setupResult.client.clear()
  })

  test("refreshes only inventories a view already loaded", async () => {
    const setupResult = setup(async (directory) => [{ directory }])
    await setupResult.inventory.refresh("/never-opened")
    expect(setupResult.calls).toEqual([])
    await setupResult.inventory.load("/opened")
    await setupResult.inventory.refresh("/opened")
    expect(setupResult.calls).toEqual(["/opened", "/opened"])
    setupResult.client.clear()
  })

  test("a failed load is not cached and never rejects the caller", async () => {
    let fail = true
    const setupResult = setup(async (directory) => {
      if (fail) throw new Error("Location unavailable")
      return [{ directory }]
    })
    expect(await setupResult.inventory.load("/repo")).toBeUndefined()
    expect(setupResult.inventory.cached("/repo")).toBeUndefined()
    fail = false
    expect(await setupResult.inventory.load("/repo")).toEqual([{ directory: "/repo" }])
    expect(setupResult.calls).toEqual(["/repo", "/repo"])
    setupResult.client.clear()
  })

  test("keys are partitioned by server and normalized by path", () => {
    const remote = "https://remote.example" as typeof ServerScope.local
    expect(worktreeInventoryKey(ServerScope.local, "C:\\Repo\\")).toEqual(
      worktreeInventoryKey(ServerScope.local, "C:/Repo"),
    )
    expect(worktreeInventoryKey(ServerScope.local, "/repo")).not.toEqual(worktreeInventoryKey(remote, "/repo"))
  })
})

describe("withWorktreeInventory", () => {
  const metadata = {
    id: "project",
    canonical: "/repo",
    name: "Before",
    time: { created: 1, updated: 1 },
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
    const updated = updateProjectInfo(withWorktreeInventory(project, cached), { ...metadata, name: "After" })
    expect(withWorktreeInventory(updated, cached)).toMatchObject({ name: "After", sandboxes: ["/repo/feature"] })
  })
})
