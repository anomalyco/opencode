import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { BackgroundJob } from "@/background/job"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionID } from "@/session/schema"
import { SessionPhysical } from "@/session/physical-interrupt"
import { SessionRunState } from "@/session/run-state"
import { syntheticAdmission } from "../lib/background"
import { admittingJobs } from "../lib/closure"
import { awaitWithTimeout, testEffectBounded } from "../lib/effect"

// CP-023 Gate 4 step 2 — K63 / I-29. The finalizer-safe exact physical interrupt.
//
// §2.6's cycle is real and closed: `BackgroundJob.cancelExact` closes the job scope and AWAITS the
// run fiber, while that fiber's own interrupt finalizer reaches back for a cancellation. If the
// finalizer waits for the interrupt that is waiting for it, nothing completes.
//
// HOW THIS FILE REPORTS RATHER THAN HANGS. A deadlock is the failure under test, and a test that
// detects deadlock BY deadlocking cannot report it — it can only stop. So every probe that would
// block under the defect is wrapped in `awaitWithTimeout`, which names the violation in ms, and the
// whole file runs under `testEffectBounded` so a genuinely wedged fiber dies at FIBER_BOUND_MILLIS
// with a message instead of stalling the runner. Barriers are released on the failure path for the
// same reason: a parked run fiber would otherwise keep the suite's scope from closing.

/**
 * Admits execution AND job binds. `admittingClosure` cannot be reused here: its `acquire` dies, and
 * `SessionRunState.ensureRunning` acquires an execution lease before it will start a Runner.
 *
 * Everything not needed still dies, per `unusedJobs`' doctrine — an unstubbed call should be a loud
 * failure rather than a quiet wrong answer.
 */
let leases = 0
const admitting = Layer.succeed(
  SessionClosure.Service,
  SessionClosure.Service.of({
    ...admittingJobs,
    acquire: () =>
      Effect.sync(() => {
        leases += 1
        return {
          type: "admitted" as const,
          lease: Model.id("lease", `lease_physical_${leases}`),
          epoch: 0n,
          instance: Model.id("instance", "instance_physical"),
        }
      }),
    bind: () => Effect.void,
    retire: () => Effect.void,
    request: () => Effect.die("unused"),
    view: Effect.die("unused"),
    identity: Effect.die("unused"),
    reserveMutation: () => Effect.die("unused"),
    activateMutation: () => Effect.die("unused"),
    retireMutation: () => Effect.die("unused"),
  }),
)

// ONE registry each, composed by the target's node graph. Compiling the physical-interrupt node
// memoizes its SessionRunState and BackgroundJob dependencies, while the replacement supplies the
// one admitting coordinator this test requires. The construction-count test below measures that
// this held; the behavioural tests assume it.
const runState = LayerNode.compile(SessionRunState.node, [[SessionClosure.node, admitting]])
const physical = LayerNode.compile(
  LayerNode.group([SessionPhysical.node, SessionRunState.node, BackgroundJob.node]),
  [[SessionClosure.node, admitting]],
)

const it = testEffectBounded(physical)

const target = (name: string) => SessionID.make(`ses_physical_${name}`)

