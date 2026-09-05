import { expect, test } from "bun:test"
import { QueryClient, QueryObserver } from "@tanstack/solid-query"
import { createWorktreeInventory, withWorktreeInventory } from "./inventory"
import { ServerScope } from "@/runtime/server/scope"
import { normalizeProjectInfo, updateProjectInfo } from "@/runtime/server/global-sync/utils"

function pending() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

test("picker demand loads once, shares in-flight work, and reuses cache", async () => {
  const client = new QueryClient()
  const calls: string[] = []
  const gate = pending()
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: async (input) => {
        const directory = input!.location!.directory!
        calls.push(directory)
        await gate.promise
        return [{ directory }, { directory: `${directory}/existing`, strategy: "git" }]
      },
    }),
  })
  const closed = new QueryObserver(client, { ...inventory.query("/repo"), enabled: false })
  const unsubscribe = closed.subscribe(() => {})
  expect(calls).toEqual([])
  closed.setOptions({ ...inventory.query("/repo"), enabled: true })
  expect(closed.getCurrentResult().isFetching).toBe(true)
  const duplicate = client.fetchQuery(inventory.query("/repo/"))
  expect(calls).toEqual(["/repo"])
  gate.resolve()
  expect(await duplicate).toHaveLength(2)
  await client.fetchQuery(inventory.query("/repo"))
  expect(calls).toEqual(["/repo"])
  unsubscribe()
  client.clear()
})

test("invalidation is targeted and does not fetch inactive inventories", async () => {
  const client = new QueryClient()
  const calls: string[] = []
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: async (input) => {
        const directory = input!.location!.directory!
        calls.push(directory)
        return [{ directory }]
      },
    }),
  })
  await client.fetchQuery(inventory.query("/a"))
  await client.fetchQuery(inventory.query("/b"))
  await inventory.invalidate("/a")
  expect(calls).toEqual(["/a", "/b"])
  await client.fetchQuery(inventory.query("/b"))
  await client.fetchQuery(inventory.query("/a"))
  expect(calls).toEqual(["/a", "/b", "/a"])
  client.clear()
})

test("explicit multi-project inventory has at most four active lists and cancels queued offscreen demand", async () => {
  const client = new QueryClient()
  const calls: string[] = []
  const gate = pending()
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: async (input) => {
        const directory = input!.location!.directory!
        calls.push(directory)
        await gate.promise
        return [{ directory }]
      },
    }),
  })
  const queries = Array.from({ length: 20 }, (_, index) =>
    client.fetchQuery(inventory.query(`/repo/${index}`)).catch(() => undefined),
  )
  await Promise.resolve()
  expect(calls).toHaveLength(4)
  await client.cancelQueries()
  gate.resolve()
  await Promise.all(queries)
  await Promise.resolve()
  expect(calls).toHaveLength(4)
  client.clear()
})

test("switching the selected project exposes its own pending/error state, not previous choices", async () => {
  const client = new QueryClient()
  const gate = pending()
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: async (input) => {
        const directory = input!.location!.directory!
        if (directory === "/b") {
          await gate.promise
          throw new Error("Unavailable")
        }
        return [{ directory }, { directory: "/a/existing" }]
      },
    }),
  })
  await client.fetchQuery(inventory.query("/a"))
  const observer = new QueryObserver(client, inventory.query("/a"))
  const unsubscribe = observer.subscribe(() => {})
  expect(observer.getCurrentResult().data).toHaveLength(2)
  observer.setOptions(inventory.query("/b"))
  expect(observer.getCurrentResult().isPending).toBe(true)
  expect(observer.getCurrentResult().data).toBeUndefined()
  gate.resolve()
  await client.fetchQuery(inventory.query("/b")).catch(() => undefined)
  expect(observer.getCurrentResult().isError).toBe(true)
  expect(observer.getCurrentResult().data).toBeUndefined()
  unsubscribe()
  client.clear()
})

test("visible multi-project demand drains the bounded queue and deduplicates canonical directories", async () => {
  const client = new QueryClient()
  const calls: string[] = []
  let active = 0
  let peak = 0
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: async (input) => {
        const directory = input!.location!.directory!
        calls.push(directory)
        active++
        peak = Math.max(peak, active)
        await Promise.resolve()
        active--
        return [{ directory }]
      },
    }),
  })
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      client.fetchQuery(inventory.query(`/repo/${index % 20}${index >= 20 ? "/" : ""}`)),
    ),
  )
  expect(calls).toHaveLength(20)
  expect(new Set(calls).size).toBe(20)
  expect(peak).toBe(4)
  client.clear()
})

test("an update during an active list does not cancel it and start another backend refresh", async () => {
  const client = new QueryClient()
  const gate = pending()
  let calls = 0
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: async () => {
        calls++
        await gate.promise
        return [{ directory: "/repo" }]
      },
    }),
  })
  const observer = new QueryObserver(client, inventory.query("/repo"))
  const unsubscribe = observer.subscribe(() => {})
  const invalidated = inventory.invalidate("/repo")
  expect(calls).toBe(1)
  gate.resolve()
  await invalidated
  expect(calls).toBe(1)
  expect(observer.getCurrentResult().data).toEqual([{ directory: "/repo" }])
  unsubscribe()
  client.clear()
})

test("an unopened inventory update waits until a view mounts, overriding the app's no-refetch default", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false } } })
  let calls = 0
  const inventory = createWorktreeInventory({
    scope: ServerScope.local,
    queryClient: client,
    api: () => ({
      list: async () => {
        calls++
        return [{ directory: `/repo/feature-${calls}` }]
      },
    }),
  })
  await client.fetchQuery(inventory.query("/repo"))
  await inventory.invalidate("/repo")
  expect(calls).toBe(1)
  const observer = new QueryObserver(client, inventory.query("/repo"))
  const unsubscribe = observer.subscribe(() => {})
  expect(calls).toBe(2)
  await client.fetchQuery(inventory.query("/repo"))
  expect(calls).toBe(2)
  expect(observer.getCurrentResult().data).toEqual([{ directory: "/repo/feature-2" }])
  unsubscribe()
  client.clear()
})

test("cached inventory survives metadata updates and is partitioned by server", async () => {
  const client = new QueryClient()
  const api = () => ({ list: async () => [{ directory: "/repo/feature", strategy: "git" }] })
  const local = createWorktreeInventory({ scope: ServerScope.local, queryClient: client, api })
  const remote = createWorktreeInventory({
    scope: "https://remote.example" as typeof ServerScope.local,
    queryClient: client,
    api,
  })
  const cached = await client.fetchQuery(local.query("/repo"))
  expect(client.getQueryData(remote.query("/repo").queryKey)).toBeUndefined()
  const metadata = {
    id: "project",
    canonical: "/repo",
    name: "Before",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  }
  const updated = updateProjectInfo(normalizeProjectInfo(metadata), { ...metadata, name: "After" })
  expect(withWorktreeInventory(updated, cached)).toMatchObject({
    name: "After",
    sandboxes: ["/repo/feature"],
    worktrees: cached,
  })
  expect(local.query("C:\\Repo\\").queryKey).toEqual(local.query("C:/Repo").queryKey)
  expect(local.query("C:/Repo").queryKey).not.toEqual(local.query("C:/repo").queryKey)
  client.clear()
})
