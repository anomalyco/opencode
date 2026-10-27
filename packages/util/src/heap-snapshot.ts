import { Clock, Effect, Schema, Semaphore } from "effect"
import { mkdir, open, rm, stat } from "node:fs/promises"
import path from "node:path"

export class EmptySnapshotError extends Schema.TaggedError<EmptySnapshotError>()("HeapSnapshot.EmptySnapshotError", {
  pauseMs: Schema.Number,
}) {
  override get message() {
    return `The runtime wrote an empty heap snapshot after pausing ${this.pauseMs} ms; the heap is likely too large`
  }
}

// One process-wide permit: the signal listener and the HTTP endpoint share it, so concurrent
// requests queue instead of serializing two heaps at once.
const lock = Semaphore.makeUnsafe(1)

/**
 * Writes a V8 heap snapshot of this process into `directory` and returns once the file is complete, with the
 * process's memory just before the snapshot: the snapshot holds only the garbage-collected heap, and writing it
 * raises the process's memory. Blocks the event loop while the heap serializes. The file can contain secrets, so it
 * is created owner-only before the runtime writes into it.
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
    const { size, pauseMs } = yield* Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis
      yield* Effect.try(() => v8.writeHeapSnapshot(file))
      const pauseMs = (yield* Clock.currentTimeMillis) - started
      // Bun writes an empty file instead of throwing when the snapshot is too large to serialize (about 2 GB of output).
      const { size } = yield* Effect.tryPromise(() => stat(file))
      if (size === 0) return yield* new EmptySnapshotError({ pauseMs })
      return { size, pauseMs }
    }).pipe(Effect.onError(() => Effect.tryPromise(() => rm(file, { force: true })).pipe(Effect.ignore)))
    yield* Effect.logInfo("heap snapshot written", { path: file, bytes: size, pauseMs })
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
