import { writeFileSync } from "node:fs"

const RETRY_DELAYS_MS = [50, 200]

type Store = {
  set: (key: string, value: unknown) => void
  delete: (key: string) => void
  clear: () => void
}

type StoreFile = Store & {
  readonly store: Record<string, unknown>
}

const queues = new Map<string, Promise<unknown>>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Windows fails rename() with these while another handle has the target open
// without FILE_SHARE_DELETE (indexers, AV, backups). Those writes are worth retrying.
function transient(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = "code" in error ? error.code : undefined
  return code === "EPERM" || code === "EBUSY" || code === "EACCES" || code === "ENOENT"
}

// Serializes every mutation of one store file so concurrent IPC calls (and the
// fire-and-forget cleanup after delete/clear) never overlap a rename.
export function enqueueStore(name: string, operation: () => Promise<unknown>) {
  const previous = queues.get(name) ?? Promise.resolve()
  const next = previous.then(operation)
  const settled = next.then(
    () => undefined,
    () => undefined,
  )
  queues.set(name, settled)
  void settled.then(() => {
    if (queues.get(name) === settled) queues.delete(name)
  })
  return next
}

export function mutateStore(target: { name: string; file: string; store: StoreFile }, change: (store: Store) => void) {
  return enqueueStore(target.name, async () => {
    let failure: unknown
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 0)
      try {
        change(target.store)
        return
      } catch (error) {
        if (!transient(error)) throw error
        failure = error
        if (attempt >= RETRY_DELAYS_MS.length) break
      }
    }
    writeInPlace(target.file, target.store, change, failure)
  })
}

// Last resort after the atomic rename kept failing: write the same data in place.
// Not atomic, but losing a small JSON file to a crash mid-write is better than
// dropping the user's change and keeping the stale file.
function writeInPlace(file: string, store: StoreFile, change: (store: Store) => void, failure: unknown) {
  const data = (() => {
    try {
      return { ...store.store }
    } catch {
      return {}
    }
  })()

  change({
    set: (key, value) => {
      data[key] = value
    },
    delete: (key) => {
      delete data[key]
    },
    clear: () => {
      for (const key of Object.keys(data)) delete data[key]
    },
  })

  try {
    writeFileSync(file, JSON.stringify(data, null, "\t"))
  } catch (error) {
    console.error(`store write failed for ${file}`, failure, error)
  }
}
