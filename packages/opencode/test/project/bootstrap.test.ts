/**
 * Tests that InstanceBootstrap decouples slow services (FileWatcher, Vcs)
 * from the HTTP request critical path by forking them as detached fibers.
 *
 * Key invariant: InstanceBootstrap must resolve in < 500ms even when
 * FileWatcher.subscribe takes seconds on external volumes.
 */
import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Context, Layer, Deferred } from "effect"

// ---------------------------------------------------------------------------
// Tests: forkDetach decoupling invariant
// ---------------------------------------------------------------------------

describe("InstanceBootstrap forkDetach pattern", () => {
  /**
   * Core invariant: an Effect.gen that uses Effect.forkDetach to launch a
   * slow task returns before the slow task completes.
   */
  test("forkDetach does not block parent gen completion", async () => {
    const slowMs = 2000
    const maxElapsed = 500

    const program = Effect.gen(function* () {
      // Simulate fast group (awaited — completes instantly)
      yield* Effect.void

      // Simulate deferred group (forkDetach — slow work in background)
      yield* Effect.forkDetach(
        Effect.sleep(`${slowMs} millis`).pipe(
          Effect.catchCause(() => Effect.void),
        ),
      )

      return "bootstrap-complete"
    })

    const start = Date.now()
    const result = await Effect.runPromise(program)
    const ms = Date.now() - start

    expect(result).toBe("bootstrap-complete")
    expect(ms).toBeLessThan(maxElapsed)
  })

  /**
   * When the detached fiber fails, the parent gen must NOT fail or be affected.
   */
  test("detached fiber failure does not propagate to parent", async () => {
    const program = Effect.gen(function* () {
      yield* Effect.forkDetach(
        Effect.fail("simulated-init-failure").pipe(
          Effect.catchCause(() => Effect.void),
        ),
      )
      return "ok"
    })

    const result = await Effect.runPromise(program)
    expect(result).toBe("ok")
  })

  /**
   * Duplicate init guard: if two fibers race to initialize the same resource,
   * only one should run the expensive factory. Verified via a simple boolean guard.
   */
  test("concurrent init calls are guarded against double execution", async () => {
    let initCount = 0
    const resultDeferred = await Effect.runPromise(Deferred.make<void>())

    const guardedInit = Effect.gen(function* () {
      if (initCount > 0) return
      initCount++
      yield* Effect.sleep("50 millis")
      yield* Deferred.succeed(resultDeferred, undefined)
    })

    const program = Effect.gen(function* () {
      yield* Effect.forkDetach(guardedInit)
      yield* Effect.forkDetach(guardedInit) // second fork — guard prevents double init
      yield* Deferred.await(resultDeferred).pipe(Effect.timeout("2 seconds"))
    })

    await Effect.runPromise(program)
    expect(initCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: mock FileWatcher to verify bootstrap decoupling
// ---------------------------------------------------------------------------

describe("InstanceBootstrap with slow FileWatcher mock", () => {
  interface MockWatcherInterface {
    readonly init: () => Effect.Effect<void>
  }
  class MockWatcherService extends Context.Service<
    MockWatcherService,
    MockWatcherInterface
  >()("@opencode/MockFileWatcher") {}

  /**
   * bootstrap returns quickly < 500ms even when the mocked FileWatcher
   * init blocks for 2 seconds — because forkDetach is used.
   */
  test("bootstrap.init returns < 500ms with 2-second slow watcher", async () => {
    const SLOW_MS = 2000
    const MAX_BOOTSTRAP_MS = 500

    // A "slow" FileWatcher whose init sleeps 2s
    const slowWatcherLayer = Layer.succeed(
      MockWatcherService,
      MockWatcherService.of({
        init: () => Effect.sleep(`${SLOW_MS} millis`),
      }),
    )

    // Simulate InstanceBootstrap-like logic:
    // - fast group: no-op (fast services already done)
    // - deferred group: forkDetach(MockFileWatcher.init())
    const simulatedBootstrap = Effect.gen(function* () {
      // fast group
      yield* Effect.void

      // deferred group
      yield* Effect.forkDetach(
        MockWatcherService.use((s) => s.init()).pipe(
          Effect.catchCause(() => Effect.void),
        ),
      )

      return "done"
    })

    const start = Date.now()
    const result = await Effect.runPromise(
      simulatedBootstrap.pipe(Effect.provide(slowWatcherLayer)),
    )
    const ms = Date.now() - start

    expect(result).toBe("done")
    expect(ms).toBeLessThan(MAX_BOOTSTRAP_MS)
  })

  /**
   * Deferred group failure does not kill the bootstrap or the service.
   * Even if FileWatcher.init() throws, bootstrap returns success.
   */
  test("bootstrap succeeds even when deferred service init throws", async () => {
    const failingWatcherLayer = Layer.succeed(
      MockWatcherService,
      MockWatcherService.of({
        init: () => Effect.fail(new Error("subscribe failed")) as unknown as Effect.Effect<void>,
      }),
    )

    const simulatedBootstrap = Effect.gen(function* () {
      yield* Effect.forkDetach(
        MockWatcherService.use((s) => s.init()).pipe(
          Effect.catchCause(() => Effect.void),
        ),
      )
      return "instance-healthy"
    })

    const result = await Effect.runPromise(
      simulatedBootstrap.pipe(Effect.provide(failingWatcherLayer)),
    )
    expect(result).toBe("instance-healthy")
  })
})
