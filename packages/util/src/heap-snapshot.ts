import { Clock, Effect, Semaphore } from "effect"
import { mkdir, open, rm, stat } from "node:fs/promises"
import path from "node:path"

// One process-wide permit: the signal listener and the HTTP endpoint share it, so concurrent
// requests queue instead of serializing two heaps at once.
const lock = Semaphore.makeUnsafe(1)

/**
 * Writes a V8 heap snapshot of this process into `directory` and returns once the file is complete, with the
 * process's memory just before the snapshot: the snapshot holds only the garbage-collected heap, and writing it
 * raises the process's memory. Blocks the event loop while the heap serializes. The file can contain secrets, so it
 * is created owner-only before the runtime writes into it. Fails, removing the file, when the runtime writes nothing.
 */
export const write = Effect.fn("HeapSnapshot.write")(
  function* (directory: string) {
    const v8 = yield* Effect.tryPromise(() => import("node:v8"))
    const time = new Date(yield* Clock.currentTimeMillis).toISOString().replace(/[:.]/g, "")
    const file = path.join(directory, `heap-${process.pid}-${time}.heapsnapshot`)
    yield* Effect.tryPromise(async () => {
      await mkdir(directory, { recursive: true })
      const handle = await open(file, "wx", 0o600)
      await handle.close()
    })
    const memory = yield* Effect.sync(() => process.memoryUsage())
    yield* Effect.logInfo("writing heap snapshot", { path: file, rss: memory.rss, heapUsed: memory.heapUsed })
    yield* Effect.try(() => v8.writeHeapSnapshot(file))
    // Bun writes an empty file instead of throwing when the V8-format output would exceed about 2 GiB.
    const bytes = yield* Effect.tryPromise(async () => {
      const size = (await stat(file)).size
      if (size > 0) return size
      await rm(file, { force: true })
      throw new Error(
        `Bun cannot write a V8 heap snapshot over about 2 GiB, and this heap is too large (${Math.round(memory.heapUsed / 1024 ** 2)} MiB used)`,
      )
    })
    yield* Effect.logInfo("heap snapshot written", { path: file, bytes })
    return {
      path: file,
      pid: process.pid,
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
    }
  },
  (effect) => lock.withPermit(effect),
)

export * as HeapSnapshot from "./heap-snapshot.js"
