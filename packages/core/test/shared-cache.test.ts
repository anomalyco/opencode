import { describe, expect } from "bun:test"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option, Schema, Scope, Stream } from "effect"
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

// A load that answers each refresh with the next result.
const remote = <A>(results: Array<Exit.Exit<A, unknown>>) => {
  const state = { loads: 0 }
  const load = Effect.suspend(() => {
    state.loads++
    return results.shift() ?? Effect.die("no more results")
  })
  return { state, load }
}
const ok = Exit.succeed
const failed = Exit.fail

// Moves the clock and lets the woken refresh run.
const after = (duration: Duration.Input) =>
  TestClock.adjust(duration).pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(Effect.yieldNow))

const hold = <A, E>(input: SharedCache.Input<A, E>) =>
  Effect.gen(function* () {
    const cache = yield* SharedCache.Service
    const scope = yield* Scope.make()
    const source = yield* cache.source(input).pipe(Scope.provide(scope))
    return { source, release: Scope.close(scope, Exit.void) }
  })

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

  it.effect("shares one timer between every holder of a key", () =>
    Effect.gen(function* () {
      const list = remote([ok(["a"]), ok(["b"]), ok(["c"])])
      const first = yield* hold({ key: "models", load: list.load })
      const second = yield* hold<string[], unknown>({
        key: "models",
        interval: "1 minute",
        load: Effect.die("never runs"),
      })
      expect(yield* first.source.get).toEqual(["a"])
      expect(yield* second.source.get).toEqual(["a"])
      expect(list.state.loads).toBe(1)

      // The first holder's interval wins.
      yield* after("1 minute")
      expect(list.state.loads).toBe(1)
      yield* after("9 minutes")
      expect(list.state.loads).toBe(2)
      expect(yield* second.source.get).toEqual(["b"])
    }),
  )

  it.effect("waits only for the first load, and then reads the value without loading", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const state = { loads: 0 }
      const { source } = yield* hold({
        key: "models",
        load: Deferred.await(gate).pipe(Effect.map(() => ++state.loads)),
      })
      const first = yield* source.get.pipe(Effect.forkChild({ startImmediately: true }))
      expect(yield* source.current).toEqual({ value: Option.none(), failure: Option.none() })
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(first)).toBe(1)

      // A stale value is still read at once, and reading never starts a load.
      yield* TestClock.adjust("9 minutes")
      expect(yield* Effect.all([source.get, source.get, source.get])).toEqual([1, 1, 1])
      expect(state.loads).toBe(1)
    }),
  )

  it.effect("keeps the last value through failures, retries transient ones, and reports the failure", () =>
    Effect.gen(function* () {
      const timeout = new Cause.TimeoutError()
      const list = remote([ok(["a"]), failed("unauthorized"), failed(timeout), failed(timeout), ok(["b"])])
      const { source } = yield* hold({ key: "models", load: list.load })
      expect(yield* source.get).toEqual(["a"])

      yield* after("10 minutes")
      expect(yield* source.current).toEqual({ value: Option.some(["a"]), failure: Option.some("unauthorized") })
      expect(yield* source.get).toEqual(["a"])

      yield* after("10 minutes")
      yield* after("1 second")
      yield* after("2 seconds")
      expect(yield* source.current).toEqual({ value: Option.some(["b"]), failure: Option.none() })
      expect(list.state.loads).toBe(5)
    }),
  )

  it.effect("fails a read only without any value, and tries again within a minute", () =>
    Effect.gen(function* () {
      const skill = remote([failed("bad"), ok("ready")])
      const { source } = yield* hold({ key: "skill", interval: Duration.infinity, load: skill.load })
      expect(yield* Effect.flip(source.get)).toBe("bad")
      yield* after("30 seconds")
      expect(skill.state.loads).toBe(1)
      yield* after("30 seconds")
      expect(yield* source.get).toBe("ready")

      // An infinite interval loads a value once.
      yield* after("1 day")
      expect(skill.state.loads).toBe(2)
    }),
  )

  it.effect("never keeps an interrupt and keeps a defect as the failure", () =>
    Effect.gen(function* () {
      const { source } = yield* hold({ key: "models", load: Effect.die("bug") })
      expect(Exit.hasDies(yield* Effect.exit(source.get))).toBe(true)
      expect(yield* source.current).toEqual({ value: Option.none(), failure: Option.none() })
    }),
  )

  it.effect("tells holders when the value or the failure changes, and nothing else", () =>
    Effect.gen(function* () {
      const list = remote([ok(["a"]), ok(["a"]), failed("down"), failed("down"), ok(["b"])])
      const { source } = yield* hold({ key: "models", load: list.load })
      yield* source.get
      const seen = yield* source.changes.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      )
      for (let refresh = 0; refresh < 4; refresh++) yield* after("10 minutes")
      expect(list.state.loads).toBe(5)
      expect(yield* Fiber.join(seen)).toEqual([
        { value: Option.some(["a"]), failure: Option.none() },
        { value: Option.some(["a"]), failure: Option.some("down") },
        { value: Option.some(["b"]), failure: Option.none() },
      ])
    }),
  )

  it.effect("stops refreshing and drops the value once the last holder releases it", () =>
    Effect.gen(function* () {
      const list = remote([ok(["a"]), ok(["b"]), ok(["c"])])
      const first = yield* hold({ key: "models", load: list.load })
      const second = yield* hold({ key: "models", load: list.load })
      yield* first.source.get
      yield* first.release
      yield* after("10 minutes")
      expect(list.state.loads).toBe(2)

      yield* second.release
      yield* after("1 hour")
      expect(list.state.loads).toBe(2)

      // The next holder starts again from nothing.
      const next = yield* hold({ key: "models", load: list.load })
      expect(yield* next.source.get).toEqual(["c"])
    }),
  )
})

