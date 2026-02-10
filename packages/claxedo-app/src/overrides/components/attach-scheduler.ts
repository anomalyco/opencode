export type AttachTask = (signal: AbortSignal) => void | Promise<void>

type Entry = {
  key: string
  fn: AttachTask
  controller: AbortController
  resolve: () => void
  reject: (error: unknown) => void
  promise: Promise<void>
  running: boolean
  canceled: boolean
}

export function createAttachScheduler(input?: { concurrency?: number }) {
  const concurrency = Math.max(1, Math.floor(input?.concurrency ?? 2))
  const queue: Entry[] = []
  const byKey = new Map<string, Entry>()
  let active = 0

  const remove = (entry: Entry) => {
    const index = queue.indexOf(entry)
    if (index !== -1) queue.splice(index, 1)
    if (byKey.get(entry.key) === entry) byKey.delete(entry.key)
  }

  const pump = () => {
    while (active < concurrency) {
      const next = queue.find((entry) => !entry.running && !entry.canceled)
      if (!next) return
      next.running = true
      active += 1
      Promise.resolve(next.fn(next.controller.signal))
        .then(() => {
          if (!next.canceled) next.resolve()
        })
        .catch((error) => {
          if (!next.canceled) next.reject(error)
        })
        .finally(() => {
          active = Math.max(0, active - 1)
          remove(next)
          pump()
        })
    }
  }

  return {
    schedule(key: string, fn: AttachTask) {
      const existing = byKey.get(key)
      if (existing) {
        return {
          promise: existing.promise,
          cancel: () => {
            if (existing.canceled) return
            existing.canceled = true
            existing.controller.abort()
            if (!existing.running) {
              remove(existing)
              existing.reject(new Error("attach canceled"))
            }
          },
        }
      }

      let resolve = () => {}
      let reject = (_: unknown) => {}
      const entry: Entry = {
        key,
        fn,
        controller: new AbortController(),
        resolve: () => resolve(),
        reject: (error) => reject(error),
        promise: Promise.resolve(),
        running: false,
        canceled: false,
      }

      entry.promise = new Promise<void>((ok, no) => {
        resolve = ok
        reject = no
      })

      byKey.set(key, entry)
      queue.push(entry)
      pump()

      return {
        promise: entry.promise,
        cancel: () => {
          if (entry.canceled) return
          entry.canceled = true
          entry.controller.abort()
          if (!entry.running) {
            remove(entry)
            entry.reject(new Error("attach canceled"))
          }
        },
      }
    },
    inFlight() {
      return active
    },
    pending() {
      return queue.filter((entry) => !entry.running).length
    },
    clear() {
      const items = [...queue]
      for (const item of items) {
        item.canceled = true
        item.controller.abort()
        if (!item.running) {
          remove(item)
          item.reject(new Error("attach canceled"))
        }
      }
    },
  }
}

export const sharedAttachScheduler = createAttachScheduler({ concurrency: 2 })
