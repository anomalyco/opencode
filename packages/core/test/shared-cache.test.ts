import { describe, expect } from "bun:test"
import { Cause, Clock, Deferred, Duration, Effect, Exit, Fiber } from "effect"
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
const timeout = () => new Cause.TimeoutError()

// Lets a forked get reach its retry sleep before the clock moves past it.
const elapse = (duration: Duration.Input) => Effect.yieldNow.pipe(Effect.andThen(TestClock.adjust(duration)))

describe("SharedCache", () => {
  it.effect("counts network errors, timeouts and 408, 429 or 5xx as transient, and nothing else", () =>
    Effect.gen(function* () {
      const reason = (value: HttpClientError.HttpClientError["reason"]) =>
        new HttpClientError.HttpClientError({ reason: value })
      expect(SharedCache.transient(reason(new HttpClientError.TransportError({ request })))).toBe(true)
      expect(SharedCache.transient(timeout())).toBe(true)
      expect(SharedCache.transient(yield* status(503))).toBe(true)
      expect(SharedCache.transient(yield* status(429))).toBe(true)
      expect(SharedCache.transient(yield* status(401))).toBe(false)
      expect(SharedCache.transient(yield* status(404))).toBe(false)
      expect(SharedCache.transient(reason(new HttpClientError.InvalidUrlError({ request })))).toBe(false)
      expect(SharedCache.transient(new TypeError("fetch failed"))).toBe(false)
    }),
  )

  it.effect("joins a running load and keeps values per key until maxAge", () =>
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

  it.effect("retries transient failures, keeps the last good value through them, and drops it on others", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const remote = { failure: undefined as unknown, failures: 0, loads: 0 }
      const get = cache.get({
        key: "models",
        maxAge: "10 minutes",
        load: Effect.suspend(() => {
          remote.loads++
          if (remote.failures === 0) return Effect.succeed(remote.loads)
          remote.failures--
          return Effect.fail(remote.failure)
        }),
      })

      remote.failure = timeout()
      remote.failures = 2
      const flaky = yield* get.pipe(Effect.forkChild({ startImmediately: true }))
      yield* elapse("1 second")
      yield* elapse("2 seconds")
      expect(yield* Fiber.join(flaky)).toBe(3)

      remote.failures = 4
      yield* TestClock.adjust("10 minutes")
      const outage = yield* get.pipe(Effect.forkChild({ startImmediately: true }))
      yield* elapse("1 second")
      yield* elapse("2 seconds")
      yield* elapse("4 seconds")
      expect(yield* Fiber.join(outage)).toBe(3)
      expect(remote.loads).toBe(7)

      remote.failure = "revoked"
      remote.failures = 1
      yield* TestClock.adjust("10 minutes")
      expect(yield* Effect.flip(get)).toBe("revoked")
      expect(yield* Effect.flip(get)).toBe("revoked")
      expect(remote.loads).toBe(8)
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

  it.effect("loads again for callers since an event, sharing one load and never overlapping", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const gate = yield* Deferred.make<void>()
      const remote = { online: false, loads: 0 }
      const get = (since?: number) =>
        cache.get({
          key: "models",
          maxAge: "10 minutes",
          since,
          load: Effect.suspend(() => {
            remote.loads++
            return remote.online ? Deferred.await(gate).pipe(Effect.as(remote.loads)) : Effect.fail("signed out")
          }),
        })

      expect(yield* Effect.flip(get())).toBe("signed out")
      remote.online = true
      expect(yield* Effect.flip(get())).toBe("signed out")

      yield* TestClock.adjust("1 second")
      const switched = yield* Clock.currentTimeMillis
      const locations = yield* Effect.all([get(switched), get(switched)], { concurrency: "unbounded" }).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Effect.yieldNow
      const later = yield* get(switched).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(locations)).toEqual([2, 2])
      expect(yield* Fiber.join(later)).toBe(2)
      expect(yield* get(switched)).toBe(2)
      expect(remote.loads).toBe(2)
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
