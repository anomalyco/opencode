import { readFileSync } from "node:fs"
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

// ---------------------------------------------------------------------------------------------
// CP-032 T-032-6 core floor matrix (A1-A9) helpers
// ---------------------------------------------------------------------------------------------

/**
 * A run shaped like a SCOPED Task sequence: detect, ANNOUNCE the unresolved eligibility decision,
 * then park on the decision (`task.ts` `eligible` — announce with no await in between, then one
 * `Scope.result()`).
 *
 * `ready` completes AFTER the announcement has landed, so a test never has to guess when the floor
 * became live; every A-row that depends on an installed floor awaits it rather than sleeping.
 */
const announcing = (input: {
  readonly ready?: Deferred.Deferred<void>
  readonly body: Effect.Effect<BackgroundJob.SequenceOutcome, unknown>
}): Effect.Effect<BackgroundJob.SequenceOutcome, unknown, BackgroundJob.Announce> =>
  Effect.gen(function* () {
    const announce = yield* BackgroundJob.Announce
    yield* announce()
    if (input.ready) yield* Deferred.succeed(input.ready, undefined)
    return yield* input.body
  })

/** The same run shape WITHOUT the announcement — the control arm, and R-06's unannounced work. */
const silent = (input: {
  readonly ready?: Deferred.Deferred<void>
  readonly body: Effect.Effect<BackgroundJob.SequenceOutcome, unknown>
}): Effect.Effect<BackgroundJob.SequenceOutcome, unknown, BackgroundJob.Announce> =>
  Effect.gen(function* () {
    if (input.ready) yield* Deferred.succeed(input.ready, undefined)
    return yield* input.body
  })

type Observed =
  | { readonly tag: "delivered"; readonly result: BackgroundJob.WaitAnswerResult }
  | { readonly tag: "withheld"; readonly result: undefined }

/**
 * Bounded NEGATIVE observation, the established convention in this file (T-05a, T-42): race the
 * gate against a real sleep and report which won. Nothing waits ON the sleep — a correct floor
 * withholds forever, so the window only has to be long enough to expose an escape.
 *
 * It returns the winning result rather than a tag alone, because a race that DELIVERS has already
 * advanced the log's base index; discarding it would lose the answer the row still has to assert.
 */
const observation = (self: Effect.Effect<BackgroundJob.WaitAnswerResult>, windowMillis = 150) =>
  Effect.race(
    self.pipe(Effect.map((result): Observed => ({ tag: "delivered", result }))),
    Effect.sleep(windowMillis).pipe(Effect.as({ tag: "withheld", result: undefined } satisfies Observed)),
  )

/**
 * Bounded POSITIVE await. Every positive oracle below is on something a floor regression withholds
 * FOREVER rather than gets wrong, and Bun's per-test timeout fails the test without interrupting
 * the fiber — an unbounded await would wedge the runner instead of reporting. Far above any honest
 * path; reaching it is always a defect.
 */
const within = <A, E, R>(self: Effect.Effect<A, E, R>, what: string) =>
  self.pipe(
    Effect.timeoutOption(10_000),
    Effect.flatMap((option) =>
      option._tag === "Some" ? Effect.succeed(option.value) : Effect.die(new Error(`${what} — withheld forever`)),
    ),
  )

