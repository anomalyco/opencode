import { describe, expect, mock, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { State } from "./types"

const skipToken = Symbol("skipToken")

mock.module("@tanstack/solid-query", () => ({
  skipToken,
  queryOptions: (options: unknown) => options,
  QueryClient: class {},
  QueryClientProvider: (props: { children?: unknown }) => props.children,
  useMutation: () => ({ mutateAsync: async () => {} }),
  useQuery: () => ({ isLoading: false, data: undefined, refetch: async () => {} }),
  useQueryClient: () => ({
    fetchQuery: async () => undefined,
    ensureQueryData: async () => undefined,
  }),
  useQueries: (factory: () => { queries: Array<{ queryFn?: unknown }> }) =>
    factory().queries.map((query) => {
      if (query.queryFn === skipToken || typeof query.queryFn !== "function") {
        return { isLoading: false, data: undefined }
      }
      return { isLoading: false, data: query.queryFn() }
    }),
}))

mock.module("@/utils/persist", () => ({
  Persist: {
    workspace: (directory: string, key: string) => ({ key: `${directory}:${key}` }),
  },
  persisted: (_target: unknown, store: ReturnType<typeof createStore>) => [store[0], store[1], null, () => true],
}))

const child = () => createStore({} as State)
const createManager = async () => (await import("./child-store")).createChildStoreManager

describe("createChildStoreManager", () => {
  test("does not evict the active directory during mark", async () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const createChildStoreManager = await createManager()
    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
      getSdk: () => null!,
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

  test("bootstrap false does not load instance-scoped status queries", async () => {
    const createChildStoreManager = await createManager()
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const owner = getOwner()
        if (!owner) {
          dispose()
          reject(new Error("owner required"))
          return
        }

        const calls: string[] = []
        const manager = createChildStoreManager({
          owner,
          isBooting: () => false,
          isLoadingSessions: () => false,
          onBootstrap() {
            calls.push("bootstrap")
          },
          onDispose() {},
          translate: (key) => key,
          getSdk: () =>
            ({
              path: {
                get: () => {
                  calls.push("path")
                  return Promise.resolve({ data: undefined })
                },
              },
              mcp: {
                status: () => {
                  calls.push("mcp")
                  return Promise.resolve({ data: {} })
                },
              },
              lsp: {
                status: () => {
                  calls.push("lsp")
                  return Promise.resolve({ data: [] })
                },
              },
              provider: {
                list: () => {
                  calls.push("provider")
                  return Promise.resolve({ data: { all: [], connected: [], default: {} } })
                },
              },
            }) as never,
        })

        manager.child("/preview", { bootstrap: false })

        queueMicrotask(() => {
          try {
            expect(calls).toEqual([])
            dispose()
            resolve()
          } catch (error) {
            dispose()
            reject(error)
          }
        })
      })
    })
  })
})
