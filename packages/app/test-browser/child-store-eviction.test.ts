import { expect, test } from "bun:test"
import { createMemo, createRoot, getOwner } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Predicate } from "effect"
import type { Data } from "@opencode/client/solid"
import type { persisted } from "@/runtime/persistence/storage"
import { createChildStoreManager } from "@/runtime/server/global-sync/child-store"
import { MAX_DIR_STORES } from "@/runtime/server/global-sync/types"
import { ServerScope } from "@/runtime/server/scope"

// SAFETY: the child store reads only these location lists, and only from its getters.
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
const data = {
  location: {
    info: () => undefined,
    agent: { list: () => undefined },
    command: { list: () => undefined },
    reference: { list: () => undefined },
    provider: { list: () => undefined },
    model: { list: () => undefined },
    mcp: { server: { list: () => undefined }, resource: { list: () => undefined } },
    vcs: { info: () => undefined },
  },
} as unknown as Data

// Runs under the browser build: the server build of Solid never re-runs the memo.
test("keeps project stores alive when a memo over more directories than the store limit re-runs", async () => {
  const created: string[] = []
  const hydrations: Promise<string>[] = []
  const directories = Array.from({ length: MAX_DIR_STORES + 10 }, (_, index) => `/project-${index}`)
  // Stops hydrating after a bound so a regression fails instead of hanging the runner.
  const limit = directories.length * 10

  // Hydrates a stored project row asynchronously, as persistStore does for a row in drafts.sqlite.
  const persist: typeof persisted = (target, _schema, initial) => {
    const store = createStore(initial)
    const key = Predicate.isString(target) ? target : target.key
    created.push(key)

    if (key !== "workspace:project" || created.length > limit) {
      return [...store, null, Object.assign(() => true, { promise: undefined })]
    }

    const init = Promise.resolve().then(() => {
      store[1](reconcile({ value: { name: "stored" } }))

      return "stored"
    })

    hydrations.push(init)

    return [...store, init, Object.assign(() => true, { promise: init })]
  }

  const root = createRoot((dispose) => {
    const owner = getOwner()

    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      scope: ServerScope.local,
      persist,
      translate: (key) => key,
      data,
      global: { path: { state: "", config: "", worktree: "", directory: "", home: "" } },
    })

    createMemo(() => directories.map((directory) => manager.child(directory)[0].projectMeta))

    return { manager, dispose }
  })

  try {
    // A recreated store starts another hydration, so wait until none is left.
    while (hydrations.length > 0) await Promise.all(hydrations.splice(0))

    expect(created.filter((key) => key === "workspace:project")).toHaveLength(directories.length)
    // Read outside the memo, so these reads pin nothing; a store evicted earlier would be created again here.
    expect(directories.map((directory) => root.manager.child(directory)[0].projectMeta?.name)).toEqual(
      directories.map(() => "stored"),
    )
  } finally {
    root.dispose()
  }
})
