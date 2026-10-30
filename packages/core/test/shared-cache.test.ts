import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SharedCache } from "@opencode/core/shared-cache"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(SharedCache.node))

describe("SharedCache", () => {
  it.effect("joins a running load, keeps values per key until maxAge, and forces without overlapping", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const loads = { a: 0, b: 0 }
      const gate = yield* Deferred.make<void>()
      const get = (key: "a" | "b", options: { maxAge?: Duration.Input; force?: boolean } = {}) =>
        cache.get({
          key,
          maxAge: options.maxAge ?? "10 minutes",
          force: options.force,
          load: Deferred.await(gate).pipe(Effect.map(() => `${key}${++loads[key]}`)),
        })

      const joined = yield* Effect.all([get("a"), get("a", { force: true }), get("b")], {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(joined)).toEqual(["a1", "a1", "b1"])

      yield* TestClock.adjust("5 minutes")
      expect(yield* get("a")).toBe("a1")
      expect(yield* get("a", { maxAge: "1 minute" })).toBe("a2")
      expect(yield* get("a", { force: true })).toBe("a3")

      yield* TestClock.adjust("10 minutes")
      expect(yield* get("b")).toBe("b2")
      expect(loads).toEqual({ a: 3, b: 2 })
    }),
  )

  it.effect("tries a failing key at most once per maxAge, with or without a last good value", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const remote = { online: false, loads: 0 }
      const get = cache.get({
        key: "models",
        maxAge: "1 minute",
        load: Effect.suspend(() => {
          remote.loads++
          return remote.online ? Effect.succeed(remote.loads) : Effect.fail("offline")
        }),
      })

      expect(yield* Effect.flip(get)).toBe("offline")
      remote.online = true
      expect(yield* Effect.flip(get)).toBe("offline")
      expect(remote.loads).toBe(1)

      yield* TestClock.adjust("1 minute")
      expect(yield* get).toBe(2)

      remote.online = false
      yield* TestClock.adjust("1 minute")
      expect(yield* get).toBe(2)
      yield* TestClock.adjust("59 seconds")
      expect(yield* get).toBe(2)
      expect(remote.loads).toBe(3)

      yield* TestClock.adjust("1 second")
      expect(yield* get).toBe(2)
      expect(remote.loads).toBe(4)
    }),
  )

  it.effect("evicts unread entries but never one with a load in flight", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const loads = { slow: 0, idle: 0 }
      const gate = yield* Deferred.make<void>()
      const load = (key: "slow" | "idle") => Effect.sync(() => ++loads[key])
      const forever = { key: "idle", maxAge: Duration.infinity, load: load("idle") } as const

      expect(yield* cache.get(forever)).toBe(1)
      const slow = yield* cache
        .get({ key: "slow", maxAge: "1 minute", load: Deferred.await(gate).pipe(Effect.andThen(load("slow"))) })
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      yield* TestClock.adjust("2 hours")

      expect(yield* cache.get(forever)).toBe(2)
      const joined = yield* cache
        .get({ key: "slow", maxAge: "1 minute", load: load("slow") })
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(gate, undefined)
      expect([yield* Fiber.join(slow), yield* Fiber.join(joined)]).toEqual([1, 1])
      expect(loads).toEqual({ slow: 1, idle: 2 })
    }),
  )
})
