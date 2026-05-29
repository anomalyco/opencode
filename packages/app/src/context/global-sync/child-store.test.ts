import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot, getOwner, type Owner } from "solid-js"
import { createStore } from "solid-js/store"
import type { NormalizedProviderListResponse } from "@opencode-ai/ui/context"
import type { State } from "./types"
import type { QueryOptionsApi } from "../server-sync"

let createChildStoreManager: typeof import("./child-store").createChildStoreManager
const queryGroups: Array<() => { queries: Array<{ enabled?: boolean }> }> = []

const child = () => createStore({} as State)
const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse

const queryOptionsApi = {
  globalConfig: () => ({ queryKey: ["globalConfig"], queryFn: async () => ({}) }),
  projects: () => ({ queryKey: ["projects"], queryFn: async () => [] }),
  providers: (directory: string | null) => ({ queryKey: [directory, "providers"], queryFn: async () => provider }),
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
  lsp: (directory: string) => ({ queryKey: [directory, "lsp"], queryFn: async () => [] }),
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
  mock.module("@/utils/persist", () => ({
    Persist: {
      workspace: (...parts: string[]) => parts.join(":"),
    },
    persisted: (_target: string, store: unknown[]) => [store[0], store[1], null, () => true],
  }))
  mock.module("@tanstack/solid-query", () => ({
    useQueries: (options: () => { queries: Array<{ enabled?: boolean }> }) => {
      queryGroups.push(options)
      return [
        { isLoading: false, data: { state: "", config: "", worktree: "", directory: "", home: "" } },
        { isLoading: false, data: {} },
        { isLoading: false, data: [] },
        { isLoading: false, data: provider },
      ]
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
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onMcp() {},
      onDispose() {},
      translate: (key) => key,
      queryOptions: queryOptionsApi,
      global: { provider },
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
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap(directory) {
          bootstraps.push(directory)
        },
        onMcp() {},
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
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

  test("enables MCP only when requested for the directory", () => {
    let manager: ReturnType<typeof createChildStoreManager> | undefined
    const offset = queryGroups.length
    const mcpLoads: string[] = []

    const dispose = createOwner((owner) => {
      manager = createChildStoreManager({
        owner,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onMcp(directory) {
          mcpLoads.push(directory)
        },
        onDispose() {},
        translate: (key) => key,
        queryOptions: queryOptionsApi,
        global: { provider },
      })
    })

    try {
      if (!manager) throw new Error("manager required")
      const [, setStore] = manager.child("/project", { bootstrap: false })
      const queries = queryGroups[offset]
      if (!queries) throw new Error("queries required")
      expect(queries().queries[1]?.enabled).toBe(false)

      setStore("status", "complete")
      manager.child("/project", { bootstrap: false, mcp: true })
      expect(queries().queries[1]?.enabled).toBe(true)
      expect(mcpLoads).toEqual(["/project"])

      manager.disableMcp("/project")
      expect(queries().queries[1]?.enabled).toBe(false)
      expect(manager.mcp("/project")).toBe(false)
    } finally {
      dispose()
    }
  })
})
