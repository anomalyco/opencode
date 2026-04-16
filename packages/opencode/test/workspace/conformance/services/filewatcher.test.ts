// Substrate-seam smoke for FileWatcher.Service — asserts ws.watch emits
// add/change/unlink events within watchTimeoutMs when files are mutated
// through the primitives.

import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import path from "node:path"
import { conformance, isMarker } from "../_runner"

conformance("services/filewatcher", (register) => {
  register("ws.watch surfaces write events within watchTimeoutMs", async (ctx) => {
    const target = path.posix.join(ctx.backend.rootPath, "filewatcher-probe.txt")
    const eff = Effect.gen(function* () {
      const deferred = yield* Deferred.make<true>()
      const fiber = yield* Effect.forkChild(
        ctx.ws.watch(ctx.backend.rootPath).pipe(
          Stream.runForEach((evt) =>
            Effect.gen(function* () {
              if (evt.path.endsWith("filewatcher-probe.txt")) {
                Deferred.doneUnsafe(deferred, Effect.succeed(true))
              }
              return yield* Effect.void
            }),
          ),
        ),
      )
      // Small settle so the subscription is live before we write.
      yield* Effect.sleep("200 millis")
      yield* ctx.ws.writeFile(target, "hello")
      const got = yield* Deferred.await(deferred).pipe(
        Effect.timeout(`${ctx.watchTimeoutMs} millis`),
        Effect.catch(() => Effect.succeed(false as const)),
      )
      yield* Fiber.interrupt(fiber)
      return got
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out).toBe(true)
  })
})
