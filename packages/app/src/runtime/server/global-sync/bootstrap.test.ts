import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { OpenCode } from "@opencode-ai/client/promise"
import { createStore } from "solid-js/store"
import { bootstrapGlobal, loadPathQuery, loadProjectsQuery } from "./bootstrap"
import { ServerScope } from "@/runtime/server/scope"
import type { ServerApi } from "@/runtime/server/api"
import type { ServerSync } from "@/runtime/server/sync"

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

  test("loads each project's inventory through its own location using the real client", async () => {
    const calls: string[] = []
    const api = OpenCode.make({
      baseUrl: "http://localhost:3000",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input, init).url)
          if (url.pathname === "/api/project")
            return Response.json([
              { id: "b", canonical: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
              { id: "a", canonical: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
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

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api.project, api.worktree))

    expect(result.map((project) => project.id)).toEqual(["a", "b"])
    expect(result.map((project) => project.sandboxes)).toEqual([
      ["/a/clone", "/a/copy"],
      ["/b/clone", "/b/copy"],
    ])
    expect(result.map((project) => project.worktrees)).toEqual([
      [{ directory: "/a" }, { directory: "/a/clone" }, { directory: "/a/copy", strategy: "git" }],
      [{ directory: "/b" }, { directory: "/b/clone" }, { directory: "/b/copy", strategy: "git" }],
    ])
    expect(calls.toSorted()).toEqual(["/a", "/b"])
  })

  test("keeps projects whose directory inventory cannot load", async () => {
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

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api.project, api.worktree))

    expect(result.map((project) => ({ id: project.id, sandboxes: project.sandboxes }))).toEqual([
      { id: "a", sandboxes: ["/a/copy"] },
      { id: "b", sandboxes: [] },
    ])
  })
})
