export * as CpuProfile from "./cpu-profile"

import { Global } from "@opencode-ai/util/global"
import { Effect, FileSystem, Queue } from "effect"
import { Session } from "node:inspector"
import path from "node:path"

export const listen = Effect.gen(function* () {
  const global = yield* Global.Service
  if (process.platform === "win32") return
  const signals = yield* Queue.dropping<void>(1)
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const handler = () => Queue.offerUnsafe(signals, undefined)
      process.on("SIGPROF", handler)
      return handler
    }),
    (handler) => Effect.sync(() => process.off("SIGPROF", handler)),
  )
  yield* Effect.gen(function* () {
    yield* Queue.take(signals)
    const file = path.join(
      global.log,
      `cpu-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.cpuprofile`,
    )
    yield* run(file, Effect.sleep("10 seconds")).pipe(
      Effect.catchCause((cause) => Effect.logError("Failed to capture CPU profile", { path: file, cause })),
    )
    yield* Queue.poll(signals)
  }).pipe(Effect.forever, Effect.forkScoped({ startImmediately: true }))
})

function run<A, E, R>(file: string, effect: Effect.Effect<A, E, R>) {
  const target = path.resolve(file)
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      const session = new Session()
      session.connect()
      yield* command(session, "Profiler.enable")
      yield* command(session, "Profiler.start")
      yield* Effect.logInfo("CPU profile started", { path: target })
      return session
    }),
    () => effect,
    (session) =>
      Effect.tryPromise(
        () =>
          new Promise<void>((resolve, reject) => {
            session.post("Profiler.stop", (error, result) => {
              session.disconnect()
              if (error) return reject(error)
              Bun.write(target, JSON.stringify(result.profile)).then(() => resolve(), reject)
            })
          }),
      ).pipe(
        Effect.andThen(Effect.logInfo("CPU profile written", { path: target })),
        Effect.catchCause((cause) => Effect.logError("Failed to write CPU profile", { path: target, cause })),
      ),
  )
}

function command(session: Session, method: "Profiler.enable" | "Profiler.start") {
  return Effect.tryPromise(
    () =>
      new Promise<void>((resolve, reject) => {
        session.post(method, (error) => (error ? reject(error) : resolve()))
      }),
  )
}
