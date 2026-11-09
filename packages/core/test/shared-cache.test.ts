import { describe, expect } from "bun:test"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option, Schema } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { KV } from "@opencode/core/kv"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { SharedCache } from "@opencode/core/shared-cache"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([SharedCache.node, KV.node])))

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

  it.effect("joins a running load, refreshes after the caller's interval, and forces without overlapping", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const loads = { a: 0, b: 0 }
      const gate = yield* Deferred.make<void>()
      const get = (key: "a" | "b", options: { interval?: Duration.Input; force?: boolean } = {}) =>
        cache.get({ key, ...options, load: Deferred.await(gate).pipe(Effect.map(() => `${key}${++loads[key]}`)) })

      const joined = yield* Effect.all([get("a"), get("a", { force: true }), get("b")], {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(joined)).toEqual(["a1", "a1", "b1"])

      yield* TestClock.adjust("5 minutes")
      expect(yield* get("a")).toBe("a1")
      expect(yield* get("a", { interval: "1 minute" })).toBe("a2")
      expect(yield* get("a", { force: true })).toBe("a3")
      yield* TestClock.adjust("10 minutes")
      expect(yield* get("b")).toBe("b2")
      expect(loads).toEqual({ a: 3, b: 2 })
    }),
  )

  it.effect("retries transient failures, then keeps the last list or the failure until the next interval", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const remote = { results: [] as unknown[], loads: 0 }
      const get = (force?: boolean) =>
        cache.get({
          key: "models",
          force,
          load: Effect.suspend(() => {
            remote.loads++
            const result = remote.results.shift()
            return typeof result === "string" ? Effect.succeed(result) : Effect.fail(result)
          }),
        })
      const timeout = new Cause.TimeoutError()

      remote.results = [401]
      expect(yield* Effect.flip(get())).toBe(401)
      yield* TestClock.adjust("9 minutes")
      expect(yield* Effect.flip(get())).toBe(401)
      remote.results = [timeout, timeout, "list"]
      const flaky = yield* get(true).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow.pipe(Effect.andThen(TestClock.adjust("1 second")))
      yield* Effect.yieldNow.pipe(Effect.andThen(TestClock.adjust("2 seconds")))
      expect(yield* Fiber.join(flaky)).toBe("list")
      expect(remote.loads).toBe(4)

      remote.results = [401, timeout, timeout, timeout, timeout]
      expect(yield* get(true)).toBe("list")
      const outage = yield* get(true).pipe(Effect.forkChild({ startImmediately: true }))
      for (const wait of ["1 second", "2 seconds", "4 seconds"] as const)
        yield* Effect.yieldNow.pipe(Effect.andThen(TestClock.adjust(wait)))
      expect(yield* Fiber.join(outage)).toBe("list")
      expect(yield* get()).toBe("list")
      expect(remote.loads).toBe(9)
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

  it.effect("drops entries unread for 24 hours, never one still in use or loading", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const loads = { idle: 0, used: 0, daily: 0, slow: 0 }
      const once = (key: keyof typeof loads) =>
        Effect.suspend(() => (++loads[key] === 1 ? Effect.succeed(key) : Effect.fail("offline")))
      const gate = yield* Deferred.make<void>()

      expect(yield* cache.get({ key: "idle", load: once("idle") })).toBe("idle")
      expect(yield* cache.get({ key: "daily", interval: "48 hours", load: once("daily") })).toBe("daily")
      const getSlow = cache
        .get({ key: "slow", load: Deferred.await(gate).pipe(Effect.andThen(once("slow"))) })
        .pipe(Effect.forkChild({ startImmediately: true }))
      const slow = yield* getSlow
      yield* Effect.yieldNow
      // A Location refreshing every 10 minutes keeps its entry, so its list survives later failures.
      for (let elapsed = 0; elapsed <= 25 * 60; elapsed += 10) {
        expect(yield* cache.get({ key: "used", load: once("used") })).toBe("used")
        yield* TestClock.adjust("10 minutes")
      }

      expect(yield* Effect.flip(cache.get({ key: "idle", load: once("idle") }))).toBe("offline")
      expect(loads.idle).toBe(2)
      yield* TestClock.adjust("23 hours")
      expect(yield* cache.get({ key: "daily", interval: "48 hours", load: once("daily") })).toBe("daily")
      const joined = yield* getSlow
      yield* Deferred.succeed(gate, undefined)
      expect([yield* Fiber.join(slow), yield* Fiber.join(joined)]).toEqual(["slow", "slow"])
      expect(loads.slow).toBe(1)
    }),
  )
})

