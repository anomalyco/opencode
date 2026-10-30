import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SharedCache } from "@opencode/core/shared-cache"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(SharedCache.node))

describe("SharedCache", () => {
  it.effect("joins a running load and keeps values per key until they are older than maxAge", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const loads = { a: 0, b: 0 }
      const gate = yield* Deferred.make<void>()
      const get = (key: "a" | "b", maxAge: Duration.Input = "10 minutes") =>
        cache.get({ key, maxAge, load: Deferred.await(gate).pipe(Effect.map(() => `${key}${++loads[key]}`)) })

      const joined = yield* Effect.all([get("a"), get("a"), get("b")], { concurrency: "unbounded" }).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(joined)).toEqual(["a1", "a1", "b1"])

      yield* TestClock.adjust("5 minutes")
      expect(yield* get("a")).toBe("a1")
      expect(yield* get("a", "1 minute")).toBe("a2")

      yield* TestClock.adjust("10 minutes")
      expect(yield* get("b")).toBe("b2")
      expect(loads).toEqual({ a: 2, b: 2 })
    }),
  )

  it.effect("returns the last good value when a load fails and waits maxAge before loading again", () =>
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
      expect(yield* get).toBe(2)

      remote.online = false
      yield* TestClock.adjust("1 minute")
      expect(yield* get).toBe(2)
      expect(remote.loads).toBe(3)

      yield* TestClock.adjust("59 seconds")
      expect(yield* get).toBe(2)
      expect(remote.loads).toBe(3)

      yield* TestClock.adjust("1 second")
      expect(yield* get).toBe(2)
      expect(remote.loads).toBe(4)
    }),
  )
})
