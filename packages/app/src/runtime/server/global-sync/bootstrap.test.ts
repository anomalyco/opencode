import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { OpenCode } from "@opencode-ai/client/promise"
import { createStore } from "solid-js/store"
import { bootstrapGlobal, loadPathQuery, loadProjectsQuery } from "./bootstrap"
import { ServerScope } from "@/runtime/server/scope"
import type { ServerApi } from "@/runtime/server/api"
import type { ServerSync } from "@/runtime/server/sync"
import { worktreeInventoryKey } from "@/workspaces/inventory"

test("bootstraps projects through the native store setter and preserves subsequent updates", async () => {
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url)
        if (url.pathname === "/api/location")
          return Response.json({
            directory: "/repo",
            project: { id: "project", directory: "/repo", canonical: "/repo" },
          })
        if (url.pathname === "/api/project")
          return Response.json([{ id: "project", canonical: "/repo", time: { created: 1, updated: 1 }, sandboxes: [] }])
        throw new Error(`Unexpected request: ${url.pathname}`)
      },
      { preconnect() {} },
    ),
  })
  const [store, setStore] = createStore<ServerSync["data"]>({
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: [],
    provider_auth: {},
    config: {},
    reload: undefined,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  try {
    await bootstrapGlobal({ serverAPI: api, scope: ServerScope.local, setGlobalStore: setStore, queryClient })
    expect(store.project.map((project) => [project.id, project.worktree])).toEqual([["project", "/repo"]])

    setStore("project", (projects) => projects.map((project) => ({ ...project, name: "Renamed" })))
    expect(store.project[0]?.name).toBe("Renamed")
    setStore("project", [])
    expect(store.project).toEqual([])

    await bootstrapGlobal({ serverAPI: api, scope: ServerScope.local, setGlobalStore: setStore, queryClient })
    expect(store.project.map((project) => [project.id, project.worktree])).toEqual([["project", "/repo"]])
    expect(store.config).toEqual({})

    // A refetch keeps the inventory a view already loaded for this project.
    queryClient.setQueryData(worktreeInventoryKey(ServerScope.local, "/repo/"), [
      { directory: "/repo" },
      { directory: "/repo/feature", strategy: "git" },
    ])
    await bootstrapGlobal({ serverAPI: api, scope: ServerScope.local, setGlobalStore: setStore, queryClient })
    expect(store.project[0]?.sandboxes).toEqual(["/repo/feature"])
    expect(store.project[0]?.worktrees).toEqual([
      { directory: "/repo" },
      { directory: "/repo/feature", strategy: "git" },
    ])
  } finally {
    queryClient.clear()
  }
})

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const location = {} as ServerApi["location"]
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", location).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", location).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
  })

  test("loads current location metadata", async () => {
    const calls: unknown[] = []
    const api = {
      get: async (input: unknown) => {
        calls.push(input)
        return { directory: "/repo/subpath", project: { id: "project", directory: "/repo" } }
      },
    } as ServerApi["location"]

    const result = await new QueryClient().fetchQuery(loadPathQuery(ServerScope.local, "/repo/subpath", api))

    expect(calls).toEqual([{ location: { directory: "/repo/subpath" } }])
    expect(result).toMatchObject({ directory: "/repo/subpath", worktree: "/repo" })
  })

  test("loads project metadata without enumerating any project's worktrees", async () => {
    const requests: string[] = []
    const api = OpenCode.make({
      baseUrl: "http://localhost:3000",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input, init).url)
          requests.push(url.pathname)
          if (url.pathname !== "/api/project") throw new Error(`Unexpected request: ${url}`)
          return Response.json([
            ...Array.from({ length: 300 }, (_, index) => ({
              id: `historical-${index.toString().padStart(3, "0")}`,
              canonical: `/history/${index}`,
              time: { created: 1, updated: 1 },
              sandboxes: [],
            })),
            { id: "b", canonical: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
            { id: "a", canonical: "/a", time: { created: 1, updated: 1 }, sandboxes: ["/a/legacy"] },
            { id: "test", canonical: "/tmp/opencode-test-1", time: { created: 1, updated: 1 }, sandboxes: [] },
          ])
        },
        { preconnect() {} },
      ),
    })

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api.project))

    expect(requests).toEqual(["/api/project"])
    expect(result).toHaveLength(302)
    expect(result.slice(0, 2)).toMatchObject([
      { id: "a", worktree: "/a", sandboxes: ["/a/legacy"], worktrees: [{ directory: "/a" }] },
      { id: "b", worktree: "/b", sandboxes: [], worktrees: [{ directory: "/b" }] },
    ])
    expect(result.some((project) => project.id === "test")).toBe(false)
  })
})
