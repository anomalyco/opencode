import { expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import { it } from "../lib/effect"
import { host } from "./host"

for (const experimental of [false, true]) {
  for (const aborted of [false, true]) {
    it.live(
      `${experimental ? "experimental.generate" : "generate"} honors ${aborted ? "already aborted" : "in-flight"} request signals`,
      () =>
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const outcome = yield* Deferred.make<"fulfilled" | "rejected">()
          const controller = new AbortController()
          let calls = 0
          let interrupted = false
          const text = () =>
            Effect.gen(function* () {
              calls++
              yield* Deferred.succeed(started, undefined)
              if (!aborted) yield* Deferred.await(release)
              return { text: "finished" }
            }).pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true
                }),
              ),
            )
          if (aborted) controller.abort()
          const context = host()
          yield* fromPromise({
            id: "cancel-api",
            setup(ctx) {
              const generate = experimental ? ctx.experimental.generate : ctx.generate
              void generate.text({ prompt: "wait" }, { signal: controller.signal }).then(
                () => Effect.runSync(Deferred.succeed(outcome, "fulfilled")),
                () => Effect.runSync(Deferred.succeed(outcome, "rejected")),
              )
            },
          }).effect(
            host({
              generate: { text },
              experimental: { ...context.experimental, generate: { ...context.experimental.generate, text } },
            }),
          )

          if (!aborted) {
            yield* Deferred.await(started)
            controller.abort()
            yield* Deferred.succeed(release, undefined)
          }
          expect(yield* Deferred.await(outcome)).toBe("rejected")
          expect(calls).toBe(aborted ? 0 : 1)
          if (!aborted) expect(interrupted).toBe(true)
        }),
    )
  }
}
