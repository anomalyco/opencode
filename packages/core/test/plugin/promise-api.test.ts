import { expect } from "bun:test"
import { Plugin } from "@opencode/plugin"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import { Deferred, Effect } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

it.live("Promise API calls interrupt the host when their signal aborts", () =>
  Effect.gen(function* () {
    const context = yield* Deferred.make<Plugin.Context>()
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let interrupted = false
    yield* fromPromise({
      id: "cancel-api",
      setup(ctx) {
        Effect.runSync(Deferred.succeed(context, ctx))
      },
    }).effect(
      host({
        generate: {
          text: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              return { text: "finished" }
            }).pipe(Effect.onInterrupt(() => Effect.sync(() => (interrupted = true)))),
        },
      }),
    )
    const ctx = yield* Deferred.await(context)
    const controller = new AbortController()
    const pending = ctx.generate.text({ prompt: "Wait" }, { signal: controller.signal }).then(
      () => "resolved",
      () => "rejected",
    )
    yield* Deferred.await(started)
    controller.abort()
    yield* Deferred.succeed(release, undefined)

    expect(yield* Effect.promise(() => pending)).toBe("rejected")
    expect(interrupted).toBe(true)
  }),
)

it.live("Promise API calls with an already aborted signal do not invoke the host", () =>
  Effect.gen(function* () {
    const context = yield* Deferred.make<Plugin.Context>()
    let calls = 0
    yield* fromPromise({
      id: "cancelled-api",
      setup(ctx) {
        Effect.runSync(Deferred.succeed(context, ctx))
      },
    }).effect(
      host({
        generate: {
          text: () =>
            Effect.sync(() => {
              calls++
              return { text: "finished" }
            }),
        },
      }),
    )
    const ctx = yield* Deferred.await(context)
    const result = yield* Effect.promise(() =>
      ctx.generate.text({ prompt: "Do not start" }, { signal: AbortSignal.abort() }).then(
        () => "resolved",
        () => "rejected",
      ),
    )

    expect(result).toBe("rejected")
    expect(calls).toBe(0)
    expect(yield* Effect.promise(() => ctx.generate.text({ prompt: "Run normally" }))).toEqual({ text: "finished" })
    expect(calls).toBe(1)
  }),
)
