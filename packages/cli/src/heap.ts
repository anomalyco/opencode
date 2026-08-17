import { Global } from "@opencode-ai/util/global"
import { Effect, Queue } from "effect"
import path from "node:path"

export const listen = Effect.gen(function* () {
  const global = yield* Global.Service
  if (process.platform === "win32") return
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
      Effect.suspend(() => {
        const file = path.join(
          global.log,
          `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
        )
        return Effect.gen(function* () {
          yield* Effect.logInfo("writing heap snapshot", { path: file })
          const { writeHeapSnapshot } = yield* Effect.tryPromise(() => import("node:v8"))
          yield* Effect.try(() => writeHeapSnapshot(file))
          yield* Effect.logInfo("heap snapshot written", { path: file })
        }).pipe(Effect.catchCause((cause) => Effect.logError("failed to write heap snapshot", { path: file, cause })))
      }),
    ),
    Effect.forever,
    Effect.forkScoped({ startImmediately: true }),
  )
})

export * as Heap from "./heap"
