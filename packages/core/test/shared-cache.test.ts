import { describe, expect } from "bun:test"
import { Cause, Deferred, Duration, Effect, Exit, Fiber } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SharedCache } from "@opencode/core/shared-cache"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(SharedCache.node))

const request = HttpClientRequest.get("https://models.example/v1")
const status = (code: number) =>
  HttpClient.filterStatusOk(
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: code }))),
    ),
  )
    .execute(request)
    .pipe(Effect.flip)

describe("SharedCache", () => {
  it.effect("counts network errors, timeouts and 408, 429 or 5xx as transient, and nothing else", () =>
    Effect.gen(function* () {
      const reason = (value: HttpClientError.HttpClientError["reason"]) =>
        new HttpClientError.HttpClientError({ reason: value })
      expect(SharedCache.transient(reason(new HttpClientError.TransportError({ request })))).toBe(true)
      expect(SharedCache.transient(new Cause.TimeoutError())).toBe(true)
      expect(SharedCache.transient(yield* status(503))).toBe(true)
      expect(SharedCache.transient(yield* status(429))).toBe(true)
      expect(SharedCache.transient(yield* status(401))).toBe(false)
      expect(SharedCache.transient(yield* status(404))).toBe(false)
      expect(SharedCache.transient(reason(new HttpClientError.InvalidUrlError({ request })))).toBe(false)
      expect(SharedCache.transient(new TypeError("fetch failed"))).toBe(false)
    }),
  )

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

  it.effect("keeps a failure for 30 seconds, and the last good value through any later failure", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const remote = { results: [] as Array<number | unknown>, loads: 0 }
      const get = cache.get({
        key: "models",
        maxAge: "10 minutes",
        load: Effect.suspend(() => {
          remote.loads++
          const result = remote.results.shift()
          return typeof result === "number" ? Effect.succeed(result) : Effect.fail(result)
        }),
      })

      remote.results = ["signed out", 1]
      expect(yield* Effect.flip(get)).toBe("signed out")
      yield* TestClock.adjust("29 seconds")
      expect(yield* Effect.flip(get)).toBe("signed out")
      yield* TestClock.adjust("1 second")
      expect(yield* get).toBe(1)

      remote.results = ["revoked"]
      yield* TestClock.adjust("10 minutes")
      expect(yield* get).toBe(1)
      yield* TestClock.adjust("9 minutes")
      expect(yield* get).toBe(1)
      expect(remote.loads).toBe(3)
    }),
  )

  it.effect("never keeps interrupts or defects, and an interrupted caller leaves the load to the others", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const gate = yield* Deferred.make<void>()
      const loads = { count: 0 }
      const get = (load: Effect.Effect<number>) =>
        cache.get({
          key: "models",
          maxAge: "10 minutes",
          load: Effect.suspend(() => {
            loads.count++
            return load
          }),
        })

      const first = yield* get(Deferred.await(gate).pipe(Effect.as(1))).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      const second = yield* get(Effect.succeed(2)).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(first)
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(second)).toBe(1)

      yield* TestClock.adjust("10 minutes")
      expect(Exit.hasDies(yield* Effect.exit(get(Effect.die("bug"))))).toBe(true)
      expect(Exit.hasInterrupts(yield* Effect.exit(get(Effect.interrupt)))).toBe(true)
      expect(yield* get(Effect.succeed(3))).toBe(3)
      expect(loads.count).toBe(4)
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
