import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { OpenCode } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import { bootstrapGlobal, loadPathQuery, loadProjectsQuery } from "./bootstrap"
import { ServerScope } from "@/runtime/server/scope"
import type { ServerApi } from "@/runtime/server/api"
import { createServerTransport } from "@/runtime/server/client"
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
    queryClient.setQueryData(worktreeInventoryKey(ServerScope.local, "project"), [
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

// Chromium aborts in-flight loopback requests with ERR_NETWORK_CHANGED when Windows reconfigures an
// adapter; the client wraps that as ClientError("Transport"), which the bootstrap retry must see through.
test("recovers project metadata after the connection to the server is dropped", async () => {
  const body = JSON.stringify([{ id: "project", canonical: "/repo", time: { created: 1, updated: 1 }, sandboxes: [] }])
  let dropped = 0
  const requests: string[] = []
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        if (dropped >= 2) return
        dropped += 1
        socket.terminate()
      },
      data(socket, chunk) {
        requests.push(String(chunk).split(" ")[0] ?? "")
        socket.end(
          `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\naccess-control-allow-origin: *\r\nconnection: close\r\n\r\n${body}`,
        )
      },
    },
  })
  const transport = createServerTransport({ http: { url: `http://127.0.0.1:${server.port}` } })

  try {
    const result = await new QueryClient({ defaultOptions: { queries: { retry: false } } }).fetchQuery(
      loadProjectsQuery(ServerScope.local, transport.api.project),
    )
    expect(dropped).toBe(2)
    // happy-dom's fetch adds a CORS preflight; only the GET is the retried API call.
    expect(requests.filter((method) => method === "GET")).toHaveLength(1)
    expect(result).toMatchObject([{ id: "project", worktree: "/repo" }])
  } finally {
    server.stop(true)
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
