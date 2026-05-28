import { beforeAll, describe, expect, test, mock } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import type { createChildStoreManager as createChildStoreManagerType } from "./child-store"

const child = () => createStore({} as State)

let createChildStoreManager: typeof createChildStoreManagerType

beforeAll(async () => {
  mock.module("@/utils/persist", () => ({
    Persist: {
      workspace: (directory: string, key: string) => `${directory}:${key}`,
    },
    persisted: (_: string, store: [unknown, unknown]) => [store[0], store[1], null, () => true],
  }))

  const mod = await import("./child-store")
  createChildStoreManager = mod.createChildStoreManager
})

describe("createChildStoreManager", () => {
  test("seeds the directory before bootstrap completes", () => {
    createRoot((dispose) => {
      const owner = getOwner()
      if (!owner) throw new Error("owner required")

      const manager = createChildStoreManager({
        owner,
        isBooting: () => false,
        isLoadingSessions: () => false,
        onBootstrap() {},
        onDispose() {},
        translate: (key) => key,
      })

      const [store] = manager.child("/active", { bootstrap: false })

      expect(store.path.directory).toBe("/active")
      dispose()
    })
  })

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
      onDispose() {},
      translate: (key) => key,
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
})