describe("SharedCache persist", () => {
  const codec = Schema.toCodecJson(Schema.NullOr(Schema.Array(Schema.String)))
  const counted = (results: Array<string[] | null | string>) => {
    const state = { loads: 0 }
    const load = Effect.suspend(() => {
      state.loads++
      const result = results.shift()
      return typeof result === "string" ? Effect.fail(result) : Effect.succeed(result ?? null)
    })
    return { state, load }
  }

  it.effect("starts a cold entry from the saved value, and only an infinite interval returns it without loading", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const kv = yield* KV.Service
      const remote = counted([["a"], "offline", ["b"]])

      expect(yield* cache.get({ key: "plain", load: Effect.succeed(1) })).toBe(1)
      expect((yield* kv.scan({ prefix: "shared-cache:" })).entries).toEqual([])
      expect(yield* cache.get({ key: "list", persist: codec, load: remote.load })).toEqual(["a"])
      expect(yield* kv.get("shared-cache:list")).toEqual({ value: ["a"] })

      // Unread for a day, the entry leaves memory, as it does when another process starts.
      yield* TestClock.adjust("25 hours")
      expect(yield* cache.get({ key: "list", interval: Duration.infinity, persist: codec, load: remote.load })).toEqual(
        ["a"],
      )
      expect(remote.state.loads).toBe(1)

      yield* TestClock.adjust("25 hours")
      expect(yield* cache.lookup({ key: "list", persist: codec, load: remote.load })).toEqual({
        value: Option.some(["a"]),
        failure: Option.some("offline"),
      })
      expect(yield* cache.lookup({ key: "list", persist: codec, load: remote.load })).toEqual({
        value: Option.some(["a"]),
        failure: Option.some("offline"),
      })
      expect(remote.state.loads).toBe(2)

      yield* TestClock.adjust("10 minutes")
      expect(yield* cache.lookup({ key: "list", persist: codec, load: remote.load })).toEqual({
        value: Option.some(["b"]),
        failure: Option.none(),
      })
      expect(yield* kv.get("shared-cache:list")).toEqual({ value: ["b"] })
    }),
  )

  it.effect("saves a value only when it changed, including null", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const kv = yield* KV.Service
      const remote = counted([null, null, ["a"]])
      const get = () => cache.get({ key: "list", force: true, persist: codec, load: remote.load })

      expect(yield* get()).toBeNull()
      expect(yield* kv.get("shared-cache:list")).toEqual({ value: null })
      yield* kv.set("shared-cache:list", "untouched")
      expect(yield* get()).toBeNull()
      expect(yield* kv.get("shared-cache:list")).toBe("untouched")
      expect(yield* get()).toEqual(["a"])
      expect(yield* kv.get("shared-cache:list")).toEqual({ value: ["a"] })
    }),
  )

  it.effect("keeps a failure without a value for its own interval", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const remote = counted(["bad", ["a"]])
      const get = () =>
        cache.get({ key: "skill", interval: Duration.infinity, failureInterval: "1 minute", load: remote.load })

      expect(yield* Effect.flip(get())).toBe("bad")
      yield* TestClock.adjust("30 seconds")
      expect(yield* Effect.flip(get())).toBe("bad")
      expect(remote.state.loads).toBe(1)
      yield* TestClock.adjust("30 seconds")
      expect(yield* get()).toEqual(["a"])
      yield* TestClock.adjust("1 hour")
      expect(yield* get()).toEqual(["a"])
      expect(remote.state.loads).toBe(2)
    }),
  )

  it.effect("forgets the entries under a prefix, in memory and saved", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const kv = yield* KV.Service
      const remote = counted([["a"], ["b"], ["c"], ["d"]])
      const get = (key: string) => cache.get({ key, interval: Duration.infinity, persist: codec, load: remote.load })

      yield* get("console:1:config")
      yield* get("console:1:skills")
      yield* get("console:2:config")
      yield* cache.forget("console:1:")
      expect((yield* kv.scan({ prefix: "shared-cache:" })).entries.map((entry) => entry.key)).toEqual([
        "shared-cache:console:2:config",
      ])
      expect(yield* get("console:2:config")).toEqual(["c"])
      expect(yield* get("console:1:config")).toEqual(["d"])
      expect(remote.state.loads).toBe(4)
    }),
  )
})
