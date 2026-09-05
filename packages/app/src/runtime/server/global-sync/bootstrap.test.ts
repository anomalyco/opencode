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
        if (url.pathname === "/api/worktree") return Response.json([{ directory: "/repo" }])
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

    queryClient.setQueryData(worktreeInventoryKey(ServerScope.local, "/repo"), [
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

  test("loads 400 historical project records without discovering their worktrees", async () => {
    const calls: string[] = []
    const api = OpenCode.make({
      baseUrl: "http://localhost:3000",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input, init).url)
          if (url.pathname === "/api/project")
            return Response.json([
              ...Array.from({ length: 400 }, (_, index) => ({
                id: `project-${index.toString().padStart(3, "0")}`,
                canonical: `/old/${index}`,
                name: `Project ${index}`,
                time: { created: 1, updated: 1 },
                sandboxes: [`/old/${index}/known`],
              })),
              { id: "test", canonical: "/tmp/opencode-test-123", time: { created: 1, updated: 1 }, sandboxes: [] },
              { id: "empty", canonical: "", time: { created: 1, updated: 1 }, sandboxes: [] },
              { id: "duplicate", canonical: "/old/0", time: { created: 1, updated: 1 }, sandboxes: [] },
            ])
          const directory = url.searchParams.get("location[directory]")
          if (url.pathname !== "/api/worktree" || !directory) throw new Error(`Unexpected request: ${url}`)
          calls.push(directory)
          return Response.json([
            { directory },
            { directory: `${directory}/clone` },
            { directory: `${directory}/copy`, strategy: "git" },
          ])
        },
        { preconnect() {} },
      ),
    })

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api.project))

    expect(calls).toEqual([])
    expect(result).toHaveLength(401)
    expect(result.find((project) => project.id === "project-000")).toMatchObject({
      name: "Project 0",
      worktree: "/old/0",
      sandboxes: ["/old/0/known"],
    })
    expect(result.some((project) => project.id === "test" || project.id === "empty")).toBe(false)
  })

  test("keeps metadata without consulting unavailable directories", async () => {
    const api = OpenCode.make({
      baseUrl: "http://localhost:3000",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input, init).url)
          if (url.pathname === "/api/project")
            return Response.json([
              { id: "a", canonical: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
              { id: "b", canonical: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
            ])
          const directory = url.searchParams.get("location[directory]")
          if (url.pathname !== "/api/worktree" || !directory) throw new Error(`Unexpected request: ${url}`)
          if (directory === "/b") return Response.json({ message: "unavailable" }, { status: 503 })
          return Response.json([{ directory: "/a/copy", strategy: "git" }])
        },
        { preconnect() {} },
      ),
    })

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api.project))

    expect(result.map((project) => ({ id: project.id, sandboxes: project.sandboxes }))).toEqual([
      { id: "a", sandboxes: [] },
      { id: "b", sandboxes: [] },
    ])
  })
})
