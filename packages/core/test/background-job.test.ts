import { describe, expect, test } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { it } from "./lib/effect"

const jobsLayer = LayerNode.compile(BackgroundJob.node)

const admission = { lease: "lease_synthetic_core", epoch: 0n }

/**
 * Arms sequence zero and refuses every later one, parking inside `bind` first so a test can hold a
 * supplemental sequence in the registered-but-unarmed window and release it deliberately.
 */
const refusingBinder = (input: {
  readonly entered: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
}): BackgroundJob.Binder => ({
  bind: (request) =>
    request.sequence === 0
      ? BackgroundJob.makePermit(request.lifetime, request.sequence).pipe(
          Effect.map((made) => ({ kind: "arm_allowed" as const, permit: made.permit })),
        )
      : Deferred.succeed(input.entered, undefined).pipe(
          Effect.andThen(Deferred.await(input.release)),
          Effect.as({ kind: "rejected" as const, reason: "refused after reserving" }),
        ),
  terminal: () => Effect.void,
})

/**
 * A run reports the position it answered at plus an opaque payload. Tests use the position string
 * as the payload too, so an assertion names one value.
 */
const answered = (position: string, at: number, detected: unknown = position) =>
  ({ position, at, detected }) satisfies BackgroundJob.Detected

describe("BackgroundJob.AnswerLog", () => {
  const publish = (state: BackgroundJob.AnswerLog.State, position: string, at: number) =>
    BackgroundJob.AnswerLog.transition(state, { _tag: "Publish", position, at, detected: position, notes: [] })

  test("orders by creation time, not by the order filings arrive", () => {
    const later = publish(BackgroundJob.AnswerLog.empty, "m2", 200)
    expect(later._tag).toBe("published")
    const earlier = publish(later.state, "m1", 100)
    expect(earlier._tag).toBe("published")
    if (earlier._tag !== "published") return
    // The late-arriving earlier answer takes index 0 and pushes the other out to 1.
    expect(earlier.index).toBe(0)
    expect(earlier.state.entries.map((entry) => entry.position)).toEqual(["m1", "m2"])
    expect(earlier.state.entries.map((entry) => entry.answer.index)).toEqual([0, 1])
  })

  test("position breaks ties only when creation times are equal", () => {
    const first = publish(BackgroundJob.AnswerLog.empty, "mb", 100)
    const second = publish(first.state, "ma", 100)
    expect(second.state.entries.map((entry) => entry.position)).toEqual(["ma", "mb"])
  })

  test("message ids that wrap do not reorder answers, because time leads the key", () => {
    // A wrapped id sorts lexically below one issued long before it; chronology has to win.
    const wrapped = publish(BackgroundJob.AnswerLog.empty, "aaa_wrapped", 500)
    const older = publish(wrapped.state, "zzz_older", 100)
    expect(older.state.entries.map((entry) => entry.position)).toEqual(["zzz_older", "aaa_wrapped"])
  })

  test("observation is the only release, and it advances the base index", () => {
    const state = publish(publish(BackgroundJob.AnswerLog.empty, "m1", 100).state, "m2", 200).state
    const first = BackgroundJob.AnswerLog.transition(state, { _tag: "Observe", after: 0 })
    expect(first._tag).toBe("answer")
    if (first._tag !== "answer") return
    expect(first.answer.detected).toBe("m1")
    expect(first.state.baseIndex).toBe(1)
    expect(first.state.entries.map((entry) => entry.position)).toEqual(["m2"])

    // Re-reading an already-released index clamps up to the base rather than replaying it.
    const second = BackgroundJob.AnswerLog.transition(first.state, { _tag: "Observe", after: 0 })
    expect(second._tag).toBe("answer")
    if (second._tag !== "answer") return
    expect(second.answer.detected).toBe("m2")
  })

})

