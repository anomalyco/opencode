import { Log } from "@/util/log"

export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  interface NamedEntry {
    key: string
    init: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()
  const namedRegistry = new Map<string, Set<NamedEntry>>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    return () => {
      const key = root()
      let entries = recordsByKey.get(key)
      if (!entries) {
        entries = new Map<string, Entry>()
        recordsByKey.set(key, entries)
      }
      const exists = entries.get(init)
      if (exists) return exists.state as S
      const state = init()
      entries.set(init, {
        state,
        dispose,
      })
      return state
    }
  }

  export function register<S>(
    name: string,
    root: () => string,
    init: () => S,
    dispose?: (state: Awaited<S>) => Promise<void>,
  ) {
    const getter = create(root, init, dispose)

    const wrappedGetter = () => {
      const key = root()
      let entries = namedRegistry.get(name)
      if (!entries) {
        entries = new Set()
        namedRegistry.set(name, entries)
      }

      const hasEntry = Array.from(entries).some((e) => e.key === key && e.init === init)
      if (!hasEntry) {
        entries.add({
          key,
          init,
          dispose,
        })
      }

      return getter()
    }

    return wrappedGetter
  }

  /**
   * Invalidates (disposes and removes) state entries registered under the given name.
   *
   * If the `name` ends with `:*`, it is treated as a wildcard pattern and all registered names
   * that start with the given prefix (before the `:*`) will be invalidated.
   *
   * If a `key` is provided, only entries matching both the name and key will be invalidated.
   * If `key` is omitted, all entries for the given name (or matching names, if using a wildcard) will be invalidated.
   *
   * @param {string} name - The registered name of the state to invalidate. Supports wildcard patterns (e.g., "foo:*").
   * @param {string} [key] - Optional key to further filter which state entries to invalidate.
   * @returns {Promise<void>} Resolves when all matching state entries have been invalidated.
   *
   * @example
   * // Invalidate all state entries registered under "user"
   * await State.invalidate("user");
   *
   * // Invalidate only the state entry for "user" with a specific key
   * await State.invalidate("user", "user:123");
   *
   * // Invalidate all state entries for all names starting with "cache:"
   * await State.invalidate("cache:*");
   */
  export async function invalidate(name: string, key?: string) {
    const pattern = name.endsWith(":*") ? name.slice(0, -1) : null
    if (pattern) {
      const tasks: Promise<void>[] = []
      for (const [registeredName] of namedRegistry) {
        if (registeredName.startsWith(pattern)) {
          tasks.push(invalidate(registeredName, key))
        }
      }
      await Promise.all(tasks)
      return
    }

    const entries = namedRegistry.get(name)
    if (!entries) {
      return
    }

    log.info("invalidating state", { name, key: key ?? "all" })

    const tasks: Promise<void>[] = []
    for (const entry of entries) {
      if (key && entry.key !== key) continue

      const keyRecords = recordsByKey.get(entry.key)
      if (!keyRecords) continue

      const stateEntry = keyRecords.get(entry.init)
      if (!stateEntry) continue

      if (stateEntry.dispose) {
        const task = Promise.resolve(stateEntry.state)
          .then((state) => stateEntry.dispose!(state))
          .catch((error) => {
            log.error("Error while disposing state", { error, name, key: entry.key })
          })
        tasks.push(task)
      }

      keyRecords.delete(entry.init)
    }

    await Promise.all(tasks)
    log.info("state invalidation completed", { name, key: key ?? "all" })
  }

  export async function dispose(key: string) {
    const entries = recordsByKey.get(key)
    if (!entries) return

    log.info("waiting for state disposal to complete", { key })

    let disposalFinished = false

    setTimeout(() => {
      if (!disposalFinished) {
        log.warn(
          "state disposal is taking an unusually long time - if it does not complete in a reasonable time, please report this as a bug",
          { key },
        )
      }
    }, 10000).unref()

    const tasks: Promise<void>[] = []
    for (const entry of entries.values()) {
      if (!entry.dispose) continue

      const task = Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state))
        .catch((error) => {
          log.error("Error while disposing state:", { error, key })
        })

      tasks.push(task)
    }
    recordsByKey.delete(key)
    await Promise.all(tasks)
    disposalFinished = true
    log.info("state disposal completed", { key })
  }
}
