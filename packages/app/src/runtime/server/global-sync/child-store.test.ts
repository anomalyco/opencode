import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot, getOwner, type Owner } from "solid-js"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import type { QueryOptionsApi } from "../sync"
import { ServerScope } from "@/runtime/server/scope"
import type { Data } from "@opencode-ai/client/solid"

let createChildStoreManager: typeof import("./child-store").createChildStoreManager
const querySingles: Array<() => { queryKey?: unknown[]; enabled?: boolean }> = []
const persist: typeof import("@/runtime/persistence/storage").persisted = (_target, store) => [
  store[0],
  store[1],
  null,
  Object.assign(() => true, { promise: undefined }),
]

const child = () => createStore({} as State)
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

function createOwner(callback: (owner: Owner) => void) {
  return createRoot((dispose) => {
    const owner = getOwner()
    if (!owner) throw new Error("owner required")
    callback(owner)

    return dispose
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
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      connected: () => true,
      scope: ServerScope.local,
      persist,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onMcp() {},
      onDispose() {},
      translate: (key) => key,
      queryOptions: queryOptionsApi,
      data,
      global: { path },
    })

    Array.from({ length: 30 }, (_, index) => `/pinned-${index}`).forEach((directory) => {
      manager.children[directory] = child()
      manager.pin(directory)
    })

    const directory = "/active"
    manager.children[directory] = child()
    manager.mark(directory)

    expect(manager.children[directory]).toBeDefined()
  })

  test("starts new child stores as loading and bootstraps them on first access", () => {
    const bootstraps: string[] = []
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        connected: () => true,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap(directory) {
          bootstraps.push(directory)
        },
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        data,
        global: { path },
      })
    })

    try {
      if (!manager) throw new Error("manager required")

      const [store] = manager.child("/project")

      expect(store.status).toBe("loading")
      expect(bootstraps).toEqual(["/project"])
    } finally {
      dispose()
    }
  })

  test("provides the requested directory while the path query is pending", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        connected: () => true,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        data,
        global: { path },
      })
    })

    try {
      if (!manager) throw new Error("manager required")

      const [store] = manager.child("/project", { bootstrap: false })

      expect(store.path.directory).toBe("/project")
      expect(store.path.worktree).toBe("")
    } finally {
      dispose()
    }
  })

  test("writes refreshed VCS data to the child store", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        connected: () => true,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        data,
        global: { path },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })

      manager.vcs("/project", { branch: "feature", default_branch: "main" })

      expect(store.vcs).toEqual({ branch: "feature", default_branch: "main" })
    } finally {
      dispose()
    }
  })

  test("syncs MCP only when requested for the directory", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const offset = querySingles.length
    const mcpLoads: string[] = []

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        connected: () => true,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp(directory) {
          mcpLoads.push(directory)
        },
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        data,
        global: { path },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [, setStore] = manager.child("/project", { bootstrap: false })
      expect(querySingles.length - offset).toBe(1)

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
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const offset = querySingles.length
    const bootstraps: string[] = []

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        connected: () => true,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap(directory) {
          bootstraps.push(directory)
        },
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        data,
        global: { path },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/project", { bootstrap: false })
      const queries = querySingles.slice(offset)

      expect(queries).toHaveLength(1)
      expect(queries[0]?.().enabled).toBe(false)
      expect(store.path.directory).toBe("/project")
      expect(store.provider_ready).toBe(false)
      expect(store.lsp_ready).toBe(false)
      expect(bootstraps).toEqual([])

      manager.child("/project")
      expect(queries[0]?.().enabled).toBe(true)
      expect(bootstraps).toEqual(["/project"])

      manager.child("/project", { bootstrap: false })
      expect(queries[0]?.().enabled).toBe(true)
    } finally {
      dispose()
    }
  })

  test("does not mark unsynced provider data as ready", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        connected: () => true,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        data,
        global: { path },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [store] = manager.child("/cancelled")
      expect(store.provider_ready).toBe(false)
    } finally {
      dispose()
    }
  })

  test("does not enable location queries before the event handshake", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    let connected = false
    const offset = querySingles.length
    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        connected: () => connected,
        scope: ServerScope.local,
        persist,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        data,
        global: { path },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      manager.child("/handshake")
      const queries = querySingles.slice(offset)
      expect(queries[0]?.().enabled).toBe(false)

      connected = true
      expect(queries[0]?.().enabled).toBe(true)
    } finally {
      dispose()
    }
  })
})
