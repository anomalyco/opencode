import { describe, expect, test } from "bun:test"
import { Cause, Clock, Deferred, Duration, Effect, Exit, Layer, Queue, Scope } from "effect"
import * as TestClock from "effect/testing/TestClock"
import * as TestConsole from "effect/testing/TestConsole"
import { CronService, layer as cronLayer } from "@opencode-ai/core/cron/service"
import { CronDeliveryPort } from "@opencode-ai/core/cron/port"

const testEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

const run = <A, E, R, E2>(value: Body<A, E, R | Scope.Scope>, layer: Layer.Layer<R, E2>) =>
  Effect.gen(function* () {
    const effect = typeof value === "function" ? value() : value
    const exit = yield* Effect.scoped(effect).pipe(Effect.provide(layer), Effect.exit)
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)

const makeTest = <R, E>(baseLayer: Layer.Layer<R, E>) => {
  const fullLayer = Layer.provideMerge(baseLayer, testEnv)
  return <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>) => test(name, () => run(value, fullLayer))
}

describe("CronService", () => {
  const fakePort = Layer.succeed(
    CronDeliveryPort,
    CronDeliveryPort.of({
      exists: () => Effect.succeed(true),
      deliver: () => Effect.void,
    }),
  )

  const baseLayer = Layer.provideMerge(cronLayer, fakePort)
  const it = makeTest(baseLayer)

  const pump = Effect.gen(function* () {
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* Effect.yieldNow
  })

  it("add - list returns the job", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const job = yield* cron.add({ sessionID: "s1", prompt: "test", intervalMs: 120_000 })
      const jobs = yield* cron.list("s1")
      expect(jobs.length).toBe(1)
      expect(jobs[0].id).toBe(job.id)
      expect(jobs[0].sessionID).toBe("s1")
      expect(jobs[0].intervalMs).toBe(120_000)
    }))

  it("add rejects interval < 60s", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const result = yield* cron.add({ sessionID: "s1", prompt: "test", intervalMs: 30_000 }).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }))

  it("enforces 50-job cap per session", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      for (let i = 0; i < 50; i++) {
        yield* cron.add({ sessionID: "s2", prompt: `p${i}`, intervalMs: 120_000 })
      }
      const result = yield* cron.add({ sessionID: "s2", prompt: "overflow", intervalMs: 120_000 }).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }))

  it("remove returns count and filters", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const j1 = yield* cron.add({ sessionID: "s3", prompt: "a", intervalMs: 300_000 })
      yield* cron.add({ sessionID: "s3", prompt: "b", intervalMs: 300_000 })
      yield* cron.add({ sessionID: "s4", prompt: "c", intervalMs: 300_000 })
      const removed = yield* cron.remove("s3", j1.id)
      expect(removed).toBe(1)
      const s3jobs = yield* cron.list("s3")
      expect(s3jobs.length).toBe(1)
      const s4jobs = yield* cron.list("s4")
      expect(s4jobs.length).toBe(1)
    }))

  it('remove "all" clears session', () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.add({ sessionID: "s5", prompt: "x", intervalMs: 300_000 })
      yield* cron.add({ sessionID: "s5", prompt: "y", intervalMs: 300_000 })
      const removed = yield* cron.remove("s5", "all")
      expect(removed).toBe(2)
      const jobs = yield* cron.list("s5")
      expect(jobs.length).toBe(0)
    }))

  test("tick fires and updates nextRunAt + runCount using TestClock", async () => {
    const delivered = Deferred.makeUnsafe<{ sessionID: string; prompt: string }>()

    const observingPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        exists: () => Effect.succeed(true),
        deliver: (sessionID, prompt) => Deferred.succeed(delivered, { sessionID, prompt }),
      }),
    )

    const tickLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, observingPort), testEnv)

    const result = await Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.add({ sessionID: "s1", prompt: "fire", intervalMs: 300_000 })

      yield* TestClock.adjust(Duration.zero)
      return yield* Deferred.await(delivered).pipe(Effect.timeout("2 seconds"))
    }).pipe(Effect.provide(tickLayer), Effect.runPromise)

    expect(result).toBeDefined()
    expect(result!.sessionID).toBe("s1")
    expect(result!.prompt).toBe("fire")
  })

  test("first run fires immediately on add (no clock advance needed)", async () => {
    const delivered = Deferred.makeUnsafe<{ sessionID: string; prompt: string }>()

    const observingPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        exists: () => Effect.succeed(true),
        deliver: (sessionID, prompt) => Deferred.succeed(delivered, { sessionID, prompt }),
      }),
    )

    const tickLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, observingPort), testEnv)

    const result = await Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.add({ sessionID: "s_immediate", prompt: "fire-now", intervalMs: 300_000 })
      // No TestClock.adjust — the job should fire at nextRunAt = now.
      yield* TestClock.adjust(Duration.zero)
      return yield* Deferred.await(delivered).pipe(Effect.timeout("2 seconds"))
    }).pipe(Effect.provide(tickLayer), Effect.runPromise)

    expect(result).toBeDefined()
    expect(result!.sessionID).toBe("s_immediate")
    expect(result!.prompt).toBe("fire-now")
  })

  it("expired job is dropped from the heap", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.add({ sessionID: "s1", prompt: "test", intervalMs: 120_000 })

      // Let the first run fire immediately.
      yield* TestClock.adjust(Duration.zero)
      yield* pump

      // Advance past expiresAt (7 days from creation). The next tick
      // will see current >= expiresAt and drop the job.
      yield* TestClock.adjust(Duration.days(8))
      yield* pump

      const jobs = yield* cron.list("s1")
      expect(jobs.length).toBe(0)
    }))

  test("logs a defect raised by deliver instead of swallowing it", async () => {
    const defectingPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        deliver: () => Effect.die("boom from port"),
        exists: () => Effect.succeed(true),
      }),
    )

    const tickLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, defectingPort), testEnv)

    await Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.add({ sessionID: "s_die", prompt: "fire", intervalMs: 60_000 })
      yield* TestClock.adjust(Duration.zero)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      const lines = yield* TestConsole.logLines
      expect(lines.some((l) => String(l).includes("cron delivery defect"))).toBe(true)
    }).pipe(Effect.provide(tickLayer), Effect.runPromise)
  })

  test("add rejects with 'Session not found' when port.exists returns false", async () => {
    const absentPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        exists: () => Effect.succeed(false),
        deliver: () => Effect.void,
      }),
    )

    const rejectLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, absentPort), testEnv)

    const exit = await Effect.gen(function* () {
      const cron = yield* CronService
      return yield* cron.add({ sessionID: "ghost", prompt: "test", intervalMs: 120_000 }).pipe(Effect.exit)
    }).pipe(Effect.provide(rejectLayer), Effect.runPromise)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause) as { message?: string }
      expect(err.message).toContain("Session ghost not found")
    }
  })

  test("logs a non-defect CronDeliveryError as 'cron delivery failed' (distinct from defect)", async () => {
    const { CronDeliveryError } = await import("@opencode-ai/core/cron/port")
    const failingPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        exists: () => Effect.succeed(true),
        deliver: () => Effect.fail(new CronDeliveryError({ message: "delivery refused" })),
      }),
    )

    const tickLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, failingPort), testEnv)

    await Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.add({ sessionID: "s_fail", prompt: "fire", intervalMs: 60_000 })
      yield* TestClock.adjust(Duration.zero)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      const lines = yield* TestConsole.logLines
      expect(lines.some((l) => String(l).includes("cron delivery failed"))).toBe(true)
      expect(lines.some((l) => String(l).includes("cron delivery defect"))).toBe(false)
    }).pipe(Effect.provide(tickLayer), Effect.runPromise)
  })

  test("coalesces pending deliveries and keeps cadence when a delivery is slow", async () => {
    const deliveries: Array<{ sessionID: string; prompt: string; ts: number }> = []
    const gate = Deferred.makeUnsafe<void>()
    let deliverCalls = 0

    const gatedPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        exists: () => Effect.succeed(true),
        deliver: (sessionID, prompt) =>
          Effect.gen(function* () {
            deliverCalls++
            const ts = yield* Clock.currentTimeMillis
            deliveries.push({ sessionID, prompt, ts })
            yield* Deferred.await(gate)
          }),
      }),
    )

    const tickLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, gatedPort), testEnv)

    await Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.add({ sessionID: "s_c", prompt: "fire", intervalMs: 120_000 })

      // T=0: first run fires immediately; delivery blocks on the gate (pending).
      yield* TestClock.adjust(Duration.zero)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      expect(deliverCalls).toBe(1)
      const firstRun = (yield* cron.list("s_c"))[0]
      expect(firstRun.nextRunAt).toBe(120_000)
      expect(firstRun.runCount).toBe(1)

      // T=2min, T=4min: delivery still pending → coalesced, cadence advances.
      yield* TestClock.adjust(Duration.minutes(2))
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* TestClock.adjust(Duration.minutes(2))
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      expect(deliverCalls).toBe(1) // no new delivery while pending
      const afterSkip = (yield* cron.list("s_c"))[0]
      expect(afterSkip.nextRunAt).toBe(6 * 60 * 1000)
      expect(afterSkip.runCount).toBe(1) // coalesced skips don't fork deliveries

      // Release the gate → the pending delivery completes and clears pending.
      yield* Deferred.succeed(gate, undefined)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      // T=6min: delivery no longer pending, next run fires.
      yield* TestClock.adjust(Duration.minutes(2))
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      expect((yield* cron.list("s_c"))[0].runCount).toBe(2)
    }).pipe(Effect.provide(tickLayer), Effect.runPromise)

    expect(deliverCalls).toBe(2)
    expect(deliveries.length).toBe(2)
    expect(deliveries[0].ts).toBe(0)
    expect(deliveries[1].ts).toBe(6 * 60 * 1000)
  })

  test("remove cancels a pending delivery", async () => {
    const gate = Deferred.makeUnsafe<void>()
    let deliverCalls = 0
    let completed = false

    const gatedPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        exists: () => Effect.succeed(true),
        deliver: () =>
          Effect.gen(function* () {
            deliverCalls++
            yield* Deferred.await(gate)
            completed = true
          }),
      }),
    )

    const tickLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, gatedPort), testEnv)

    await Effect.gen(function* () {
      const cron = yield* CronService
      const job = yield* cron.add({ sessionID: "s_del", prompt: "fire", intervalMs: 120_000 })

      yield* TestClock.adjust(Duration.zero)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      expect(deliverCalls).toBe(1) // delivery started and is blocked

      yield* cron.remove("s_del", job.id)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      // Release the gate. If the delivery were still alive it would complete.
      yield* Deferred.succeed(gate, undefined)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.yieldNow
    }).pipe(Effect.provide(tickLayer), Effect.runPromise)

    expect(completed).toBe(false) // pending delivery was interrupted on remove
    expect(deliverCalls).toBe(1)
  })

  // The `job.id !== top.id` guard defends against the heap head changing between
  // the peek and the dequeue (e.g. a sooner job inserted mid-sleep). Under
  // immediate-fire this is defensive: a new job fires via its own wake/tick, so
  // the observable guarantee is ordering — the sooner job fires before the
  // later job's next tick.
  test("sooner job inserted during a later job's sleep fires first", async () => {
    const deliveries: Array<{ sessionID: string; prompt: string; ts: number }> = []

    const trackingPort = Layer.succeed(
      CronDeliveryPort,
      CronDeliveryPort.of({
        exists: () => Effect.succeed(true),
        deliver: (sessionID, prompt) =>
          Effect.gen(function* () {
            const ts = yield* Clock.currentTimeMillis
            deliveries.push({ sessionID, prompt, ts })
          }),
      }),
    )

    const tickLayer = Layer.provideMerge(Layer.provideMerge(cronLayer, trackingPort), testEnv)

    await Effect.gen(function* () {
      const cron = yield* CronService
      // Job A fires immediately at T=0, nextRunAt becomes T+10min.
      const jobA = yield* cron.add({ sessionID: "sA", prompt: "A", intervalMs: 600_000 })
      yield* TestClock.adjust(Duration.zero)
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      // Advance to T=5min — A is sleeping until T=10min.
      yield* TestClock.adjust(Duration.minutes(5))
      yield* Effect.yieldNow

      // Job B fires immediately at T=5min (nextRunAt = now = 5min).
      const jobB = yield* cron.add({ sessionID: "sB", prompt: "B", intervalMs: 60_000 })
      yield* TestClock.adjust(Duration.zero)
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      // Remove B so it doesn't keep firing.
      yield* cron.remove("sB", jobB.id)

      // Advance to T=10min — A's second tick fires.
      yield* TestClock.adjust(Duration.minutes(5))
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      yield* cron.remove("sA", jobA.id)
    }).pipe(Effect.provide(tickLayer), Effect.runPromise)

    // B fired at T=5min, A's second tick fired at T=10min.
    expect(deliveries.length).toBe(3) // A at 0, B at 5min, A at 10min
    expect(deliveries[0].prompt).toBe("A")
    expect(deliveries[0].ts).toBe(0)
    expect(deliveries[1].prompt).toBe("B")
    expect(deliveries[1].ts).toBe(5 * 60 * 1000)
    expect(deliveries[2].prompt).toBe("A")
    expect(deliveries[2].ts).toBe(10 * 60 * 1000)
  })
})