describe("BackgroundJob.AnswerLog", () => {
  const publish = (state: BackgroundJob.AnswerLog.State, position: string, at: number, sequence = 0) =>
    BackgroundJob.AnswerLog.transition(state, {
      _tag: "Publish",
      position,
      at,
      sequence,
      detected: position,
      notes: [],
    })

  const observe = (state: BackgroundJob.AnswerLog.State, after: number, floor?: number) =>
    BackgroundJob.AnswerLog.transition(state, {
      _tag: "Observe",
      after,
      ...(floor !== undefined ? { floor } : {}),
    })

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

  test("the delivery floor withholds a later sequence and releases an earlier one (CP-032 R-06)", () => {
    // Sequence 1 is parked at eligibility; 0 and 2 have filed.
    const first = publish(BackgroundJob.AnswerLog.empty, "m0", 100, 0)
    const second = publish(first.state, "m2", 200, 2)

    // The earlier sequence still delivers: a parked LATER sequence must not stall answers that
    // precede it, or one indefinitely parked run would withhold the whole log.
    const early = observe(second.state, 0, 1)
    expect(early._tag).toBe("answer")
    if (early._tag !== "answer") return
    expect(early.answer.detected).toBe("m0")

    // The later sequence is withheld while 1 remains unresolved.
    expect(observe(early.state, 1, 1)._tag).toBe("miss")

    // Clearing the announcement releases it.
    const released = observe(early.state, 1)
    expect(released._tag).toBe("answer")
    if (released._tag !== "answer") return
    expect(released.answer.detected).toBe("m2")
  })

  test("the floor is keyed on sequence, so an older controlling assistant is still withheld", () => {
    // THE REASON THE RESTORED FLOOR IS SEQUENCE-KEYED RATHER THAN CHRONOLOGY-KEYED.
    //
    // Return eligibility can select a controlling assistant OLDER than the run-final one it was
    // detected from: a degraded resolution falls through to the retained fallback. Sequence 1
    // therefore files at t=100 while sequence 0 — which has not filed at all — is still parked.
    // A chronology floor cannot express this, because the unresolved sequence has no filed key to
    // compare against. A sequence is fixed at admission, so it can.
    const filed = publish(BackgroundJob.AnswerLog.empty, "m_old", 100, 1)
    expect(observe(filed.state, 0, 0)._tag).toBe("miss")

    const released = observe(filed.state, 0)
    expect(released._tag).toBe("answer")
    if (released._tag !== "answer") return
    expect(released.answer.detected).toBe("m_old")
  })

  test("an absent floor delivers every retained entry", () => {
    const only = publish(BackgroundJob.AnswerLog.empty, "m1", 100, 7)
    const delivered = observe(only.state, 0)
    expect(delivered._tag).toBe("answer")
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

  it.live("issues canonical opaque invocation handles that retain original terminal truth across replacement", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const release = yield* Deferred.make<void>()
      const first = yield* jobs.startExact({
        admission,
        id: "job_handle_replacement",
        type: "test",
        run: Deferred.await(release).pipe(Effect.as(answered("a1", 0, "first"))),
      })
      if (!first.lifetime || !first.handle) return yield* Effect.die("sequence zero did not arm")

      const adopted = yield* jobs.startExact({
        admission,
        id: "job_handle_replacement",
        type: "test",
        run: Effect.die("adopted start must not fork"),
      })
      expect(adopted.lifetime?.token).toBe(first.lifetime.token)
      expect(adopted.handle).toBe(first.handle)

      const extension = yield* jobs.extendExact({
        admission,
        lifetime: first.lifetime,
        run: Effect.succeed(answered("a2", 0, "extension")),
      })
      expect(extension.extended).toBe(true)
      if (!extension.extended) return yield* Effect.die("extension was not accepted")
      expect(extension.handle).not.toBe(first.handle)

      // Runtime opacity: the object itself carries no coordinate or coercion surface.
      expect(typeof first.handle).toBe("object")
      expect(Object.isFrozen(first.handle)).toBe(true)
      expect(Object.getPrototypeOf(first.handle)).toBe(null)
      expect(Reflect.ownKeys(first.handle)).toEqual([])
      expect(first.info).not.toHaveProperty("handle")
      expect(first.info).not.toHaveProperty("lifetime")
      expect(new Map([[first.handle, "first"]]).get(first.handle)).toBe("first")
      expect(new WeakMap([[first.handle, "first"]]).get(first.handle)).toBe("first")

      if (false) {
        // @ts-expect-error a plain object cannot construct the private-symbol identity
        const forged: BackgroundJob.InvocationHandle = {}
        // @ts-expect-error no sequence coordinate crosses the opaque surface
        void first.handle.sequence
        // @ts-expect-error no Lifetime coordinate crosses the opaque surface
        void first.handle.lifetime
        // @ts-expect-error an object identity is not arithmetic
        void (first.handle + 1)
        // @ts-expect-error an object identity is not orderable
        void (first.handle < extension.handle)
        void forged
      }

      yield* Deferred.succeed(release, undefined)
      expect((yield* jobs.waitHandle({ handle: first.handle })).info).toMatchObject({
        status: "completed",
        output: "first",
      })
      const original = yield* jobs.observeHandle(first.handle)
      expect(original?.state).toBe("terminal")
      expect(original?.invocations).toEqual(new Set([first.handle, extension.handle]))

      const replacementRelease = yield* Deferred.make<void>()
      const replacement = yield* jobs.startExact({
        admission,
        id: "job_handle_replacement",
        type: "test",
        run: Deferred.await(replacementRelease).pipe(Effect.as(answered("a1", 0, "replacement"))),
      })
      if (!replacement.lifetime || !replacement.handle) return yield* Effect.die("replacement did not arm")
      expect(replacement.lifetime.token).not.toBe(first.lifetime.token)
      expect(replacement.handle).not.toBe(first.handle)
      expect((yield* jobs.waitExact({ lifetime: first.lifetime })).info).toBeUndefined()
      expect((yield* jobs.waitHandle({ handle: first.handle })).info?.output).toBe("first")
      expect((yield* jobs.observeHandle(first.handle))?.invocations).toEqual(new Set([first.handle, extension.handle]))
      expect((yield* jobs.observeHandle(replacement.handle))?.invocations).toEqual(new Set([replacement.handle]))

      const forged = Object.freeze(Object.create(null)) as BackgroundJob.InvocationHandle
      expect(yield* jobs.observeHandle(forged)).toBeUndefined()

      yield* Deferred.succeed(replacementRelease, undefined)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("rejects an authentic invocation handle from another registry", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        const owner = yield* BackgroundJob.make
        const foreign = yield* BackgroundJob.make
        const started = yield* owner.startExact({
          admission,
          id: "job_foreign_handle",
          type: "test",
          run: Deferred.await(release).pipe(Effect.as(answered("a1", 0, "done"))),
        })
        if (!started.handle) return yield* Effect.die("sequence zero did not arm")

        expect(yield* foreign.observeHandle(started.handle)).toBeUndefined()

        yield* Deferred.succeed(release, undefined)
      }),
    ),
  )

  it.live("publishes one exact terminal winner before releasing any waiter or replacement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<BackgroundJob.TerminalInput>()
        const releaseTerminal = yield* Deferred.make<void>()
        const releaseRun = yield* Deferred.make<void>()
        const waited = yield* Deferred.make<BackgroundJob.Info>()
        const lateID = yield* Deferred.make<BackgroundJob.WaitResult>()
        const lateExact = yield* Deferred.make<BackgroundJob.WaitResult>()
        const lateHandle = yield* Deferred.make<BackgroundJob.WaitResult>()
        const replaced = yield* Deferred.make<BackgroundJob.StartExactResult>()
        const calls: BackgroundJob.TerminalInput[] = []
        const binder: BackgroundJob.Binder = {
          bind: (input) =>
            BackgroundJob.makePermit(input.lifetime, input.sequence).pipe(
              Effect.map((made) => ({ kind: "arm_allowed" as const, permit: made.permit })),
            ),
          terminal: (input) =>
            Effect.sync(() => calls.push(input)).pipe(
              Effect.andThen(Deferred.succeed(entered, input)),
              Effect.andThen(Deferred.await(releaseTerminal)),
            ),
        }
        const jobs = yield* BackgroundJob.makeWith(binder)
        const started = yield* jobs.startExact({
          admission,
          id: "job_terminal_order",
          type: "test",
          run: Deferred.await(releaseRun).pipe(Effect.as(answered("a1", 0, "base"))),
        })
        if (!started.lifetime || !started.handle) return yield* Effect.die("sequence zero did not arm")

        const extended = yield* jobs.extendExact({
          admission,
          lifetime: started.lifetime,
          run: Effect.succeed(answered("a2", 0, "extension")),
        })
        expect(extended.extended).toBe(true)
        yield* jobs.waitExact({ lifetime: started.lifetime }).pipe(
          Effect.flatMap((result) =>
            result.info ? Deferred.succeed(waited, result.info) : Effect.die("lifetime disappeared"),
          ),
          Effect.forkScoped,
        )

        yield* Deferred.succeed(releaseRun, undefined)
        const terminal = yield* Deferred.await(entered)
        expect(terminal.lifetime.id).toBe(started.lifetime.id)
        expect(terminal.lifetime.token).toBe(started.lifetime.token)
        expect(terminal.winner).toBe("completed")
        expect(calls).toHaveLength(1)
        expect(yield* Deferred.isDone(waited)).toBe(false)

        yield* jobs.wait({ id: started.lifetime.id }).pipe(
          Effect.flatMap((result) => Deferred.succeed(lateID, result)),
          Effect.forkScoped,
        )
        yield* jobs.waitExact({ lifetime: started.lifetime }).pipe(
          Effect.flatMap((result) => Deferred.succeed(lateExact, result)),
          Effect.forkScoped,
        )
        yield* jobs.waitHandle({ handle: started.handle }).pipe(
          Effect.flatMap((result) => Deferred.succeed(lateHandle, result)),
          Effect.forkScoped,
        )
        yield* jobs
          .startExact({
            admission,
            id: started.lifetime.id,
            type: "test",
            run: Effect.never,
          })
          .pipe(
            Effect.flatMap((result) => Deferred.succeed(replaced, result)),
            Effect.forkScoped,
          )
        yield* Effect.yieldNow

        expect(yield* Deferred.isDone(lateID)).toBe(false)
        expect(yield* Deferred.isDone(lateExact)).toBe(false)
        expect(yield* Deferred.isDone(lateHandle)).toBe(false)
        expect(yield* Deferred.isDone(replaced)).toBe(false)

        yield* Deferred.succeed(releaseTerminal, undefined)
        expect(yield* Deferred.await(waited)).toMatchObject({ status: "completed", output: "base" })
        expect((yield* Deferred.await(lateID)).info).toMatchObject({ status: "completed", output: "base" })
        expect((yield* Deferred.await(lateExact)).info).toMatchObject({ status: "completed", output: "base" })
        expect((yield* Deferred.await(lateHandle)).info).toMatchObject({ status: "completed", output: "base" })
        const replacement = yield* Deferred.await(replaced)
        expect(replacement.info.status).toBe("running")
        if (!replacement.lifetime) return yield* Effect.die("replacement did not arm")
        expect(replacement.lifetime.token).not.toBe(started.lifetime.token)
        yield* jobs.cancelExact(replacement.lifetime)
        expect(calls.filter((item) => item.lifetime.token === started.lifetime?.token)).toHaveLength(1)
      }),
    ),
  )

  it.live("publishes the cancelled winner when an unarmed lifetime is abandoned", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: BackgroundJob.TerminalInput[] = []
        const binder: BackgroundJob.Binder = {
          bind: () => Effect.succeed({ kind: "rejected" as const, reason: "test" }),
          terminal: (input) => Effect.sync(() => void calls.push(input)),
        }
        const jobs = yield* BackgroundJob.makeWith(binder)
        const result = yield* jobs.startExact({
          admission,
          id: "job_terminal_abandon",
          type: "test",
          run: Effect.die("an abandoned lifetime must not run"),
        })

        expect(result.info.status).toBe("cancelled")
        expect(result.lifetime).toBeUndefined()
        expect(calls).toHaveLength(1)
        expect(calls[0]?.lifetime.id).toBe("job_terminal_abandon")
        expect(calls[0]?.winner).toBe("cancelled")
      }),
    ),
  )

  it.live("never routes a late filing to a replaced lifetime under the same public id (T-42, I-6)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      // The old lifetime terminalizes via a SIBLING FAILURE while its owner run is held —
      // the owner is not interrupted by cancelExact, so releasing it produces a late settle
      // carrying the old construction token into a registry that maps the id to a LIVE
      // replacement. One race is irreducible through the public API: the failure terminal
      // closes the old job scope in a forked fiber, and that interrupt can beat the released
      // run to its settle. THE REPLACEMENT'S RUN IS HELD so BOTH arms discriminate an
      // id-routing mutant (re-audit M4): a misrouted SUCCESS settle files "old answer" into
      // the live replacement's log at index 0 (at 1 < at 2); a misrouted INTERRUPT settle
      // terminalizes the live replacement as cancelled before its own answer lands. Correct
      // code rejects both on the token guard, and the replacement completes cleanly with
      // exactly its own answer. No iteration is needed — neither arm can hide the mutant.
      //
      // Third-audit note: no public signal marks the old settle CROSSING the guard, so the
      // bounded pause below cannot prove it crossed before the oracle reads — this test
      // establishes the WIRING under both arms. The guard's decision itself is pinned
      // deterministically, without scheduler timing, by the `settleAdmissibility` cells
      // above (pure extraction, D-07 precedent).
      const id = "job_t42_scope"
      const holdOld = yield* Deferred.make<void>()
      const holdNew = yield* Deferred.make<void>()
      const old = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        run: Deferred.await(holdOld).pipe(Effect.as(answered("p_old", 1, "old answer")), Effect.uninterruptible),
      })
      if (!old.lifetime || !old.handle) return yield* Effect.die("old lifetime did not arm")
      // Sibling failure terminalizes the old lifetime without touching the held owner.
      expect(yield* jobs.extend({ admission, id, run: Effect.fail("sibling boom") })).toBe(true)
      const oldTerminal = yield* jobs.waitExact({ lifetime: old.lifetime })
      expect(oldTerminal.info?.status).toBe("error")

      const replacement = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        // Born background so answers publish to the LOG the moment they file.
        metadata: { background: true },
        run: Deferred.await(holdNew).pipe(Effect.as(answered("p_new", 2, "new answer"))),
      })
      if (!replacement.lifetime || !replacement.handle) return yield* Effect.die("replacement did not arm")
      expect(replacement.lifetime.token).not.toBe(old.lifetime.token)

      // Release the old owner INTO the live replacement window. Its wrapper settle —
      // success or interrupt arm — carries the old token; the token guard must reject it
      // without touching the replacement. The bounded pause lets the old fiber's few
      // remaining wrapper steps land before the replacement proceeds.
      yield* Deferred.succeed(holdOld, undefined)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Effect.sleep("20 millis")

      // The replacement is still running and unpolluted (a misrouted interrupt settle
      // would have cancelled it; a misrouted success settle would publish at index 0).
      expect((yield* jobs.wait({ id, timeout: 0 })).info?.status).toBe("running")
      const parked = yield* Effect.race(
        jobs.waitAnswer({ handle: replacement.handle, after: 0 }).pipe(Effect.as("polluted")),
        Effect.sleep("50 millis").pipe(Effect.as("clean")),
      )
      expect(parked).toBe("clean")

      yield* Deferred.succeed(holdNew, undefined)
      const delivered = yield* jobs.waitAnswer({ handle: replacement.handle, after: 0 })
      expect(delivered.answer?.detected).toBe("new answer")
      expect(delivered.answer?.index).toBe(0)
      const terminal = yield* jobs.waitAnswer({ handle: replacement.handle, after: 1 })
      expect(terminal.info?.status).toBe("completed")
      // The old ledger never filed: its handle reports the error terminal, no answer,
      // and no output (retention keeps error terminals payload-free).
      const oldRead = yield* jobs.waitAnswer({ handle: old.handle, after: 0 })
      expect(oldRead.answer).toBeUndefined()
      expect(oldRead.info?.status).toBe("error")
      expect(Object.hasOwn(oldRead.info ?? {}, "output")).toBe(false)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("decides settle admissibility purely on occupant, token, and status (T-42 guard cells)", () =>
    Effect.sync(() => {
      // Third-audit T-42 residual: the integration construction proves both race arms
      // corrupt a live replacement under a guard-removal mutant, but cannot signal WHEN
      // the old settle crosses the guard. These cells pin the guard's decision itself —
      // deterministically, without scheduler timing (the D-07 extraction precedent).
      const mine = { token: {} }
      const other = { token: {} }
      // The lifetime that constructed the wrapper, still running: admitted.
      expect(BackgroundJob.settleAdmissibility({ token: mine.token, status: "running" }, mine.token)).toBe("admit")
      // A same-id REPLACEMENT holds a different construction token: the late settle is
      // foreign and must be dropped without touching the occupant (I-6 — T-42's arm).
      expect(BackgroundJob.settleAdmissibility({ token: other.token, status: "running" }, mine.token)).toBe(
        "foreign_token",
      )
      // §2.6's terminalization-race boundary: same token, no longer running.
      for (const status of ["completed", "error", "cancelled"] as const) {
        expect(BackgroundJob.settleAdmissibility({ token: mine.token, status }, mine.token)).toBe("not_running")
      }
      // Precedence: a foreign token on a terminal occupant is foreign first — it may not
      // even clear announcements on the occupant's ledger (that net is the fork ensuring).
      expect(BackgroundJob.settleAdmissibility({ token: other.token, status: "completed" }, mine.token)).toBe(
        "foreign_token",
      )
    }),
  )

  it.live("answers an exact-handle mode read for the accepted lifetime across same-id replacement (re-audit M3)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      // The supplemental receipt is keyed by the ACCEPTED lifetime's delivery mode, read
      // through its exact invocation handle at receipt time. The public id is reusable:
      // after the accepted lifetime terminalizes, a same-id replacement can install with
      // the OPPOSITE mode. The exact-handle read must keep answering for the accepted
      // lifetime (bindings survive replacement) while an id read describes the
      // replacement — the deterministic form of the receipt ABA race (task.ts
      // `supplementReceipt` reads `waitHandle`, never `get(id)`).
      const id = "job_m3_receipt_aba"
      const first = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        run: Effect.succeed(answered("p_first", 1, "first")),
      })
      if (!first.lifetime || !first.handle) return yield* Effect.die("first did not arm")
      expect((yield* jobs.wait({ id })).info?.status).toBe("completed")

      const second = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        metadata: { background: true },
        run: Effect.succeed(answered("p_second", 2, "second")),
      })
      if (!second.lifetime || !second.handle) return yield* Effect.die("replacement did not arm")

      // The exact-handle read answers for the ACCEPTED (foreground) lifetime…
      const viaHandle = yield* jobs.waitHandle({ handle: first.handle, timeout: 0 })
      expect(viaHandle.info?.metadata?.background).toBeUndefined()
      expect(viaHandle.info?.status).toBe("completed")
      // …while the reusable public id now describes the background replacement. A receipt
      // built from this read would promise async delivery the accepted sequence never had.
      const viaId = yield* jobs.get(id)
      expect(viaId?.metadata?.background).toBe(true)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("buffers foreground filings and publishes nothing before disposition (T-05a)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const holdOwner = yield* Deferred.make<void>()
      const holdExt = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_t05a_buffer",
        type: "test",
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_1", 0, "first"))),
      })
      if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")
      const extended = yield* jobs.extendWithHandle({
        id: "job_t05a_buffer",
        admission,
        run: Deferred.await(holdExt).pipe(Effect.as(undefined)),
      })
      expect(extended).toBeDefined()
      // The registered supplement holds the lifetime open (R-22); the owner's filing below
      // therefore lands while pending > 0 and buffers.
      yield* Deferred.succeed(holdOwner, undefined)
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      // The filed position is buffered, not published: an observation parks. The sleep is a
      // bounded NEGATIVE check (asserting non-delivery); the positive oracle below is the
      // terminal Info, per OBL-3.
      const parked = yield* Effect.race(
        jobs.waitAnswer({ handle: started.handle, after: 0 }).pipe(Effect.as("answered")),
        Effect.sleep("100 millis").pipe(Effect.as("parked")),
      )
      expect(parked).toBe("parked")
      expect((yield* jobs.wait({ id: "job_t05a_buffer", timeout: 0 })).info?.status).toBe("running")

      yield* Deferred.succeed(holdExt, undefined)
      const waited = yield* jobs.wait({ id: "job_t05a_buffer" })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("first")
      // Foreground never published: post-terminal observation finds the terminal, not a log entry.
      const post = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
      expect(post.answer).toBeUndefined()
      expect(post.info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live(
    "delivers the first filed answer inline and notes the retained second, in either settle order (T-05i, T-05h)",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const outcome = (id: string, supplementFirst: boolean) =>
          Effect.gen(function* () {
            const holdOwner = yield* Deferred.make<void>()
            const holdExt = yield* Deferred.make<void>()
            const started = yield* jobs.startExact({
              admission,
              id,
              type: "test",
              outstanding: { observer: "OBS-NOTE", inline: "INL-NOTE" },
              run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 0, "first"))),
            })
            if (!started.lifetime) return yield* Effect.die("did not arm")
            const extended = yield* jobs.extendWithHandle({
              id,
              admission,
              run: Deferred.await(holdExt).pipe(Effect.as(answered("p_b", 0, "second"))),
            })
            expect(extended).toBeDefined()

            const release = supplementFirst ? [holdExt, holdOwner] : [holdOwner, holdExt]
            yield* Deferred.succeed(release[0]!, undefined)
            yield* Effect.yieldNow
            yield* Effect.yieldNow
            yield* Deferred.succeed(release[1]!, undefined)

            const waited = yield* jobs.wait({ id })
            return { status: waited.info?.status, output: waited.info?.output, notes: waited.info?.notes }
          })

        const ownerFirst = yield* outcome("job_t05h_owner_first", false)
        const supplementFirst = yield* outcome("job_t05h_supplement_first", true)

        // T-05i: the first filed answer (position order) rides the success terminal; the retained
        // second adds the inline outstanding notice. T-05h: byte-identical across settle orders.
        expect(ownerFirst.status).toBe("completed")
        expect(ownerFirst.output).toBe("first")
        expect(ownerFirst.notes).toEqual(["INL-NOTE"])
        expect(JSON.stringify(supplementFirst)).toBe(JSON.stringify(ownerFirst))
      }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("attaches the observer outstanding notice while supplemental work is registered (T-28)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const holdOwner = yield* Deferred.make<void>()
      const holdExt = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_t28_notice",
        type: "test",
        metadata: { background: true },
        outstanding: { observer: "OBS-NOTE", inline: "INL-NOTE" },
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 0, "first"))),
      })
      if (!started.handle) return yield* Effect.die("did not arm")
      const extended = yield* jobs.extendWithHandle({
        id: "job_t28_notice",
        admission,
        run: Deferred.await(holdExt).pipe(Effect.as(answered("p_b", 0, "second"))),
      })
      expect(extended).toBeDefined()
      // Release the owner only after the supplement is registered: its answer completes with
      // work outstanding, which is the notice's trigger.
      yield* Deferred.succeed(holdOwner, undefined)

      // The first answer completed while the supplement was still registered: the observer
      // outstanding notice rides that answer (temporally stable - composed at completion).
      const first = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
      expect(first.answer?.detected).toBe("first")
      expect(first.answer?.notes).toEqual(["OBS-NOTE"])

      yield* Deferred.succeed(holdExt, undefined)
      const second = yield* jobs.waitAnswer({ handle: started.handle, after: 1 })
      expect(second.answer?.detected).toBe("second")
      expect(second.answer?.notes).toEqual([])
      expect((yield* jobs.wait({ id: "job_t28_notice" })).info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("retains undelivered answers past terminal and releases only at observation (T-29, T-10d)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const holdOwner = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_t29_retention",
        type: "test",
        metadata: { background: true },
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 0, "A"))),
      })
      if (!started.handle) return yield* Effect.die("did not arm")
      const extended = yield* jobs.extendWithHandle({
        id: "job_t29_retention",
        admission,
        run: Effect.succeed(answered("p_b", 0, "B")),
      })
      expect(extended).toBeDefined()
      yield* Deferred.succeed(holdOwner, undefined)
      expect((yield* jobs.wait({ id: "job_t29_retention" })).info?.status).toBe("completed")

      // Both answers were published but never observed: they are retained past terminal.
      const first = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
      expect(first.answer?.detected).toBe("A")
      // The locked observation returning N advanced baseIndex to N+1 - the only release
      // (§4.10). A sub-base cursor clamps to baseIndex (T-10d) and reads the NEXT answer.
      const clamped = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
      expect(clamped.answer?.detected).toBe("B")
      // Past the log on a terminal lifetime: the terminal Info, not an answer.
      const done = yield* jobs.waitAnswer({ handle: started.handle, after: 2 })
      expect(done.answer).toBeUndefined()
      expect(done.info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("drains the promotion handoff exactly once and completes promoted at the transition (T-10b, R-18, I-4)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const holdOwner = yield* Deferred.make<void>()
      const drained = { count: 0 }
      const started = yield* jobs.startExact({
        admission,
        id: "job_t10b_handoff",
        type: "test",
        onPromote: Effect.sync(() => {
          drained.count += 1
        }),
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 0, "promoted answer"))),
      })
      if (!started.lifetime) return yield* Effect.die("did not arm")

      const receipt = yield* jobs.promote("job_t10b_handoff")
      expect(receipt?.metadata?.background).toBe(true)
      // promoted completes at the transition; the callback forks into the registry scope.
      const promoted = yield* jobs.waitForPromotionExact(started.lifetime)
      expect(promoted?.metadata?.background).toBe(true)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      expect(drained.count).toBe(1)

      yield* Deferred.succeed(holdOwner, undefined)
      const waited = yield* jobs.wait({ id: "job_t10b_handoff" })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.metadata?.background).toBe(true)
      // Exactly once: the racing terminal drained nothing further (R-18).
      expect(drained.count).toBe(1)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("completes promoted at registration for a born-background lifetime (T-35b, R-19)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const hold = yield* Deferred.make<void>()
      const born = yield* jobs.startExact({
        admission,
        id: "job_t35b_born",
        type: "test",
        metadata: { background: true },
        run: Deferred.await(hold).pipe(Effect.as(answered("p_a", 0, "done"))),
      })
      if (!born.lifetime) return yield* Effect.die("did not arm")
      // Born background is a mode, not a promotion: no transition occurred, yet promoted is
      // complete from registration, so a promotion wait resolves without any promote call.
      const promoted = yield* jobs.waitForPromotionExact(born.lifetime)
      expect(promoted?.metadata?.background).toBe(true)

      const holdForeground = yield* Deferred.make<void>()
      const foreground = yield* jobs.startExact({
        admission,
        id: "job_t35b_foreground",
        type: "test",
        run: Deferred.await(holdForeground).pipe(Effect.as(answered("p_b", 0, "sync"))),
      })
      if (!foreground.lifetime) return yield* Effect.die("foreground did not arm")
      // A running, never-promoted foreground lifetime parks a promotion wait (bounded
      // negative check; the positive oracle is the done resolution below, per OBL-3).
      const parked = yield* Effect.race(
        jobs.waitForPromotionExact(foreground.lifetime).pipe(Effect.as("promoted")),
        Effect.sleep("100 millis").pipe(Effect.as("parked")),
      )
      expect(parked).toBe("parked")
      yield* Deferred.succeed(holdForeground, undefined)
      // It resolves through done (R-19); a terminal promotion wait answers undefined.
      expect((yield* jobs.wait({ id: "job_t35b_foreground" })).info?.status).toBe("completed")
      expect(yield* jobs.waitForPromotionExact(foreground.lifetime)).toBeUndefined()

      yield* Deferred.succeed(hold, undefined)
      expect((yield* jobs.wait({ id: "job_t35b_born" })).info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("preserves the promotion receipt when promotion and terminal both complete (T-06r, I-2)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      // Both-complete construction: promotion commits FIRST, the terminal follows, and only
      // then does anyone look. I-2's whole basis is that terminal builders spread the
      // promoted metadata, so a late reader — task.ts checks metadata.background before
      // status — still routes to the promotion receipt.
      const holdOwner = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_t06r_race",
        type: "test",
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 1, "done"))),
      })
      if (!started.lifetime) return yield* Effect.die("did not arm")
      const receipt = yield* jobs.promote("job_t06r_race")
      expect(receipt?.metadata?.background).toBe(true)
      yield* Deferred.succeed(holdOwner, undefined)
      const terminal = yield* jobs.wait({ id: "job_t06r_race" })
      expect(terminal.info?.status).toBe("completed")
      // Promotion survives terminalization: both read paths agree after both complete.
      expect(terminal.info?.metadata?.background).toBe(true)
      expect((yield* jobs.waitExact({ lifetime: started.lifetime })).info?.metadata?.background).toBe(true)

      // Negative control: a never-promoted terminal carries no promotion mark.
      const plain = yield* jobs.startExact({
        admission,
        id: "job_t06r_plain",
        type: "test",
        run: Effect.succeed(answered("p_b", 2, "plain")),
      })
      if (!plain.lifetime) return yield* Effect.die("plain did not arm")
      const plainTerminal = yield* jobs.wait({ id: "job_t06r_plain" })
      expect(plainTerminal.info?.status).toBe("completed")
      expect(plainTerminal.info?.metadata?.background ?? false).toBe(false)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("finishes a committed promotion's callback although its initiator is interrupted (T-10c, R-17)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const callbackStarted = yield* Deferred.make<void>()
      const callbackRelease = yield* Deferred.make<void>()
      const callbackFinished = yield* Deferred.make<void>()
      const holdOwner = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_t10c_interrupt",
        type: "test",
        onPromote: Effect.gen(function* () {
          yield* Deferred.succeed(callbackStarted, undefined)
          yield* Deferred.await(callbackRelease)
          yield* Deferred.succeed(callbackFinished, undefined)
        }),
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 1, "done"))),
      })
      if (!started.lifetime) return yield* Effect.die("did not arm")

      // Promote from a fiber we then interrupt mid-callback. The commit-to-notification
      // window is uninterruptible and the callback forks into the REGISTRY's scope, so the
      // initiator's death must not stop either the promoted completion or the callback.
      const promoter = yield* jobs.promote("job_t10c_interrupt").pipe(Effect.forkChild)
      yield* Deferred.await(callbackStarted)
      yield* Fiber.interrupt(promoter)
      const promoted = yield* jobs.waitForPromotionExact(started.lifetime)
      expect(promoted?.metadata?.background).toBe(true)
      yield* Deferred.succeed(callbackRelease, undefined)
      yield* Deferred.await(callbackFinished)

      yield* Deferred.succeed(holdOwner, undefined)
      expect((yield* jobs.wait({ id: "job_t10c_interrupt" })).info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("carries the observer outstanding notice through a promotion publish (S1, §4.5)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      // The first answer completes while a supplement is registered (outstandingAtCompletion
      // captured at its filing), BUFFERS — the lifetime is foreground — and then publishes
      // at a ctrl+b promotion. The notice must ride the published answer: the fact is about
      // the answer's completion instant, not the publish instant.
      //
      // Re-audit M4 note on the missing "buffered before promote" latch: no public surface
      // exposes per-sequence settlement (Observation carries state/accepted/status only),
      // so that precondition cannot be signaled without new API — and if promotion wins
      // the race here, the owner's filing lands on the observerAll path whose live
      // pending>0 check attaches the SAME notice, so both assertions below hold on either
      // arm. This test pins the ORDINARY path pair (notice-on-first, CLEAN-on-second).
      //
      // There is no longer a companion DISCRIMINATOR test, and that is a deliberate record
      // rather than an omission. The third audit had falsified the claim that a live
      // `pending > 0` check and the capture-time flag are extensionally equivalent, using
      // the CP §12.2.1 `unreserve` strand as its one counterexample: that strand reached
      // pending 0 while RUNNING with a flagged answer still buffered. §12.2.1 is now fixed
      // — a refused extension dispositions — so a RUNNING lifetime always has pending > 0,
      // and the two agree on every reachable state. The capture-time encoding is kept
      // because it states a past-instant fact faithfully, not because any test can still
      // tell it apart from the live check.
      const holdOwner = yield* Deferred.make<void>()
      const holdExt = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_s1_promo_notice",
        type: "test",
        outstanding: { observer: "OBS-NOTE", inline: "INL-NOTE" },
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 1, "first"))),
      })
      if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")
      const extended = yield* jobs.extendWithHandle({
        id: "job_s1_promo_notice",
        admission,
        run: Deferred.await(holdExt).pipe(Effect.as(answered("p_b", 2, "second"))),
      })
      expect(extended).toBeDefined()
      // Owner completes with work registered and buffers (foreground): deterministic
      // filing evidence comes from the published answer itself after promotion.
      yield* Deferred.succeed(holdOwner, undefined)
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      const receipt = yield* jobs.promote("job_s1_promo_notice")
      expect(receipt?.metadata?.background).toBe(true)
      const first = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
      expect(first.answer?.detected).toBe("first")
      expect(first.answer?.notes).toEqual(["OBS-NOTE"])

      // The supplement's own answer completed with nothing outstanding: no notice.
      yield* Deferred.succeed(holdExt, undefined)
      const second = yield* jobs.waitAnswer({ handle: started.handle, after: 1 })
      expect(second.answer?.detected).toBe("second")
      expect(second.answer?.notes).toEqual([])
      expect((yield* jobs.wait({ id: "job_s1_promo_notice" })).info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("dispositions when a refused extension returns pending to zero (CP §12.2.1 unreserve strand)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // THE STRAND. `reserve` raises `pending` for a supplement that then LOSES admission.
        // The owner sequence has already succeeded, so its settle saw `pending > 0` and
        // correctly kept the lifetime running. When the refusal returns `pending` to zero
        // there is nothing left running to call `settle` again — so without a disposition on
        // this path the lifetime sits `running` with `pending: 0` forever, and two things
        // break: a blocked SYNCHRONOUS caller never receives its answer (`done` is resolved
        // only at disposition), and no terminal ever reaches the waiter that releases a child
        // Task session's attachment scope, leaving that child permanently unresumable.
        const holdOwner = yield* Deferred.make<void>()
        const extBindEntered = yield* Deferred.make<void>()
        const releaseExtBind = yield* Deferred.make<void>()
        const jobs = yield* BackgroundJob.makeWith(refusingBinder({ entered: extBindEntered, release: releaseExtBind }))
        const started = yield* jobs.startExact({
          admission,
          id: "job_unreserve_strand",
          type: "test",
          run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 1, "owner answer"))),
        })
        if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")

        // A blocked SYNCHRONOUS caller — the shape §1.4 admits for a sync-started task.
        const blocked = yield* jobs.wait({ id: "job_unreserve_strand" }).pipe(Effect.forkScoped)

        // The supplement RESERVES (pending 2) and parks inside bind.
        const extension = yield* jobs
          .extendWithHandle({ id: "job_unreserve_strand", admission, run: Effect.succeed(undefined) })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(extBindEntered)

        // The owner settles successfully inside that window: pending 2 → 1, answer buffered,
        // correctly no disposition (a supplement is still registered).
        yield* Deferred.succeed(holdOwner, undefined)
        yield* Effect.yieldNow
        yield* Effect.yieldNow

        // The parked bind now REFUSES: pending 1 → 0 with nothing left running.
        yield* Deferred.succeed(releaseExtBind, undefined)
        expect(yield* Fiber.join(extension)).toBeUndefined()

        // The lifetime MUST dispose. `completed`, not `error`/`cancelled`: the FOLLOW-UP was
        // refused — and its own caller learns that from its own Task result — while the
        // sub-agent's own work demonstrably succeeded.
        // Both observations are gathered BEFORE any assertion, so one failing run reports
        // both consequences rather than stopping at the first.
        const settled = yield* jobs.wait({ id: "job_unreserve_strand", timeout: 1000 })
        // Bounded-negative: before the fix this fiber parks forever, because `done` is
        // resolved only at disposition.
        const delivered = yield* Effect.raceFirst(
          Fiber.join(blocked).pipe(Effect.as("released" as const)),
          Effect.sleep("500 millis").pipe(Effect.as("hung" as const)),
        )

        // One combined assertion so a failure reports every consequence at once: the missing
        // disposition, the lost inline answer (R-08's slot), and the hung synchronous caller.
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

  it.live("releases the lifetime waiter when a refused extension ends a background job (CP §12.2.1)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The consequence that motivated the fix. A child Task session's attachment scope is
        // released by a fiber parked on `waitHandle` — that is, on the job's TERMINAL. While a
        // refused extension could leave the lifetime running at `pending: 0`, the terminal
        // never arrived, the child's scope was held indefinitely, and every later resume fell
        // through to the replacement-start path and died on the exclusive open. The strand
        // could therefore permanently recreate the very bug the attachment fix had closed.
        const holdOwner = yield* Deferred.make<void>()
        const extBindEntered = yield* Deferred.make<void>()
        const releaseExtBind = yield* Deferred.make<void>()
        const jobs = yield* BackgroundJob.makeWith(refusingBinder({ entered: extBindEntered, release: releaseExtBind }))
        const started = yield* jobs.startExact({
          admission,
          id: "job_unreserve_observer",
          type: "test",
          metadata: { background: true },
          run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 1, "owner answer"))),
        })
        if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")

        // Exactly the waiter the Task layer parks on to release the child's scope.
        const release = yield* jobs.waitHandle({ handle: started.handle }).pipe(Effect.forkScoped)

        const extension = yield* jobs
          .extendWithHandle({ id: "job_unreserve_observer", admission, run: Effect.succeed(undefined) })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(extBindEntered)

        yield* Deferred.succeed(holdOwner, undefined)
        yield* Effect.yieldNow
        yield* Effect.yieldNow

        yield* Deferred.succeed(releaseExtBind, undefined)
        expect(yield* Fiber.join(extension)).toBeUndefined()

        // Bounded-negative: before the fix this waiter is held forever.
        const released = yield* Effect.raceFirst(
          Fiber.join(release).pipe(Effect.as("released" as const)),
          Effect.sleep("500 millis").pipe(Effect.as("held" as const)),
        )
        expect(released).toBe("released")

        // And the work that DID complete is still delivered: ending the lifetime is not the
        // same as discarding the answer the sub-agent already produced (I-1, §4.10).
        const first = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
        expect(first.answer?.detected).toBe("owner answer")
      }),
    ),
  )

  // CP-032 T-032-4. Every nonaccepted extension exit reached one shared finalizer that settled
  // `Exit.succeed(undefined)`, so the cause that distinguishes an ordinary refusal from a
  // cancellation was erased before `settle` could read it. `settle` already maps cause correctly
  // (success -> completed, interrupts-only -> cancelled, otherwise error), so these arms assert the
  // cause SURVIVES the finalizer rather than asserting any new mapping.
  //
  // Each arm puts the extension in the same shape: owner already succeeded, extension is the final
  // pending reservation. That is the interleaving in which the erased cause let core publish
  // `completed` while the admission authority held `cancelled`.
  const nonacceptedExtension = (input: {
    readonly id: string
    readonly decide: (request: BackgroundJob.BindRequest) => Effect.Effect<BackgroundJob.BindDecision>
    readonly interruptInsteadOfReleasing?: boolean
  }) =>
    Effect.gen(function* () {
      const holdOwner = yield* Deferred.make<void>()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const winners: Array<Exclude<BackgroundJob.Status, "running">> = []
      const jobs = yield* BackgroundJob.makeWith({
        bind: (request) =>
          request.sequence === 0
            ? BackgroundJob.makePermit(request.lifetime, request.sequence).pipe(
                Effect.map((made) => ({ kind: "arm_allowed" as const, permit: made.permit })),
              )
            : Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(input.decide(request)),
              ),
        // Captures what core tells the admission authority, so an arm can prove core cannot
        // publish a winner contradicting the authority's own record.
        terminal: (published) => Effect.sync(() => void winners.push(published.winner)),
      })
      const started = yield* jobs.startExact({
        admission,
        id: input.id,
        type: "test",
        // observerAll, so the owner's filing enters the answer LOG rather than the foreground
        // buffer. That is what makes retention observable here: a `completed` disposition
        // consumes the single buffered answer into `Info.output` and slices it away (settle's
        // inline-slot release), so a foreground shape would report `retained: undefined` in
        // every arm and assert nothing. The foreground inline slot is already locked by the
        // CP §12.2.1 test above.
        metadata: { background: true },
        run: Deferred.await(holdOwner).pipe(Effect.as(answered("p_a", 1, "owner answer"))),
      })
      if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")

      const extension = yield* jobs
        .extendWithHandle({ id: input.id, admission, run: Effect.succeed(undefined) })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(entered)

      // The owner settles successfully inside the window: pending 2 -> 1, answer buffered, no
      // disposition yet because a supplement is still registered.
      yield* Deferred.succeed(holdOwner, undefined)
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      if (input.interruptInsteadOfReleasing) yield* Fiber.interrupt(extension)
      else {
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.await(extension)
      }

      const settled = yield* jobs.wait({ id: input.id, timeout: 1000 })
      const retained = yield* jobs.waitAnswer({ handle: started.handle, after: 0 })
      return {
        status: settled.info?.status,
        output: settled.info?.output,
        retained: retained.answer?.detected,
        winners,
      }
    })

  it.live("cancels the lifetime when the last extension is refused because cancellation owns it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* nonacceptedExtension({
          id: "job_b2_cancellation_owned",
          decide: () => Effect.succeed({ kind: "cancellation_owned" as const }),
        })
        // `cancellation_owned` means the admission authority already holds this lifetime as
        // cancelled. Publishing `completed` here is the exact contradiction B-2 describes.
        // Cancellation carries no inline output, but I-1 retains the owner's filed answer.
        expect(seen).toEqual({
          status: "cancelled",
          output: undefined,
          retained: "owner answer",
          winners: ["cancelled"],
        })
      }),
    ),
  )

  it.live("cancels the lifetime when the last extension's issued permit was revoked", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* nonacceptedExtension({
          id: "job_b2_revoked_permit",
          // Revocation wins the permit cell before the registry claims it, so `claim` returns
          // false. That is a cancellation-driven loss, not an ordinary refusal.
          decide: (request) =>
            BackgroundJob.makePermit(request.lifetime, request.sequence).pipe(
              Effect.flatMap((made) =>
                made.revoke.pipe(Effect.as({ kind: "arm_allowed" as const, permit: made.permit })),
              ),
            ),
        })
        expect(seen).toEqual({
          status: "cancelled",
          output: undefined,
          retained: "owner answer",
          winners: ["cancelled"],
        })
      }),
    ),
  )

  it.live("cancels the lifetime when the last extension is interrupted while binding", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* nonacceptedExtension({
          id: "job_b2_interrupted",
          decide: () => Effect.succeed({ kind: "rejected" as const, reason: "never reached" }),
          interruptInsteadOfReleasing: true,
        })
        expect(seen).toEqual({
          status: "cancelled",
          output: undefined,
          retained: "owner answer",
          winners: ["cancelled"],
        })
      }),
    ),
  )

  it.live("keeps the lifetime in error when the last extension's binder defects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* nonacceptedExtension({
          id: "job_b2_binder_defect",
          decide: () => Effect.die(new Error("binder exploded")),
        })
        // A defect is neither a refusal nor a cancellation: laundering it into success hid a
        // real fault, and calling it `cancelled` would claim an authority nobody exercised.
        expect(seen.status).toBe("error")
        expect(seen.winners).toEqual(["error"])
        expect(seen.retained).toBe("owner answer")
      }),
    ),
  )

  it.live("still completes the lifetime when the last extension is refused ordinarily (B-2 control)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* nonacceptedExtension({
          id: "job_b2_ordinary_control",
          decide: () => Effect.succeed({ kind: "rejected" as const, reason: "refused after reserving" }),
        })
        // The confusable negative, and the reason B-2 is a cause-preservation fix rather than a
        // remapping: an ordinary refusal is NOT a cancellation. The follow-up was declined while
        // the sub-agent's own work succeeded, so the no-output success strand survives exactly as
        // CP §12.2.1 established it. Only `status`/`winners` separate this arm from the three
        // cancelling ones, which is precisely the discriminator the shared finalizer erased.
        expect(seen).toEqual({
          status: "completed",
          output: undefined,
          retained: "owner answer",
          winners: ["completed"],
        })
      }),
    ),
  )

  it.live("exposes no per-sequence output through observe or observeHandle (T-11b, D-06)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const hold = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission,
        id: "job_t11b_no_output",
        type: "test",
        run: Deferred.await(hold).pipe(Effect.as(answered("p_a", 0, "done"))),
      })
      if (!started.lifetime || !started.handle) return yield* Effect.die("did not arm")

      const byInvocation = yield* jobs.observe({ lifetime: started.lifetime, sequence: 0 })
      expect(byInvocation).toBeDefined()
      expect(byInvocation && "output" in byInvocation).toBe(false)
      const byHandle = yield* jobs.observeHandle(started.handle)
      expect(byHandle).toBeDefined()
      expect(byHandle && "output" in byHandle).toBe(false)

      yield* Deferred.succeed(hold, undefined)
      expect((yield* jobs.wait({ id: "job_t11b_no_output" })).info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("keeps one answer-membership guard and exact sequence ordering identity (T-41)", () =>
    Effect.sync(() => {
      const source = readFileSync(new URL("../src/background-job.ts", import.meta.url), "utf8")
      // R-05: FILING is guarded by exactly one membership check, on the position's
      // identity. The filing path is `settle`; slice it out and census there, so the
      // check cannot silently multiply inside the path R-05 governs.
      const settleStart = source.indexOf("const settle = ")
      const settleEnd = source.indexOf("const fork = ")
      expect(settleStart).toBeGreaterThan(-1)
      expect(settleEnd).toBeGreaterThan(settleStart)
      const settleRegion = source.slice(settleStart, settleEnd)
      const filingGuards = settleRegion.match(/ledger\.filed\.has\(/g) ?? []
      expect(filingGuards).toHaveLength(1)
      // Whole-file census: the filing guard is the ONLY `filed.has` read in the module, and it
      // stays that way even though CP-032 RESTORED the delivery floor.
      //
      // It was 2 while the original chronology-keyed floor existed, because that floor had to skip
      // announcements whose position had since been filed. CP-032's floor is keyed on SEQUENCE, and
      // `settle` clears an announcement in the same modification that files — so an announced
      // sequence is by construction one that has not filed, and the floor needs no membership read
      // at all. This count staying at 1 is therefore an independent check on the floor's KEY, not
      // merely on R-05: if it rises, either identity state grew a second reader or the floor
      // regressed to chronology keying.
      const everywhere = source.match(/ledger\.filed\.has\(/g) ?? []
      expect(everywhere).toHaveLength(1)
      // No comparison of answer payloads anywhere in the delivery path.
      const comparisons = source.match(/\.detected\s*===|\.detected\s*!==/g) ?? []
      expect(comparisons).toEqual([])
      // No precedence or arrival-order vocabulary survives.
      expect(source.includes("zeroDisposed")).toBe(false)
      expect(source.includes("arrivalOrder")).toBe(false)
      // Positive controls: the detectors recognize deliberately reintroduced machinery.
      const planted = "if (sample.detected === other.detected) return"
      expect(planted.match(/\.detected\s*===|\.detected\s*!==/g)).toHaveLength(1)
      const plantedGuard = "if (ledger.filed.has(x)) { } else if (ledger.filed.has(y)) { }"
      expect(plantedGuard.match(/ledger\.filed\.has\(/g)).toHaveLength(2)

      // PRESENCE census (CP-032 Passage AK). The absence half above proves no answer-CONTENT
      // identity exists; this half proves the exact sequence ORDERING identity does. The two are
      // different kinds of identity and T-41 has to distinguish them, or restoring the floor would
      // read as the very machinery R-05 forbids.
      //
      // Sequence-keyed, not chronology-keyed — the property that keeps `filed.has` at 1 above.
      expect(source.includes("readonly announced: Set<number>")).toBe(true)
      expect(source.includes("readonly floor?: number")).toBe(true)
      expect(source.includes("entry.sequence > action.floor")).toBe(true)
      // Clear authority, by site. Exact-sequence clears: `settle`'s `not_running` arm, `settle`'s
      // main arm, and the fork finalizer that nets interruption and replaced lifetimes.
      const exactClears = source.match(/announced\.delete\(sequence\)/g) ?? []
      expect(exactClears).toHaveLength(3)
      // Ledger-wide clears, where nothing can file afterwards: `settle`'s terminalization and
      // `cancelOn`. A floor surviving either would stall retained-answer delivery forever.
      const ledgerClears = source.match(/announced\.clear\(\)/g) ?? []
      expect(ledgerClears).toHaveLength(2)
      // Positive controls for the presence detectors, so a silent removal cannot pass as a match.
      const plantedClear = "ledger.announced.delete(sequence); job.ledger.announced.delete(sequence)"
      expect(plantedClear.match(/announced\.delete\(sequence\)/g)).toHaveLength(2)
      expect("x.announced.clear()".match(/announced\.clear\(\)/g)).toHaveLength(1)
    }),
  )

  // -------------------------------------------------------------------------------------------
  // CP-032 T-032-6 — THE LIVE SEQUENCE FLOOR (A1-A9)
  //
  // WHY THESE LIVE HERE AND NOT IN THE TASK SUITE. Two TaskTool runs of one child session share a
  // single attachment-scope one-shot Deferred, so "a LATER sequence is ready while an EARLIER one
  // is still announced" cannot be scheduled through the Task surface without a forbidden hook. The
  // shipped registry IS the deterministic floor surface: real `startExact`/`extendExact`, the real
  // fork, the real `Announce` capability, real `settle`, real `waitAnswer`. Every row below drives
  // production code and asserts through the public API only.
  //
  // The pure `AnswerLog` cells above fix the TRANSITION. These fix the WIRING around it: who
  // announces, which clear fires on which exit, and what the observer computes.
  // -------------------------------------------------------------------------------------------

  it.live("withholds a later sequence while an earlier one is announced, then releases in order (A1)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      // ONE construction, run twice. `announce` is the ONLY difference between the arms, so the
      // control is what makes the negative causal: with no announcement the identical later filing
      // must deliver immediately. Without it, "withheld" could just mean "had not filed yet".
      const arm = (id: string, announce: boolean) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>()
          const holdOwner = yield* Deferred.make<void>()
          const shape = announce ? announcing : silent
          const started = yield* jobs.startExact({
            admission,
            id,
            type: "test",
            // Observed: a filed position enters the log the moment it files, which is the only
            // mode in which the delivery floor is reachable at all.
            metadata: { background: true },
            run: shape({ ready, body: Deferred.await(holdOwner).pipe(Effect.as(answered("p_owner", 100, "owner"))) }),
          })
          if (!started.handle) return yield* Effect.die("owner did not arm")
          // The floor is live before the later sequence is even admitted — no sleep, no guess.
          yield* Deferred.await(ready)

          const later = yield* jobs.extendWithHandle({
            id,
            admission,
            // Detects, announces and resolves in one step, so it files while sequence 0 is parked.
            run: announcing({ body: Effect.succeed(answered("p_later", 200, "later")) }),
          })
          expect(later).toBeDefined()

          const early = yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }))
          yield* Deferred.succeed(holdOwner, undefined)
          const first = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), `${id} first answer`)
          const second = yield* within(jobs.waitAnswer({ handle: started.handle, after: 1 }), `${id} second answer`)
          return { early, first, second }
        })

      const announced = yield* arm("job_a1_announced", true)
      const control = yield* arm("job_a1_control", false)

      // ANNOUNCED: sequence 1 filed first in TIME and is still withheld, because sequence 0 has an
      // outstanding eligibility decision. Releasing it produces conversation order with dense
      // indexes — the owner's older `at` takes index 0 even though it filed second.
      expect(announced.early.tag).toBe("withheld")
      expect(announced.first.answer?.detected).toBe("owner")
      expect(announced.first.answer?.index).toBe(0)
      expect(announced.second.answer?.detected).toBe("later")
      expect(announced.second.answer?.index).toBe(1)

      // CONTROL: identical run, no announcement, no floor — R-06's "accepted-but-unannounced work
      // installs no floor". The same later filing delivers immediately and takes index 0.
      expect(control.early.tag).toBe("delivered")
      expect(control.early.result?.answer?.detected).toBe("later")
      expect(control.early.result?.answer?.index).toBe(0)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("uses the MINIMUM announced sequence as the floor, not the maximum or a chronology (A2)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a2_minimum_floor"
      const ready0 = yield* Deferred.make<void>()
      const ready2 = yield* Deferred.make<void>()
      const hold0 = yield* Deferred.make<void>()
      const hold2 = yield* Deferred.make<void>()

      // Sequence 0 announces and parks.
      const started = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        metadata: { background: true },
        run: announcing({ ready: ready0, body: Deferred.await(hold0).pipe(Effect.as(undefined)) }),
      })
      if (!started.handle) return yield* Effect.die("owner did not arm")
      yield* Deferred.await(ready0)

      // Sequence 1 files. Sequence 2 announces and parks. Sequence 3 files. Registration order is
      // what fixes the coordinates, so each row below names a real admission sequence.
      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: announcing({ body: Effect.succeed(answered("p_seq1", 100, "seq1")) }),
        }),
      ).toBeDefined()
      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: announcing({ ready: ready2, body: Deferred.await(hold2).pipe(Effect.as(undefined)) }),
        }),
      ).toBeDefined()
      yield* Deferred.await(ready2)
      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: announcing({ body: Effect.succeed(answered("p_seq3", 300, "seq3")) }),
        }),
      ).toBeDefined()

      // Floor is min(0, 2) = 0. BOTH filed answers are later, so both are withheld. A MAXIMUM floor
      // would be 2 here and would release sequence 1 immediately.
      expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }))).tag).toBe("withheld")

      // Clearing 0 moves the floor to 2 — the next-lowest OUTSTANDING decision, not "no floor".
      yield* Deferred.succeed(hold0, undefined)
      const seq1 = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), "sequence 1's answer")
      expect(seq1.answer?.detected).toBe("seq1")
      expect(seq1.answer?.index).toBe(0)
      // Still running: sequence 0 settled with no filing while other work remains, so this release
      // is the floor moving rather than the lifetime terminalizing and clearing everything.
      expect((yield* jobs.wait({ id, timeout: 0 })).info?.status).toBe("running")

      // Sequence 3 is ABOVE the new floor and stays withheld — the direct evidence that sequence 2
      // is still announced rather than the floor having simply disappeared.
      expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 1 }))).tag).toBe("withheld")

      yield* Deferred.succeed(hold2, undefined)
      const seq3 = yield* within(jobs.waitAnswer({ handle: started.handle, after: 1 }), "sequence 3's answer")
      expect(seq3.answer?.detected).toBe("seq3")
      expect(seq3.answer?.index).toBe(1)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("clears the exact announcement when an announced sequence files nothing (A3)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a3_no_file_clear"
      const ready0 = yield* Deferred.make<void>()
      const hold0 = yield* Deferred.make<void>()
      const holdTail = yield* Deferred.make<void>()

      // Sequence 0 announces, then resolves its eligibility decision with NO answer — the
      // cancelled/no-controlling-assistant disposition, which files nothing at all.
      const started = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        metadata: { background: true },
        run: announcing({ ready: ready0, body: Deferred.await(hold0).pipe(Effect.as(undefined)) }),
      })
      if (!started.handle) return yield* Effect.die("owner did not arm")
      yield* Deferred.await(ready0)

      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: announcing({ body: Effect.succeed(answered("p_later", 100, "later")) }),
        }),
      ).toBeDefined()
      // A silent tail sequence keeps the lifetime running, so the release below is the NO-FILE
      // settle's own exact clear and not the terminal ledger-wide clear doing its work.
      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: silent({ body: Deferred.await(holdTail).pipe(Effect.as(undefined)) }),
        }),
      ).toBeDefined()

      expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }))).tag).toBe("withheld")

      yield* Deferred.succeed(hold0, undefined)
      const delivered = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), "the later answer")
      expect(delivered.answer?.detected).toBe("later")
      // The lifetime is STILL RUNNING, so no terminal clear was available to release the floor.
      expect((yield* jobs.wait({ id, timeout: 0 })).info?.status).toBe("running")

      yield* Deferred.succeed(holdTail, undefined)
      expect((yield* jobs.wait({ id })).info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("strands no floor when an announced run is interrupted before it can settle (A4)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a4_interruption_clear"
      const ready0 = yield* Deferred.make<void>()
      const hold0 = yield* Deferred.make<void>()

      // Sequence 0 announces and parks INTERRUPTIBLY, so the terminal below tears it down before it
      // can reach its own settle. Source has two nets for this path — `settle`'s `not_running` arm
      // and the fork's `ensuring` finalizer — and the property they jointly owe is this one: an
      // interrupted decision must never keep withholding an answer that has already been filed.
      const started = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        metadata: { background: true },
        run: announcing({ ready: ready0, body: Deferred.await(hold0).pipe(Effect.as(undefined)) }),
      })
      if (!started.handle) return yield* Effect.die("owner did not arm")
      yield* Deferred.await(ready0)

      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: announcing({ body: Effect.succeed(answered("p_filed", 100, "filed")) }),
        }),
      ).toBeDefined()
      expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }))).tag).toBe("withheld")

      // A sibling failure terminalizes with work still pending, which closes the job scope and
      // interrupts the parked, announced sequence 0.
      expect(yield* jobs.extend({ admission, id, run: Effect.fail("sibling boom") })).toBe(true)
      expect((yield* jobs.wait({ id })).info?.status).toBe("error")

      // An error terminal RETAINS filed answers, so the answer is still there to be withheld — and
      // it must not be. A stranded floor here would return the terminal Info instead.
      const delivered = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), "the filed answer")
      expect(delivered.answer?.detected).toBe("filed")
      expect(delivered.info).toBeUndefined()

      yield* Deferred.succeed(hold0, undefined)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("clears only its own ledger when a replaced lifetime's run finally settles (A5)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a5_foreign_token"
      const readyOld = yield* Deferred.make<void>()
      const holdOld = yield* Deferred.make<void>()
      const readyNew = yield* Deferred.make<void>()
      const holdNew = yield* Deferred.make<void>()

      // BOTH holds release on EVERY exit. The old sequence parks UNINTERRUPTIBLY, so a failing
      // assertion below would otherwise strand it and its blocked scope close, turning a clean red
      // into a teardown timeout that reports nothing.
      yield* Effect.gen(function* () {
        // The OLD lifetime announces sequence 0 and parks UNINTERRUPTIBLY, so it survives its own
        // lifetime's teardown and reaches settle/`ensuring` inside the REPLACEMENT's live window.
        const old = yield* jobs.startExact({
          admission,
          id,
          type: "test",
          metadata: { background: true },
          run: announcing({
            ready: readyOld,
            body: Deferred.await(holdOld).pipe(Effect.as(undefined), Effect.uninterruptible),
          }),
        })
        if (!old.lifetime || !old.handle) return yield* Effect.die("old lifetime did not arm")
        yield* Deferred.await(readyOld)
        expect(yield* jobs.extend({ admission, id, run: Effect.fail("sibling boom") })).toBe(true)
        expect((yield* jobs.waitExact({ lifetime: old.lifetime })).info?.status).toBe("error")

        // The replacement takes the same public id with its OWN ledger, and installs its own floor at
        // the same sequence number — which is what makes an occupant-keyed clear indistinguishable
        // from a ledger-keyed one unless the old run acts while this floor is live.
        const replacement = yield* jobs.startExact({
          admission,
          id,
          type: "test",
          metadata: { background: true },
          run: announcing({
            ready: readyNew,
            body: Deferred.await(holdNew).pipe(Effect.as(answered("p_new_owner", 100, "new owner"))),
          }),
        })
        if (!replacement.lifetime || !replacement.handle) return yield* Effect.die("replacement did not arm")
        expect(replacement.lifetime.token).not.toBe(old.lifetime.token)
        yield* Deferred.await(readyNew)
        expect(
          yield* jobs.extendWithHandle({
            id,
            admission,
            run: announcing({ body: Effect.succeed(answered("p_new_later", 200, "new later")) }),
          }),
        ).toBeDefined()
        expect((yield* observation(jobs.waitAnswer({ handle: replacement.handle, after: 0 }))).tag).toBe("withheld")

        // Release the old run INTO the replacement's live window. Its settle is `foreign_token` and
        // touches nothing; its `ensuring` clears the ledger it CLOSED OVER. Neither may reach the
        // replacement's ledger, whose sequence 0 announcement is still outstanding.
        yield* Deferred.succeed(holdOld, undefined)
        yield* Effect.yieldNow
        yield* Effect.yieldNow
        yield* Effect.sleep("20 millis")

        expect((yield* observation(jobs.waitAnswer({ handle: replacement.handle, after: 0 }))).tag).toBe("withheld")
        expect((yield* jobs.wait({ id, timeout: 0 })).info?.status).toBe("running")

        // The replacement is unpolluted: its own floor released on its own terms, in order.
        yield* Deferred.succeed(holdNew, undefined)
        const first = yield* within(jobs.waitAnswer({ handle: replacement.handle, after: 0 }), "replacement's first")
        expect(first.answer?.detected).toBe("new owner")
        expect(first.answer?.index).toBe(0)
        const second = yield* within(jobs.waitAnswer({ handle: replacement.handle, after: 1 }), "replacement's second")
        expect(second.answer?.detected).toBe("new later")
        expect(second.answer?.index).toBe(1)

        // The old ledger filed nothing and holds no stranded floor: its handle reports its own
        // terminal truth rather than parking behind an announcement that can never resolve.
        const oldRead = yield* within(jobs.waitAnswer({ handle: old.handle, after: 0 }), "the old handle's read")
        expect(oldRead.answer).toBeUndefined()
        expect(oldRead.info?.status).toBe("error")
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(holdOld, undefined).pipe(
            Effect.andThen(Deferred.succeed(holdNew, undefined)),
            Effect.asVoid,
          ),
        ),
      )
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("clears the whole announced set at a terminal disposition (A6)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a6_terminal_clear"
      const ready0 = yield* Deferred.make<void>()
      const hold0 = yield* Deferred.make<void>()

      // The hold releases on EVERY exit, for the reason A5 and A7 give: an uninterruptibly parked
      // sequence left holding its scope turns a failing assertion into a teardown timeout.
      yield* Effect.gen(function* () {
        // UNINTERRUPTIBLE on purpose: the parked sequence survives the scope close, so it can never
        // reach its own exact clear while the oracle reads. The ledger-wide clear at terminalization
        // is then the ONLY thing that can release the floor, which is what this row pins.
        const started = yield* jobs.startExact({
          admission,
          id,
          type: "test",
          metadata: { background: true },
          run: announcing({
            ready: ready0,
            body: Deferred.await(hold0).pipe(Effect.as(undefined), Effect.uninterruptible),
          }),
        })
        if (!started.handle) return yield* Effect.die("owner did not arm")
        yield* Deferred.await(ready0)

        expect(
          yield* jobs.extendWithHandle({
            id,
            admission,
            run: announcing({ body: Effect.succeed(answered("p_retained", 100, "retained")) }),
          }),
        ).toBeDefined()
        expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }))).tag).toBe("withheld")

        expect(yield* jobs.extend({ admission, id, run: Effect.fail("sibling boom") })).toBe(true)
        expect((yield* jobs.wait({ id })).info?.status).toBe("error")

        // Nothing can file past the status guard, so withholding for an outstanding decision would
        // stall retained delivery forever. The retained answer must come out, then the terminal.
        const delivered = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), "the retained answer")
        expect(delivered.answer?.detected).toBe("retained")
        const terminal = yield* within(
          jobs.waitAnswer({ handle: started.handle, after: 1 }),
          "the terminal observation",
        )
        expect(terminal.answer).toBeUndefined()
        expect(terminal.info?.status).toBe("error")

        yield* Deferred.succeed(hold0, undefined)
      }).pipe(Effect.ensuring(Deferred.succeed(hold0, undefined).pipe(Effect.asVoid)))
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("clears the whole announced set when the lifetime is cancelled (A7)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a7_cancel_clear"
      const ready0 = yield* Deferred.make<void>()
      const hold0 = yield* Deferred.make<void>()

      const started = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        metadata: { background: true },
        run: announcing({
          ready: ready0,
          body: Deferred.await(hold0).pipe(Effect.as(undefined), Effect.uninterruptible),
        }),
      })
      if (!started.lifetime || !started.handle) return yield* Effect.die("owner did not arm")
      yield* Deferred.await(ready0)

      // The hold is released on EVERY exit. `cancelOn` awaits a scope close that cannot finish
      // while this sequence is uninterruptibly parked, so a failing assertion below would
      // otherwise strand the forked canceller and wedge teardown instead of reporting.
      yield* Effect.gen(function* () {
        expect(
          yield* jobs.extendWithHandle({
            id,
            admission,
            run: announcing({ body: Effect.succeed(answered("p_retained", 100, "retained")) }),
          }),
        ).toBeDefined()
        expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }))).tag).toBe("withheld")

        // `cancelOn` AWAITS its scope close, and the parked sequence is uninterruptible — so the
        // call is forked and the oracle reads in the window after the cancelled winner is published
        // and before the parked run can ever clear its own announcement.
        const cancelling = yield* jobs.cancelExact(started.lifetime).pipe(Effect.forkScoped)
        expect((yield* jobs.waitExact({ lifetime: started.lifetime })).info?.status).toBe("cancelled")

        // A cancellation terminal carries no answer payload; filed answers stay retained and
        // retrievable, which they cannot be if a cancelled lifetime keeps an outstanding floor.
        const delivered = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), "the retained answer")
        expect(delivered.answer?.detected).toBe("retained")
        const terminal = yield* within(jobs.waitAnswer({ handle: started.handle, after: 1 }), "the cancelled terminal")
        expect(terminal.info?.status).toBe("cancelled")
        expect(Object.hasOwn(terminal.info ?? {}, "output")).toBe(false)

        yield* Deferred.succeed(hold0, undefined)
        yield* within(Fiber.join(cancelling), "the cancellation never completed its scope close")
      }).pipe(Effect.ensuring(Deferred.succeed(hold0, undefined).pipe(Effect.asVoid)))
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("adds no timeout and no overtaking escape while the earliest decision is unresolved (A8)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a8_no_timeout"
      const ready0 = yield* Deferred.make<void>()
      const hold0 = yield* Deferred.make<void>()

      const started = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        metadata: { background: true },
        run: announcing({ ready: ready0, body: Deferred.await(hold0).pipe(Effect.as(undefined)) }),
      })
      if (!started.handle) return yield* Effect.die("owner did not arm")
      yield* Deferred.await(ready0)

      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: announcing({ body: Effect.succeed(answered("p_ready", 100, "ready")) }),
        }),
      ).toBeDefined()

      // Unbounded retention behind the earliest unresolved announcement is INTENTIONAL ordinary-use
      // cost (CP §3.3.1). This window is far longer than any escape a timeout or readiness-based
      // overtaking rule would plausibly use, and the answer has been ready the whole time.
      expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }), 600)).tag).toBe("withheld")
      // Nor may the wait manufacture a terminal to escape with: the lifetime is still running.
      expect((yield* jobs.wait({ id, timeout: 0 })).info?.status).toBe("running")

      // Only the decision resolving releases it.
      yield* Deferred.succeed(hold0, undefined)
      const delivered = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), "the ready answer")
      expect(delivered.answer?.detected).toBe("ready")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("keeps a promoted buffered answer's original sequence, so the floor still withholds it (A9)", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_a9_promotion_sequence"
      const ready0 = yield* Deferred.make<void>()
      const hold0 = yield* Deferred.make<void>()
      const holdTail = yield* Deferred.make<void>()

      // FOREGROUND at first: sequence 1's answer buffers rather than publishing, so promotion is
      // what republishes it into the log — the only route on which a promoted answer's sequence
      // has to be carried rather than invented.
      const started = yield* jobs.startExact({
        admission,
        id,
        type: "test",
        run: announcing({ ready: ready0, body: Deferred.await(hold0).pipe(Effect.as(undefined)) }),
      })
      if (!started.lifetime || !started.handle) return yield* Effect.die("owner did not arm")
      yield* Deferred.await(ready0)

      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: announcing({ body: Effect.succeed(answered("p_promoted", 200, "promoted")) }),
        }),
      ).toBeDefined()
      // A silent tail keeps the lifetime alive, so the release below is sequence 0's own exact
      // clear rather than a terminal clear.
      expect(
        yield* jobs.extendWithHandle({
          id,
          admission,
          run: silent({ body: Deferred.await(holdTail).pipe(Effect.as(undefined)) }),
        }),
      ).toBeDefined()

      expect(yield* jobs.promoteExact(started.lifetime)).toMatchObject({ metadata: { background: true } })

      // Republished under its REAL sequence 1, so the outstanding sequence 0 still withholds it. An
      // invented or zeroed sequence would order the promoted answer against a fiction and release
      // it here.
      expect((yield* observation(jobs.waitAnswer({ handle: started.handle, after: 0 }))).tag).toBe("withheld")

      yield* Deferred.succeed(hold0, undefined)
      const delivered = yield* within(jobs.waitAnswer({ handle: started.handle, after: 0 }), "the promoted answer")
      expect(delivered.answer?.detected).toBe("promoted")
      expect(delivered.answer?.index).toBe(0)
      expect((yield* jobs.wait({ id, timeout: 0 })).info?.status).toBe("running")

      yield* Deferred.succeed(holdTail, undefined)
      expect((yield* jobs.wait({ id })).info?.status).toBe("completed")
    }).pipe(Effect.provide(jobsLayer)),
  )
})
