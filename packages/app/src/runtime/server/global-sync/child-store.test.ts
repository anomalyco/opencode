import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import type { QueryOptionsApi } from "../sync"
import { ServerScope } from "@/runtime/server/scope"
import type { Data } from "@opencode/client/solid"
import type { persisted } from "@/runtime/persistence/storage"

let createChildStoreManager: typeof import("./child-store").createChildStoreManager

const querySingles: Array<() => { queryKey?: unknown[]; enabled?: boolean }> = []

const persist: typeof persisted = (_target, _schema, initial) => [
  ...createStore(initial),
  null,
  Object.assign(() => true, { promise: undefined }),
]

const path = { state: "", config: "", worktree: "", directory: "", home: "" }

const data = {
  location: {
    info: () => undefined,
    agent: { list: () => undefined },
    command: { list: () => undefined },
    reference: { list: () => undefined },
    provider: { list: () => undefined },
    model: { list: () => undefined, default: () => undefined },
    mcp: {
      server: { list: () => undefined },
      resource: { list: () => undefined },
    },
    vcs: { info: () => undefined },
  },
} as unknown as Data

const queryOptionsApi = {
  globalConfig: () => ({ queryKey: ["globalConfig"], queryFn: async () => ({}) }),
  projects: () => ({ queryKey: ["projects"], queryFn: async () => [] }),
  path: (directory: string | null) => ({
    queryKey: [directory, "path"],
    queryFn: async () => ({
      state: "",
      config: "",
      worktree: "",
      directory: directory ?? "",
      home: "",
    }),
  }),
  agents: (directory: string) => ({ queryKey: [directory, "agents"], queryFn: async () => [] }),
  mcp: (directory: string) => ({ queryKey: [directory, "mcp"], queryFn: async () => ({}) }),
  mcpResources: (directory: string) => ({ queryKey: [directory, "mcpResources"], queryFn: async () => ({}) }),
  lsp: (directory: string) => ({ queryKey: [directory, "lsp"], queryFn: async () => [] }),
  references: (directory: string) => ({ queryKey: [directory, "references"], queryFn: async () => [] }),
  sessions: (directory: string) => ({ queryKey: [directory, "loadSessions"] as const }),
} as unknown as QueryOptionsApi

function setup(input: { connected?: () => boolean } = {}) {
  const bootstraps: string[] = []
  const mcpLoads: string[] = []
  const offset = querySingles.length

  return createRoot((dispose) => {
    const owner = getOwner()

    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      connected: input.connected ?? (() => true),
      scope: ServerScope.local,
      persist,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap: (directory) => bootstraps.push(directory),
      onMcp: (directory) => mcpLoads.push(directory),
      onDispose() {},
      translate: (key) => key,
      queryOptions: queryOptionsApi,
      data,
      global: { path },
    })

    return { manager, bootstraps, mcpLoads, queries: () => querySingles.slice(offset), dispose }
  })
}

beforeAll(async () => {
  mock.module("@tanstack/solid-query", () => ({
    useQuery: (options: () => { queryKey?: unknown[]; enabled?: boolean }) => {
      querySingles.push(options)

      return {
        get isLoading() {
          return options().queryKey?.[1] === "path"
        },
        get isSuccess() {
          return false
        },
        get isRefetchError() {
          return false
        },
        get data() {
          if (options().queryKey?.[1] === "path") throw new Error("pending path data read")

          if (options().queryKey?.[1] === "mcp") return options().enabled ? { demo: { status: "disabled" } } : undefined

          if (options().queryKey?.[1] === "lsp") return []

          return undefined
        },
      }
    },
  }))

  createChildStoreManager = (await import("./child-store")).createChildStoreManager
})

describe("createChildStoreManager", () => {
  test("does not evict the active directory during mark", () => {
    const { manager, dispose } = setup()

    try {
      Array.from({ length: 30 }, (_, index) => `/pinned-${index}`).forEach((directory) => {
        manager.children[directory] = createStore({} as State)
        manager.pin(directory)
      })

      manager.children["/active"] = createStore({} as State)
      manager.mark("/active")

      expect(manager.children["/active"]).toBeDefined()
    } finally {
      dispose()
    }
  })

  test("starts new child stores as loading and bootstraps them on first access", () => {
    const { manager, bootstraps, dispose } = setup()

    try {
      const [store] = manager.child("/project")

      expect(store.status).toBe("loading")
      expect(bootstraps).toEqual(["/project"])
    } finally {
      dispose()
    }
  })

  test("provides the requested directory while the path query is pending", () => {
    const { manager, dispose } = setup()

    try {
      const [store] = manager.child("/project", { bootstrap: false })

      expect(store.path.directory).toBe("/project")
      expect(store.path.worktree).toBe("")
    } finally {
      dispose()
    }
  })

  test("syncs MCP only when requested for the directory", () => {
    const { manager, mcpLoads, queries, dispose } = setup()

    try {
      const [, setStore] = manager.child("/project", { bootstrap: false })
      expect(queries()).toHaveLength(1)

      setStore("status", "complete")
      manager.child("/project", { bootstrap: false, mcp: true })
      expect(mcpLoads).toEqual(["/project"])

      manager.disableMcp("/project")
      expect(manager.mcp("/project")).toBe(false)
    } finally {
      dispose()
    }
  })

  test("keeps non-bootstrapping children passive until a real directory access", () => {
    const { manager, bootstraps, queries, dispose } = setup()

    try {
      const [store] = manager.child("/project", { bootstrap: false })

      expect(queries()).toHaveLength(1)
      expect(queries()[0]?.().enabled).toBe(false)
      expect(store.path.directory).toBe("/project")
      expect(store.provider_ready).toBe(false)
      expect(store.lsp_ready).toBe(false)
      expect(bootstraps).toEqual([])

      manager.child("/project")
      expect(queries()[0]?.().enabled).toBe(true)
      expect(bootstraps).toEqual(["/project"])

      manager.child("/project", { bootstrap: false })
      expect(queries()[0]?.().enabled).toBe(true)
    } finally {
      dispose()
    }
  })

  test("does not enable location queries before the event handshake", () => {
    const connection = { connected: false }
    const { manager, queries, dispose } = setup({ connected: () => connection.connected })

    try {
      manager.child("/handshake")
      expect(queries()[0]?.().enabled).toBe(false)

      connection.connected = true
      expect(queries()[0]?.().enabled).toBe(true)
    } finally {
      dispose()
    }
  })
})
