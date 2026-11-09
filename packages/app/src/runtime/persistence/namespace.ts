import type { AsyncStorage } from "@solid-primitives/storage"
import {
  INITIAL_NAMESPACE_STATE,
  selectNamespaceItem,
  selectNamespaceKeys,
  transitionNamespace,
  type NamespaceEffect,
  type NamespaceEvent,
} from "./namespace-machine"

// The host-side store for one namespace: one bulk read, one bulk write. The host stamps every
// update with a monotonic revision and reports it with reads, acks, and change events.
export type NamespaceDriver = {
  items(name: string): Promise<{ items: Record<string, string>; revision: number }>
  update(name: string, insert: Record<string, string>, remove: string[]): Promise<number>
  clear(name: string): Promise<void>
}

export type NamespaceStorage = AsyncStorage & {
  /** Write every queued change now. Resolves when the driver has accepted it. */
  flush(): Promise<void>
  /** Apply a change another window made at `revision`, unless this window already holds something newer. */
  accept(insert: Record<string, string>, remove: string[], revision: number): void
}

// In-memory truth for a namespace. Reads load the namespace once and are Map lookups from then
// on; writes update the cache immediately and are batched into one driver call per flush window,
// so a burst of setter calls costs one round trip. Mirrors VS Code's Storage class. The ordering
// rules live in `namespace-machine.ts`; this driver runs its effects and reports their results.
export function createNamespaceStorage(driver: NamespaceDriver, name: string): NamespaceStorage {
  let state = INITIAL_NAMESPACE_STATE
  // Edge handles only: the armed flush timer, and the requests that reads and `flush()` wait on.
  let timer: ReturnType<typeof setTimeout> | undefined
  let load = Promise.resolve()
  const requests = new Set<Promise<void>>()

  const dispatch = (event: NamespaceEvent) => {
    const next = transitionNamespace(state, event)
    state = next.state
    next.effects.forEach(execute)
  }

  const execute = (effect: NamespaceEffect) => {
    if (effect.type === "timer.arm") {
      clearTimeout(timer)
      timer = setTimeout(() => dispatch({ type: "flush" }), effect.delayMs)

      return
    }

    if (effect.type === "timer.cancel") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "load") {
      load = driver.items(name).then(
        (loaded) => dispatch({ type: "load.succeeded", items: loaded.items, revision: loaded.revision }),
        (error) => {
          console.error(`[persistence] load failed for ${name}`, error)
          dispatch({ type: "load.failed" })
        },
      )

      return
    }

    const batch = effect.batch

    const request = driver
      .update(name, effect.insert, effect.remove)
      .then(
        (revision) => dispatch({ type: "batch.succeeded", batch, revision }),
        (error) => {
          console.error(`[persistence] flush failed for ${name}`, error)
          dispatch({ type: "batch.failed", batch })
        },
      )
      .finally(() => requests.delete(request))

    requests.add(request)
  }

  const loaded = async () => {
    dispatch({ type: "load" })

    if (state.status === "loading") await load
  }

  const storage: NamespaceStorage = {
    getItem: async (key) => {
      await loaded()

      return selectNamespaceItem(state, key)
    },
    setItem: async (key, value) => dispatch({ type: "write", key, value }),
    removeItem: async (key) => dispatch({ type: "write", key, value: null }),
    clear: async () => {
      dispatch({ type: "clear" })
      await driver.clear(name)
    },
    key: async (index: number) => {
      await loaded()

      return selectNamespaceKeys(state)[index]
    },
    getLength: async () => {
      await loaded()

      return selectNamespaceKeys(state).length
    },
    get length() {
      return storage.getLength()
    },
    flush: () => {
      dispatch({ type: "flush" })

      return Promise.all(requests).then(() => undefined)
    },
    accept: (insert, remove, revision) => dispatch({ type: "remote", insert, remove, revision }),
  }

  return storage
}