describe("closure.physical-interrupt", () => {
  // An END-TO-END integration fact: a physical interrupt issued through `SessionPhysical` reaches a
  // Runner started through `SessionRunState.Service`, so in this graph the two are wired to the same
  // registry and `interruptRunner` really does cancel a live Runner.
  //
  // WHAT THIS DOES NOT ESTABLISH, stated because an earlier version of this comment claimed it did:
  // it is not a guard against two registries. Layer memoization makes one instance by construction,
  // so that defect cannot be reached here to be caught — a falsification attempt confirmed the test
  // stays green. The one-construction property is measured directly by the test below instead.
  it.instance("a physical interrupt reaches a Runner started through SessionRunState", () =>
    Effect.gen(function* () {
      const runs = yield* SessionRunState.Service
      const phys = yield* SessionPhysical.Service
      const session = target("shared")
      const started = yield* Deferred.make<void>()

      const running = yield* runs
        .ensureRunning(session, Effect.never, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.forkChild)

      // POSITIVE PRECONDITION: the Runner really is busy. Without it the interrupt below could
      // answer `absent` for the honest reason that nothing had started yet, and the test would pass
      // for the wrong reason on a slow scheduler.
      yield* Deferred.await(started)
      expect(
        yield* runs.assertNotBusy(session).pipe(
          Effect.exit,
          Effect.map((exit) => exit._tag),
        ),
      ).toBe("Failure")

      const outcome = yield* phys.interruptExact({ type: "session", session })
      expect(outcome.type).toBe("interrupted")

      yield* Fiber.interrupt(running)
    }),
  )

  // Absent is not success. §8.6: "a stale/absent target is not silently classified as success
  // without corroborating evidence." Paired with the test above, this is what makes `interrupted`
  // load-bearing rather than a constant every call returns.
  it.instance("a target with no Runner reports absent, not interrupted", () =>
    Effect.gen(function* () {
      const phys = yield* SessionPhysical.Service
      const outcome = yield* phys.interruptExact({ type: "session", session: target("missing") })
      expect(outcome.type).toBe("absent")
    }),
  )

  // The one-construction property, MEASURED rather than violated.
  //
  // Constructing the defect is the wrong instrument here, and that is structural rather than
  // incidental: layer memoization makes one instance BY CONSTRUCTION, so the violation is not
  // reachable without defeating the very mechanism that guarantees the property. Defeating it
  // broadly (`Layer.fresh`) also freshens `BackgroundJob`, which leaves a run fiber parked on
  // `Effect.never` and HANGS teardown instead of failing — a fixture more likely to be wrong than
  // the property it is testing.
  //
  // So the property is measured: substitute a counting layer for the shared `SessionRunState` and
  // assert the graph builds exactly one. Build-only, and that is what makes it safe — nothing starts
  // a job, so there is no fiber to park and no way for this test to hang. Falsification is trivial
  // and clean: a second construction site takes the count to two.
  it.effect("one construction: the graph builds a single SessionRunState for SessionPhysical", () =>
    Effect.gen(function* () {
      const builds: number[] = []
      const counted = Layer.effect(
        SessionRunState.Service,
        Effect.gen(function* () {
          builds.push(1)
          return yield* SessionRunState.Service
        }),
      ).pipe(Layer.provideMerge(runState))

      yield* Effect.void.pipe(
        Effect.provide(
          LayerNode.compile(SessionPhysical.node, [
            [SessionRunState.node, counted],
            [SessionClosure.node, admitting],
          ]),
        ),
      )

      expect(builds.length).toBe(1)
    }),
  )

  // K63, the crossing itself. The BackgroundJob `Scope.close` barrier is held open by the outer
  // interrupt while the run fiber's own interrupt finalizer calls back in for the SAME lifetime.
  //
  // Both assertions are positive: the outer interrupt COMPLETES (bounded, so a self-wait is named
  // rather than hung), and the finalizer records `in_progress` — proof it took the report path and
  // returned while the interrupt it would otherwise have awaited was still running.
  it.instance("K63: a target's own finalizer reports without waiting on the interrupt awaiting it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const phys = yield* SessionPhysical.Service
      const entered = yield* Deferred.make<void>()
      const observed: SessionPhysical.Outcome[] = []

      // The finalizer needs the handle that `startExact` RETURNS, so it takes it from a fixture
      // Deferred filled immediately below. This is a test-fixture handle, never the interrupt
      // registry: it is already resolved long before any interrupt can run, because the test awaits
      // `entered` first. Reading `started` directly inside its own initializer would be circular.
      const handle = yield* Deferred.make<BackgroundJob.Lifetime>()
      const started = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k63_crossing",
        type: "test",
        run: Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            // Running INSIDE the scope the outer interrupt is closing, and targeting the very
            // lifetime that interrupt owns.
            Deferred.await(handle).pipe(
              Effect.flatMap((lifetime) => phys.reportExact({ type: "lifetime", lifetime })),
              Effect.tap((outcome) => Effect.sync(() => void observed.push(outcome))),
            ),
          ),
          Effect.as(undefined),
        ),
      })

      expect(started.lifetime).toBeDefined()
      yield* Deferred.succeed(handle, started.lifetime!)
      // HYGIENE, not part of the assertion. A job left parked on `Effect.never` keeps the suite's
      // scope from closing, so an assertion that fails before the interrupt below would hang the
      // runner instead of reporting. That shape has cost this gate twice; every job this file starts
      // is terminated on every exit.
      yield* Effect.addFinalizer(() => jobs.cancel("job_k63_crossing").pipe(Effect.ignore))
      // POSITIVE PRECONDITION: the run body is actually executing, so its finalizer will genuinely
      // run. A job that never armed would make "no deadlock" vacuous.
      yield* Deferred.await(entered)

      const outcome = yield* awaitWithTimeout(
        phys.interruptExact({ type: "lifetime", lifetime: started.lifetime! }),
        "K63/I-29: interruptExact did not complete — the target's own finalizer is waiting on the interrupt that is waiting for it",
      )

      expect(outcome.type).toBe("interrupted")
      // The load-bearing assertion. `in_progress` is returned ONLY on the path that declines to
      // await an in-flight interrupt, so observing it proves the finalizer did not self-wait.
      expect(observed).toEqual([{ type: "in_progress" }])
      expect((yield* jobs.get("job_k63_crossing"))?.status).toBe("cancelled")
    }),
  )

  // Report and adopt are two answers to ONE situation, and this is what makes them genuinely
  // different rather than a naming preference: with an interrupt in flight, an independent caller
  // BLOCKS where the target's own finalizer does not.
  it.instance("an independent caller adopts an in-flight interrupt while a report returns at once", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const phys = yield* SessionPhysical.Service
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()

      const started = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k63_adopt",
        type: "test",
        run: Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          // Holds the `Scope.close` barrier open so the in-flight window is a place the test can
          // stand on rather than a race it has to win.
          Effect.onInterrupt(() => Deferred.await(release)),
          Effect.as(undefined),
        ),
      })
      expect(started.lifetime).toBeDefined()
      const lifetime = started.lifetime!
      // HYGIENE. The barrier is released FIRST: `cancel` closes the job scope and awaits the run
      // fiber, whose interrupt finalizer is parked on `release`, so cancelling without releasing
      // would itself hang. Same reason as the sibling test — a failed assertion must report, not
      // stall the runner.
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(release, undefined).pipe(Effect.andThen(jobs.cancel("job_k63_adopt")), Effect.ignore),
      )
      yield* Deferred.await(entered)

      // Completion is tracked through Deferreds rather than fiber polling: `Fiber.poll` does not
      // exist on this Effect version, and "has this settled yet" is exactly what a Deferred answers.
      const ownerDone = yield* Deferred.make<SessionPhysical.Outcome>()
      const owner = yield* phys.interruptExact({ type: "lifetime", lifetime }).pipe(
        Effect.tap((outcome) => Deferred.succeed(ownerDone, outcome)),
        Effect.forkChild,
      )

      // POSITIVE PRECONDITION: the owner is genuinely parked mid-interrupt, so the two probes below
      // are measured against a real in-flight window rather than an assumed one.
      yield* Effect.sleep("50 millis")
      expect(yield* Deferred.isDone(ownerDone)).toBe(false)

      // REPORT: returns while the owner is provably still running. That is the absence of self-wait
      // stated positively — the thing it would have awaited has not completed.
      const reported = yield* awaitWithTimeout(
        phys.reportExact({ type: "lifetime", lifetime }),
        "K63/I-29: reportExact blocked on an in-flight interrupt instead of reporting it",
      ).pipe(Effect.onError(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid)))
      expect(reported.type).toBe("in_progress")
      expect(yield* Deferred.isDone(ownerDone)).toBe(false)

      // ADOPT: the contrast. An independent caller does NOT return early — it is still parked on
      // the same in-flight interrupt, which is precisely why `in_progress` above means something.
      const adopterDone = yield* Deferred.make<SessionPhysical.Outcome>()
      const adopter = yield* phys.interruptExact({ type: "lifetime", lifetime }).pipe(
        Effect.tap((outcome) => Deferred.succeed(adopterDone, outcome)),
        Effect.forkChild,
      )
      yield* Effect.sleep("50 millis")
      expect(yield* Deferred.isDone(adopterDone)).toBe(false)

      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(owner)).type).toBe("interrupted")
      expect((yield* Fiber.join(adopter)).type).toBe("adopted")
    }),
  )
})