describe("BackgroundJob.settleAdmissibility", () => {
  const token = {}

  test("admits only the running lifetime that constructed the run", () => {
    expect(BackgroundJob.settleAdmissibility({ token, status: "running" }, token)).toBe("admit")
  })

  test("reports a replaced lifetime as foreign, so its filing is dropped rather than misrouted", () => {
    expect(BackgroundJob.settleAdmissibility({ token: {}, status: "running" }, token)).toBe("foreign_token")
  })

  test("reports every terminal status as not running, which is the terminalization race boundary", () => {
    for (const status of ["completed", "error", "cancelled"] as const) {
      expect(BackgroundJob.settleAdmissibility({ token, status }, token)).toBe("not_running")
    }
  })

  test("a foreign token on a terminal occupant is still foreign", () => {
    expect(BackgroundJob.settleAdmissibility({ token: {}, status: "completed" }, token)).toBe("foreign_token")
  })
})

describe("BackgroundJob", () => {
  it.live("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        admission,
        type: "test",
        metadata: { durable: false },
        run: Deferred.await(latch).pipe(Effect.as(answered("m1", 100, "done"))),
      })

      expect(job).toMatchObject({ type: "test", status: "running", metadata: { durable: false } })
      expect(yield* jobs.wait({ id: job.id, timeout: 0 })).toMatchObject({
        timedOut: true,
        info: { status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("publishes jobs before starting immediately settling work", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) => {
        const id = `job_immediate_start_${index}`
        return Effect.gen(function* () {
          const job = yield* jobs.start({
            admission,
            id,
            type: "test",
            run: jobs
              .get(id)
              .pipe(
                Effect.flatMap((info) =>
                  info?.status === "running"
                    ? Effect.succeed(answered(`m_${index}`, 100, `done-${index}`))
                    : Effect.fail("job started before publish"),
                ),
              ),
          })

          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `done-${index}` },
          })
        })
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("increments pending work before starting immediately settling extensions", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) =>
        Effect.gen(function* () {
          const first = yield* Deferred.make<void>()
          const job = yield* jobs.start({
            admission,
            type: "test",
            run: Deferred.await(first).pipe(Effect.as(answered(`m1_${index}`, 100, `first-${index}`))),
          })

          expect(
            yield* jobs.extend({
              admission,
              id: job.id,
              run: Effect.succeed(answered(`m2_${index}`, 200, `second-${index}`)),
            }),
          ).toBe(true)
          expect((yield* jobs.get(job.id))?.status).toBe("running")

          yield* Deferred.succeed(first, undefined)
          // The inline slot carries the FIRST answer in conversation order - the one this caller's
          // own prompt produced - even though the extension settled first. The later answer stays
          // retained rather than replacing it.
          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `first-${index}` },
          })
        }),
      )
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("runs a supplemental sequence without waiting for the previous one to finish", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const held = yield* Deferred.make<void>()
      const supplementStarted = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        admission,
        type: "test",
        run: Deferred.await(held).pipe(Effect.as(answered("m1", 100, "owner"))),
      })

      // If the serial hold were still in place this run could not begin until the owner settled,
      // and awaiting its start signal below would time out.
      expect(
        yield* jobs.extend({
          admission,
          id: job.id,
          run: Deferred.succeed(supplementStarted, undefined).pipe(Effect.as(answered("m2", 200, "supplement"))),
        }),
      ).toBe(true)

      yield* Deferred.await(supplementStarted).pipe(Effect.timeout("5 seconds"))
      yield* Deferred.succeed(held, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({ info: { status: "completed" } })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("delivers answers one at a time, in order, once the lifetime is observed", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const owner = yield* Deferred.make<void>()
      const supplement = yield* Deferred.make<void>()
      // Both runs are held, so the lifetime cannot terminalize before the extension registers.
      const started = yield* jobs.startExact({
        admission,
        id: "job_answer_order",
        type: "test",
        metadata: { background: true },
        run: Deferred.await(owner).pipe(Effect.as(answered("m1", 100, "owner"))),
      })
      const handle = started.handle
      expect(handle).toBeDefined()
      if (!handle) return

      yield* jobs.extend({
        admission,
        id: "job_answer_order",
        run: Deferred.await(supplement).pipe(Effect.as(answered("m2", 200, "supplement"))),
      })

      yield* Deferred.succeed(owner, undefined)
      const first = yield* jobs.waitAnswer({ handle, after: 0 })
      expect(first.answer?.detected).toBe("owner")
      expect(first.answer?.index).toBe(0)

      yield* Deferred.succeed(supplement, undefined)
      const second = yield* jobs.waitAnswer({ handle, after: 1 })
      expect(second.answer?.detected).toBe("supplement")
      expect(second.answer?.index).toBe(1)

      // Past the last answer the gate reports the terminal rather than parking forever.
      const terminal = yield* jobs.waitAnswer({ handle, after: 2 })
      expect(terminal.answer).toBeUndefined()
      expect(terminal.info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("carries a run's notice to the terminal when it produced no answer", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const held = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        admission,
        type: "test",
        run: Deferred.await(held).pipe(Effect.as(answered("m1", 100, "owner"))),
      })

      yield* jobs.extend({
        admission,
        id: job.id,
        run: Effect.succeed({ note: "could not be admitted: closing." }),
      })
      yield* Deferred.succeed(held, undefined)

      const waited = yield* jobs.wait({ id: job.id })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.notes).toEqual(["could not be admitted: closing."])
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("adds the inline outstanding notice when a success terminal retains a second answer", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const held = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        admission,
        type: "test",
        outstanding: { observer: "delivered separately", inline: "still registered" },
        run: Deferred.await(held).pipe(Effect.as(answered("m1", 100, "owner"))),
      })

      yield* jobs.extend({
        admission,
        id: job.id,
        run: Effect.succeed(answered("m2", 200, "supplement")),
      })
      yield* Deferred.succeed(held, undefined)

      const waited = yield* jobs.wait({ id: job.id })
      // The blocked caller receives the first answer inline; the retained second one is announced
      // rather than pushed.
      expect(waited.info?.output).toBe("owner")
      expect(waited.info?.notes).toEqual(["still registered"])
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("reports promotion for a job that was created already observed", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const held = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_born_observed",
        type: "test",
        metadata: { background: true },
        run: Deferred.await(held).pipe(Effect.as(answered("m1", 100, "owner"))),
      })
      expect(started.lifetime).toBeDefined()
      if (!started.lifetime) return

      // No transition occurs for a job born observed, so this resolves only because registration
      // completed it.
      const promoted = yield* jobs.waitForPromotionExact(started.lifetime).pipe(Effect.timeout("5 seconds"))
      expect(promoted?.metadata?.background).toBe(true)
      yield* Deferred.succeed(held, undefined)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("publishes answers buffered before promotion, in order and with the outstanding notice", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_promote_publish"
      const openEnded = yield* Deferred.make<void>()
      // Starts foreground, so the answers below are buffered rather than published. The owner run
      // produces no answer and stays open, which both keeps the lifetime running until promotion
      // and keeps pending above zero as each answer completes - the latter is what earns the
      // outstanding notice.
      const started = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        outstanding: { observer: "delivered separately", inline: "still registered" },
        run: Deferred.await(openEnded).pipe(Effect.as(undefined)),
      })
      const handle = started.handle
      expect(handle).toBeDefined()
      if (!handle) return

      // Filed later but earlier in conversation, so publication order is not filing order.
      yield* jobs.extend({ admission, id, run: Effect.succeed(answered("m2", 200, "supplement")) })
      yield* jobs.extend({ admission, id, run: Effect.succeed(answered("m1", 100, "owner")) })

      // A settling delay, not an ordering proof: it gives both runs time to reach the buffer so
      // that promotion below exercises the buffered drain. Ordering itself is pinned by the pure
      // log tests above and by the inline-disposition cell, both of which are timing-free - if this
      // delay were ever insufficient the answers would still arrive, just by the immediate path.
      yield* Effect.sleep("100 millis")

      expect((yield* jobs.promote(id))?.metadata?.background).toBe(true)

      // Buffered in conversation order, not in the order they filed.
      const first = yield* jobs.waitAnswer({ handle, after: 0 })
      expect(first.answer?.detected).toBe("owner")
      expect(first.answer?.notes).toContain("delivered separately")
      const second = yield* jobs.waitAnswer({ handle, after: 1 })
      expect(second.answer?.detected).toBe("supplement")

      yield* Deferred.succeed(openEnded, undefined)
      yield* jobs.wait({ id })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("cancels the observed run while it is still the one filed under its id", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_lifetime_current"
      const latch = yield* Deferred.make<void>()
      yield* jobs.start({
        admission,
        id,
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as(answered("m1", 100, "done"))),
      })

      const observed = (yield* jobs.listExact()).filter((entry) => entry.info.id === id)[0]
      expect(observed.info).toMatchObject({ id, type: "test", status: "running" })

      expect(yield* jobs.cancelExact(observed.lifetime)).toMatchObject({ status: "cancelled" })
      expect((yield* jobs.get(id))?.status).toBe("cancelled")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("leaves a cancelled terminal without an answer payload, so the answer stays retrievable", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_cancel_no_output"
      const held = yield* Deferred.make<void>()
      yield* jobs.start({
        admission,
        id,
        type: "test",
        run: Deferred.await(held).pipe(Effect.as(answered("m1", 100, "owner"))),
      })
      yield* jobs.extend({ admission, id, run: Effect.succeed(answered("m2", 200, "supplement")) })

      const cancelled = yield* jobs.cancel(id)
      expect(cancelled?.status).toBe("cancelled")
      expect(cancelled?.output).toBeUndefined()
      yield* Deferred.succeed(held, undefined)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("leaves the successor alone when the observed run has already been replaced", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_lifetime_replaced"
      const first = yield* Deferred.make<void>()
      yield* jobs.start({
        admission,
        id,
        type: "test",
        run: Deferred.await(first).pipe(Effect.as(answered("m1", 100, "first"))),
      })

      // What a caller sees before it acts.
      const observed = (yield* jobs.listExact()).filter((entry) => entry.info.id === id)[0]

      // That run settles and a second one takes the same id, as a resumed session does.
      yield* Deferred.succeed(first, undefined)
      expect(yield* jobs.wait({ id })).toMatchObject({ info: { status: "completed", output: "first" } })
      const second = yield* Deferred.make<void>()
      yield* jobs.start({
        admission,
        id,
        type: "test",
        run: Deferred.await(second).pipe(Effect.as(answered("m2", 200, "second"))),
      })

      expect(yield* jobs.cancelExact(observed.lifetime)).toBeUndefined()
      expect((yield* jobs.get(id))?.status).toBe("running")

      yield* Deferred.succeed(second, undefined)
      expect(yield* jobs.wait({ id })).toMatchObject({ info: { status: "completed", output: "second" } })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("cancels by id whichever run is current, which is why callers that observed one use cancelExact", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_lifetime_by_id"
      const first = yield* Deferred.make<void>()
      yield* jobs.start({
        admission,
        id,
        type: "test",
        run: Deferred.await(first).pipe(Effect.as(answered("m1", 100, "first"))),
      })

      yield* Deferred.succeed(first, undefined)
      expect(yield* jobs.wait({ id })).toMatchObject({ info: { status: "completed", output: "first" } })
      const second = yield* Deferred.make<void>()
      yield* jobs.start({
        admission,
        id,
        type: "test",
        run: Deferred.await(second).pipe(Effect.as(answered("m2", 200, "second"))),
      })

      expect((yield* jobs.cancel(id))?.status).toBe("cancelled")
      expect((yield* jobs.get(id))?.status).toBe("cancelled")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("interrupts live work without promising settlement after the owning process-local scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const interrupted = yield* Deferred.make<void>()
      const jobs = yield* BackgroundJob.make.pipe(Scope.provide(scope))
      const job = yield* jobs.start({
        admission,
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      yield* Scope.close(scope, Exit.void)

      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      // The abandoned in-memory registry is not a durable observation channel.
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )

  it.live("dispositions when a refused extension returns pending to zero", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // THE STRAND. `reserve` raises `pending` for a supplement that then LOSES admission. The
        // owner sequence has already succeeded, so its settle saw `pending > 0` and correctly kept
        // the lifetime running. When the refusal returns `pending` to zero there is nothing left
        // running to call `settle` again — so without a disposition on this path the lifetime sits
        // `running` at `pending: 0` forever, and two things break: a blocked SYNCHRONOUS caller
        // never receives its answer (`done` is resolved only at disposition), and the owner's
        // completed answer is silently discarded, because moving it into the terminal Info is
        // itself a disposition step.
        const holdOwner = yield* Deferred.make<void>()
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const jobs = yield* BackgroundJob.makeWith(refusingBinder({ entered, release }))
        const started = yield* jobs.startExact({
          admission,
          id: "job_unreserve_strand",
          type: "test",
          run: Deferred.await(holdOwner).pipe(Effect.as({ position: "p_a", at: 1, detected: "owner answer" })),
        })
        if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")

        // A blocked synchronous caller — the shape a synchronously started task takes.
        const blocked = yield* jobs.wait({ id: "job_unreserve_strand" }).pipe(Effect.forkScoped)

        // The supplement RESERVES (pending 2) and parks inside bind.
        const extension = yield* jobs
          .extendWithHandle({ id: "job_unreserve_strand", admission, run: Effect.succeed(undefined) })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(entered)

        // The owner settles successfully inside that window: pending 2 → 1, answer buffered,
        // correctly no disposition because a supplement is still registered.
        yield* Deferred.succeed(holdOwner, undefined)
        yield* Effect.yieldNow
        yield* Effect.yieldNow

        // The parked bind now REFUSES: pending 1 → 0 with nothing left running.
        yield* Deferred.succeed(release, undefined)
        expect(yield* Fiber.join(extension)).toBeUndefined()

        // The lifetime MUST dispose, and as `completed` rather than `error`/`cancelled`: the
        // FOLLOW-UP was refused — its own caller learns that from its own result — while the run's
        // own work demonstrably succeeded.
        const settled = yield* jobs.wait({ id: "job_unreserve_strand", timeout: 1000 })
        // Bounded-negative: before the fix this fiber parks forever.
        const delivered = yield* Effect.raceFirst(
          Fiber.join(blocked).pipe(Effect.as("released" as const)),
          Effect.sleep("500 millis").pipe(Effect.as("hung" as const)),
        )

        // Gathered before any assertion, and asserted together, so one failing run reports every
        // consequence at once rather than stopping at the first.
        expect({
          status: settled.info?.status,
          output: settled.info?.output,
          blockedCaller: delivered,
        }).toEqual({
          status: "completed",
          output: "owner answer",
          blockedCaller: "released",
        })
      }),
    ),
  )

  it.live("releases the lifetime waiter when a refused extension ends a background job", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The consequence that motivated the fix. A caller can park on `waitHandle` — that is, on
        // the job's TERMINAL — to learn when the lifetime ends; the task tool does exactly this to
        // release a child session's attachment scope. While a refused extension could leave the
        // lifetime running at `pending: 0`, that terminal never arrived and the waiter was held
        // indefinitely.
        const holdOwner = yield* Deferred.make<void>()
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const jobs = yield* BackgroundJob.makeWith(refusingBinder({ entered, release }))
        const started = yield* jobs.startExact({
          admission,
          id: "job_unreserve_observer",
          type: "test",
          metadata: { background: true },
          run: Deferred.await(holdOwner).pipe(Effect.as({ position: "p_a", at: 1, detected: "owner answer" })),
        })
        if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")

        const waiter = yield* jobs.waitHandle({ handle: started.handle }).pipe(Effect.forkScoped)

        const extension = yield* jobs
          .extendWithHandle({ id: "job_unreserve_observer", admission, run: Effect.succeed(undefined) })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(entered)

        yield* Deferred.succeed(holdOwner, undefined)
        yield* Effect.yieldNow
        yield* Effect.yieldNow

        yield* Deferred.succeed(release, undefined)
        expect(yield* Fiber.join(extension)).toBeUndefined()

        // Bounded-negative: before the fix this waiter is held forever.
        const released = yield* Effect.raceFirst(
          Fiber.join(waiter).pipe(Effect.as("released" as const)),
          Effect.sleep("500 millis").pipe(Effect.as("held" as const)),
        )
        expect(released).toBe("released")

        // And the work that DID complete is still delivered: ending the lifetime is not the same as
        // discarding the answer the run already produced.
        const first = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
        expect(first.answer?.detected).toBe("owner answer")
      }),
    ),
  )
})
