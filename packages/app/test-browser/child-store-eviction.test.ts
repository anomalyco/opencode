import { expect, test } from "bun:test"
import { createComponent, createMemo, createRoot, getOwner } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Predicate } from "effect"
import type { Data } from "@opencode/client/solid"
import type { persisted } from "@/runtime/persistence/storage"
import { createChildStoreManager } from "@/runtime/server/global-sync/child-store"
import { MAX_DIR_STORES } from "@/runtime/server/global-sync/types"
import type { QueryOptionsApi } from "@/runtime/server/sync"
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

// SAFETY: the child store builds only the LSP query, which this value provides.
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
const queryOptions = {
  lsp: (directory: string) => ({ queryKey: [directory, "lsp"], queryFn: async () => [] }),
} as unknown as QueryOptionsApi

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
    let manager: ReturnType<typeof createChildStoreManager> | undefined

    createComponent(QueryClientProvider, {
      client: new QueryClient(),
      get children() {
        const owner = getOwner()

        if (!owner) throw new Error("owner required")

        manager = createChildStoreManager({
          owner,
          connected: () => false,
          scope: ServerScope.local,
          persist,
          isBooting: () => false,
          isLoadingSessions: () => false,
          onBootstrap() {},
          onMcp() {},
          onDispose() {},
          translate: (key) => key,
          queryOptions,
          data,
          global: { path: { state: "", config: "", worktree: "", directory: "", home: "" } },
        })

        return undefined
      },
    })

    if (!manager) throw new Error("manager required")
    const children = manager

    createMemo(() => directories.map((directory) => children.child(directory, { bootstrap: false })[0].projectMeta))

    return { manager: children, dispose }
  })

  try {
    // A recreated store starts another hydration, so wait until none is left.
    while (hydrations.length > 0) await Promise.all(hydrations.splice(0))

    expect(created.filter((key) => key === "workspace:project")).toHaveLength(directories.length)
    expect(directories.map((directory) => root.manager.children[directory]?.[0].projectMeta?.name)).toEqual(
      directories.map(() => "stored"),
    )
  } finally {
    root.dispose()
  }
})
