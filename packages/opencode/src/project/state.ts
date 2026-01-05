import { Log } from "@/util/log"

export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    const initFn = init
    const getter = () => {
      const key = root()
      let entries = recordsByKey.get(key)
      if (!entries) {
        entries = new Map<string, Entry>()
        recordsByKey.set(key, entries)
      }
      const exists = entries.get(initFn)
      if (exists) return exists.state as S
      const state = initFn()
      entries.set(initFn, {
        state,
        dispose,
      })
      return state
    }
    getter.reset = () => {
      const key = root()
      const entries = recordsByKey.get(key)
      if (entries) {
        entries.delete(initFn)
      }
    }
    return getter
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
    entries.clear()
    await Promise.allSettled(tasks)
    disposalFinished = true
    log.info("state disposal completed", { key })
  }
}
