import { Log } from "@/util/log"

export namespace State {
  export type Accessor<S> = (() => S) & {
    reset: () => Promise<void>
  }

  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): Accessor<S> {
    const fn = (() => {
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
    }) as Accessor<S>

    fn.reset = async () => {
      await disposeInit(root(), init)
    }

    return fn
  }

  async function disposeInit(key: string, init: any) {
    const entries = recordsByKey.get(key)
    if (!entries) return
    const entry = entries.get(init)
    if (!entry) return

    if (entry.dispose) {
      await Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state))
        .catch((error) => {
          const label = typeof init === "function" ? init.name : String(init)
          log.error("Error while disposing state:", { error, key, init: label })
        })
    }

    entries.delete(init)
    if (!entries.size) recordsByKey.delete(key)
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
    for (const [init, entry] of entries) {
      if (!entry.dispose) continue

      const label = typeof init === "function" ? init.name : String(init)

      const task = Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state))
        .catch((error) => {
          log.error("Error while disposing state:", { error, key, init: label })
        })

      tasks.push(task)
    }
    await Promise.all(tasks)

    entries.clear()
    recordsByKey.delete(key)

    disposalFinished = true
    log.info("state disposal completed", { key })
  }
}
