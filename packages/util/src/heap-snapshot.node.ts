import { Effect, Semaphore } from "effect"
import { open } from "node:fs/promises"
import path from "node:path"

export const supported = true

const lock = Semaphore.makeUnsafe(1)

export const write = Effect.fn("HeapSnapshot.write")(
  function* (directory: string) {
    const { writeHeapSnapshot } = yield* Effect.tryPromise(() => import("node:v8"))
    const file = path.join(
      directory,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    // Pre-create privately; the runtime preserves these permissions when it writes the snapshot.
    yield* Effect.tryPromise(async () => {
      const handle = await open(file, "wx", 0o600)
      await handle.close()
    })
    yield* Effect.logInfo("writing heap snapshot", { path: file })
    yield* Effect.try(() => writeHeapSnapshot(file))
    yield* Effect.logInfo("heap snapshot written", { path: file })
    return { path: file, pid: process.pid }
  },
  (effect) => lock.withPermit(effect),
)