describe("SharedCache persist", () => {
  const codec = Schema.toCodecJson(Schema.NullOr(Schema.Array(Schema.String)))

  it.effect("restores the saved value at once and saves a value only when it changed, including null", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      const gate = yield* Deferred.make<void>()
      const list = remote<readonly string[] | null>([ok(null), ok(null), ok(["a"])])
      const first = yield* hold({ key: "list", persist: codec, load: list.load })
      expect(yield* first.source.get).toBeNull()
      expect(yield* kv.get("shared-cache:list")).toEqual({ value: null })

      yield* kv.set("shared-cache:list", "untouched")
      yield* after("10 minutes")
      expect(yield* kv.get("shared-cache:list")).toBe("untouched")
      yield* after("10 minutes")
      expect(yield* kv.get("shared-cache:list")).toEqual({ value: ["a"] })
      yield* first.release

      // A later holder, as in another process, reads the saved value while its first load waits.
      const next = yield* hold({
        key: "list",
        persist: codec,
        load: Deferred.await(gate).pipe(Effect.as(["b"])),
      })
      expect(yield* next.source.get).toEqual(["a"])
      yield* Deferred.succeed(gate, undefined)
      yield* Effect.yieldNow
      expect(yield* next.source.get).toEqual(["b"])
      expect(yield* kv.get("shared-cache:list")).toEqual({ value: ["b"] })
    }),
  )

  it.effect("forgets the saved values under a prefix and stops their refreshes", () =>
    Effect.gen(function* () {
      const cache = yield* SharedCache.Service
      const kv = yield* KV.Service
      const list = remote<readonly string[] | null>([ok(["a"]), ok(["b"]), ok(["c"]), ok(["d"])])
      const one = yield* hold({ key: "console:1:config", persist: codec, load: list.load })
      yield* one.source.get
      const two = yield* hold({ key: "console:2:config", persist: codec, load: list.load })
      yield* two.source.get
      yield* cache.forget("console:1:")
      expect((yield* kv.scan({ prefix: "shared-cache:" })).entries.map((entry) => entry.key)).toEqual([
        "shared-cache:console:2:config",
      ])

      yield* after("10 minutes")
      expect(list.state.loads).toBe(3)
      const again = yield* hold({ key: "console:1:config", persist: codec, load: list.load })
      expect(yield* again.source.get).toEqual(["d"])
    }),
  )
})
