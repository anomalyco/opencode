import { describe, expect, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import { createChildStoreManager } from "./child-store"
import { ServerScope } from "@/runtime/server/scope"
import type { Data } from "@opencode/client/solid"
import type { persisted } from "@/runtime/persistence/storage"

const persist: typeof persisted = (_target, _schema, initial) => [
  ...createStore(initial),
  null,
  Object.assign(() => true, { promise: undefined }),
]

const path = { state: "", config: "", worktree: "", directory: "", home: "" }

// SAFETY: the child store reads only this location info, and only from its getters.
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
const data = { location: { info: () => undefined } } as unknown as Data

describe("createChildStoreManager", () => {
  test("provides the requested directory while its location is loading", () => {
    createRoot((dispose) => {
      const owner = getOwner()

      if (!owner) throw new Error("owner required")

      const manager = createChildStoreManager({
        owner,
        scope: ServerScope.local,
        persist,
        translate: (key) => key,
        data,
        global: { path },
      })

      try {
        const [store] = manager.child("/project")

        expect(store.path.directory).toBe("/project")
        expect(store.path.worktree).toBe("")
      } finally {
        dispose()
      }
    })
  })
})
