import { Global } from "@opencode/util/global"
import { HeapSnapshot } from "@opencode/util/heap-snapshot"
import { Effect, Queue } from "effect"

export const listen = Effect.gen(function* () {
  const global = yield* Global.Service
  // FreeBSD's JavaScriptCore uses SIGUSR1 to suspend and resume its threads.
  if (process.platform === "win32" || process.platform === "freebsd") return
  const signals = yield* Queue.dropping<void>(1)
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const handler = () => Queue.offerUnsafe(signals, undefined)
      process.on("SIGUSR1", handler)
      return handler
    }),
    (handler) => Effect.sync(() => process.off("SIGUSR1", handler)),
  )
  yield* Queue.take(signals).pipe(
    Effect.andThen(
      HeapSnapshot.write(global.log).pipe(
        Effect.catchCause((cause) => Effect.logError("failed to write heap snapshot", { cause })),
      ),
    ),
    Effect.forever,
    Effect.forkScoped({ startImmediately: true }),
  )
})

export * as Heap from "./heap"
