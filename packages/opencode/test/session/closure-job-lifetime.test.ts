import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { Deferred, Effect, Exit, Fiber, Ref, Scope } from "effect"
import { noAnswer, syntheticAdmission } from "../lib/background"
import { itBounded } from "../lib/effect"

// The exact JobLifetime token.
//
// Every case here is about the registry's own mechanics: the four-state whole-lifetime
// token, the one shared arm attempt per token, monotonic invocation sequences, the
// ArmPermit compare-and-set, and the bind-before-arm/fork ordering. The binder is
// scripted so the moment between "admission answered" and "run effect armed" is a
// point the test can stand on; the real coordinator-side decision is deliberately not
// simulated here beyond the decision it returns.

type Call = { readonly id: string; readonly token: object; readonly sequence: number }

type Made = {
  readonly permit: BackgroundJob.ArmPermit
  readonly revoke: Effect.Effect<boolean>
  readonly read: Effect.Effect<BackgroundJob.PermitState>
}

type Harness = {
  readonly jobs: BackgroundJob.Interface
  readonly calls: Call[]
  readonly permits: Made[]
  readonly scope: Scope.Closeable
}

/**
 * Builds a registry whose binder records every bind and, by default, grants it. A
 * `decide` override takes over the answer entirely, so a test can gate, refuse, or
 * hand back an already-revoked permit.
 */
const harness = (decide?: (input: BackgroundJob.Invocation, made: Made) => Effect.Effect<BackgroundJob.BindDecision>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    // Bound to the TEST's scope as well as closed explicitly below. Without this, a body
    // that `itBounded` interrupts at FIBER_BOUND_MILLIS leaks this scope with live forked
    // run effects still in it, and the bun process never exits - which turns a red test
    // into a hung runner and makes mutation/falsification runs unusable.
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const calls: Call[] = []
    const permits: Made[] = []
    const binder: BackgroundJob.Binder = {
      bind: (input) =>
        Effect.gen(function* () {
          calls.push({ id: input.lifetime.id, token: input.lifetime.token, sequence: input.sequence })
          const made = yield* BackgroundJob.makePermit(input.lifetime, input.sequence)
          permits.push(made)
          if (decide) return yield* decide(input, made)
          return { kind: "arm_allowed" as const, permit: made.permit }
        }),
      terminal: () => Effect.void,
    }
    const jobs = yield* BackgroundJob.makeWith(binder).pipe(Scope.provide(scope))
    return { jobs, calls, permits, scope } satisfies Harness
  })

/** Spins until `check` holds, so a test never asserts on a not-yet-scheduled fiber. */
const until = (check: Effect.Effect<boolean>): Effect.Effect<void> =>
  check.pipe(Effect.flatMap((done) => (done ? Effect.void : Effect.sleep(1).pipe(Effect.andThen(until(check))))))

const forkIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.forkIn(scope, { startImmediately: true }))

describe("closure.job-lifetime", () => {
  // Admission is answered, and its permit consumed, before the run effect can exist.
  // The gated binder makes the pre-arm instant observable rather than inferred.
  itBounded.live("sequence zero binds and consumes its exact permit before any run effect is forked", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const { jobs, calls, permits, scope } = yield* harness((_, made) =>
        Deferred.await(gate).pipe(Effect.as({ kind: "arm_allowed" as const, permit: made.permit })),
      )
      const release = yield* Deferred.make<void>()
      const started = yield* Ref.make(0)
      const running = yield* forkIn(
        scope,
        jobs.startExact({
          admission: syntheticAdmission(),
          id: "job_k64",
          type: "test",
          // Parked so the assertions below land on the ARM itself rather than on a
          // lifetime that has already run to completion - `armed` is this row's subject.
          run: Ref.update(started, (n) => n + 1).pipe(Effect.andThen(Deferred.await(release)), Effect.as(noAnswer)),
        }),
      )

      yield* until(Effect.sync(() => calls.length === 1))

      // POSITIVE PRECONDITION: we are genuinely parked at the bind, on sequence zero,
      // for this exact lifetime - not merely before the run for unrelated reasons.
      expect(calls).toHaveLength(1)
      expect(calls[0]?.id).toBe("job_k64")
      expect(calls[0]?.sequence).toBe(0)
      expect(yield* Ref.get(started)).toBe(0)
      expect(yield* permits[0]!.read).toBe("issued")
      // Public compatibility is untouched by the internal state: the job is visible and
      // reports `running` from registration onward.
      expect((yield* jobs.get("job_k64"))?.status).toBe("running")

      yield* Deferred.succeed(gate, undefined)
      const result = yield* Fiber.join(running)

      expect(result.lifetime).toBeDefined()
      expect(yield* permits[0]!.read).toBe("consumed")
      yield* until(Ref.get(started).pipe(Effect.map((n) => n === 1)))
      expect(yield* Ref.get(started)).toBe(1)

      const observed = yield* jobs.observe({ lifetime: result.lifetime!, sequence: 0 })
      expect(observed?.state).toBe("armed")
      expect(observed?.accepted).toBe(true)

      yield* Deferred.succeed(release, undefined)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  // One token, one arm attempt. A second concurrent start must observe the
  // first attempt's result, never publish a bind of its own.
  itBounded.live("a second concurrent start joins the one arm attempt and never binds twice", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const { jobs, calls, permits, scope } = yield* harness((_, made) =>
        Deferred.await(gate).pipe(Effect.as({ kind: "arm_allowed" as const, permit: made.permit })),
      )
      const started = yield* Ref.make(0)
      const run = Ref.update(started, (n) => n + 1).pipe(Effect.as(noAnswer))

      const first = yield* forkIn(
        scope,
        jobs.startExact({ admission: syntheticAdmission(), id: "job_k115", type: "test", run }),
      )
      yield* until(Effect.sync(() => calls.length === 1))
      const second = yield* forkIn(
        scope,
        jobs.startExact({ admission: syntheticAdmission(), id: "job_k115", type: "test", run }),
      )

      // Give the joiner room to misbehave before we conclude it did not.
      yield* Effect.sleep(10)
      expect(calls).toHaveLength(1)
      expect(permits).toHaveLength(1)

      yield* Deferred.succeed(gate, undefined)
      const a = yield* Fiber.join(first)
      const b = yield* Fiber.join(second)

      expect(calls).toHaveLength(1)
      expect(permits).toHaveLength(1)
      expect(b.info.id).toBe(a.info.id)
      expect(b.lifetime?.token).toBe(a.lifetime!.token)
      expect(b.handle).toBe(a.handle)
      yield* until(Ref.get(started).pipe(Effect.map((n) => n >= 1)))
      expect(yield* Ref.get(started)).toBe(1)

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // Sequence zero arms first. An extension that arrives during the arm
  // attempt waits on that exact attempt and cannot reserve ahead of it.
  itBounded.live("an extension arriving before arm waits for it, then takes sequence one", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const { jobs, calls, scope } = yield* harness((input, made) =>
        input.sequence === 0
          ? Deferred.await(gate).pipe(Effect.as({ kind: "arm_allowed" as const, permit: made.permit }))
          : Effect.succeed({ kind: "arm_allowed" as const, permit: made.permit }),
      )
      const order = yield* Ref.make<readonly string[]>([])

      const first = yield* forkIn(
        scope,
        jobs.startExact({
          admission: syntheticAdmission(),
          id: "job_k116",
          type: "test",
          run: Deferred.await(release).pipe(
            Effect.andThen(Ref.update(order, (v) => [...v, "base"])),
            Effect.as(noAnswer),
          ),
        }),
      )
      yield* until(Effect.sync(() => calls.length === 1))

      const extending = yield* forkIn(
        scope,
        jobs.extendExact({
          admission: syntheticAdmission(),
          lifetime: { id: "job_k116", token: calls[0]!.token },
          run: Ref.update(order, (v) => [...v, "ext"]).pipe(Effect.as(noAnswer)),
        }),
      )
      yield* Effect.sleep(10)
      // NEGATIVE: no extension bind exists yet, with the positive control that the
      // sequence-zero bind above is already recorded.
      expect(calls.map((item) => item.sequence)).toEqual([0])

      yield* Deferred.succeed(gate, undefined)
      const base = yield* Fiber.join(first)
      const extended = yield* Fiber.join(extending)

      expect(extended.extended).toBe(true)
      if (!extended.extended) return yield* Effect.die("extension was not accepted")
      expect(extended.sequence).toBe(1)
      expect(typeof extended.handle).toBe("object")
      expect(calls.map((item) => item.sequence)).toEqual([0, 1])

      yield* Deferred.succeed(release, undefined)
      const terminal = yield* jobs.waitExact({ lifetime: base.lifetime! })
      expect(terminal.info?.status).toBe("completed")
      // Execution is no longer serialized behind the previous run's tail, so the extension's run
      // completes first even though it holds the later sequence. What this test still pins is the
      // BIND ordering asserted above: no extension binds before the base is armed, and it takes
      // sequence one. Answer ordering is by position at delivery, not by execution order.
      expect(yield* Ref.get(order)).toEqual(["ext", "base"])

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // If the attempt the extension joined terminalizes, the
  // extension reports failure rather than arming against a dead token.
  itBounded.live("an extension joined to an attempt that terminalizes returns extended:false", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const { jobs, calls, scope } = yield* harness((_, made) =>
        Deferred.await(gate).pipe(Effect.as({ kind: "arm_allowed" as const, permit: made.permit })),
      )
      const started = yield* Ref.make(0)

      const first = yield* forkIn(
        scope,
        jobs.startExact({
          admission: syntheticAdmission(),
          id: "job_k116b",
          type: "test",
          run: Effect.succeed(noAnswer),
        }),
      )
      yield* until(Effect.sync(() => calls.length === 1))
      const extending = yield* forkIn(
        scope,
        jobs.extendExact({
          admission: syntheticAdmission(),
          lifetime: { id: "job_k116b", token: calls[0]!.token },
          run: Ref.update(started, (n) => n + 1).pipe(Effect.as(noAnswer)),
        }),
      )
      yield* Effect.sleep(10)

      // Cancel terminalizes the unarmed token and settles the shared attempt, so both
      // the start and the joined extension resolve rather than waiting forever.
      expect((yield* jobs.cancel("job_k116b"))?.status).toBe("cancelled")
      yield* Deferred.succeed(gate, undefined)

      yield* Fiber.join(first)
      expect(yield* Fiber.join(extending)).toEqual({ extended: false })
      expect(yield* Ref.get(started)).toBe(0)
      expect(calls.map((item) => item.sequence)).toEqual([0])

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // Binder interruption terminalizes exactly this token, settles the shared
  // attempt and every joiner, and forks nothing.
  itBounded.live("interrupting the binder terminalizes the token and settles joiners with zero run effects", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const { jobs, calls, scope } = yield* harness(() =>
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const started = yield* Ref.make(0)
      const run = Ref.update(started, (n) => n + 1).pipe(Effect.as(noAnswer))

      const registrar = yield* forkIn(
        scope,
        jobs.startExact({ admission: syntheticAdmission(), id: "job_k117", type: "test", run }),
      )
      yield* Deferred.await(entered)
      const joiner = yield* forkIn(
        scope,
        jobs.startExact({ admission: syntheticAdmission(), id: "job_k117", type: "test", run }),
      )
      const extending = yield* forkIn(
        scope,
        jobs.extendExact({
          admission: syntheticAdmission(),
          lifetime: { id: "job_k117", token: calls[0]!.token },
          run,
        }),
      )
      yield* Effect.sleep(10)

      yield* Fiber.interrupt(registrar)

      // The joined start settles from the terminal result rather than hanging.
      const observed = yield* Fiber.join(joiner)
      expect(observed.info.status).toBe("error")
      expect(observed.lifetime).toBeUndefined()
      expect(yield* Fiber.join(extending)).toEqual({ extended: false })
      expect(yield* Ref.get(started)).toBe(0)
      expect(calls).toHaveLength(1)

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // A permit already revoked when the registry tries to claim it wins the CAS; the
  // lifetime terminalizes and nothing runs. The coordinator side that raises the fence
  // is exercised in closure-job-bind.test.ts.
  itBounded.live("a revoked permit loses the arm and produces zero run effects", () =>
    Effect.gen(function* () {
      const { jobs, permits, scope } = yield* harness((_, made) =>
        made.revoke.pipe(Effect.as({ kind: "arm_allowed" as const, permit: made.permit })),
      )
      const started = yield* Ref.make(0)

      const result = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k118",
        type: "test",
        run: Ref.update(started, (n) => n + 1).pipe(Effect.as(noAnswer)),
      })

      expect(result.lifetime).toBeUndefined()
      expect(yield* permits[0]!.read).toBe("revoked")
      expect(yield* Ref.get(started)).toBe(0)
      expect((yield* jobs.get("job_k118"))?.status).toBe("cancelled")

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // When consumption wins first, a later revocation must lose -
  // the fence then owns an ARMED lifetime and must adopt/cancel it, not misclassify it
  // as never-armed.
  itBounded.live("when consumption wins first a later revoke loses and the lifetime is armed", () =>
    Effect.gen(function* () {
      const { jobs, permits, scope } = yield* harness()
      const result = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k118b",
        type: "test",
        run: Effect.succeed(noAnswer),
      })

      expect(result.lifetime).toBeDefined()
      expect(yield* permits[0]!.read).toBe("consumed")
      expect(yield* permits[0]!.revoke).toBe(false)
      expect(yield* permits[0]!.read).toBe("consumed")
      // And the permit cannot be claimed a second time.
      expect(yield* permits[0]!.permit.claim).toBe(false)

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // An armed lifetime is adopted, never replaced, and cancellation targets
  // the whole lifetime once.
  itBounded.live("start adopts an armed lifetime without a second bind or duplicate fork", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const { jobs, calls, scope } = yield* harness()
      const started = yield* Ref.make(0)
      const run = Ref.update(started, (n) => n + 1).pipe(Effect.andThen(Deferred.await(release)), Effect.as(noAnswer))

      const first = yield* jobs.startExact({ admission: syntheticAdmission(), id: "job_k65", type: "test", run })
      const second = yield* jobs.startExact({ admission: syntheticAdmission(), id: "job_k65", type: "test", run })

      expect(calls).toHaveLength(1)
      expect(second.lifetime?.token).toBe(first.lifetime!.token)
      expect(second.handle).toBe(first.handle)
      expect(yield* Ref.get(started)).toBe(1)

      expect((yield* jobs.cancelExact(first.lifetime!))?.status).toBe("cancelled")
      // A repeat physical cancel observes the same terminal truth; there is no second winner.
      expect((yield* jobs.cancelExact(first.lifetime!))?.status).toBe("cancelled")

      yield* Deferred.succeed(release, undefined)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  // Monotonic accepted sequences and a single token-wide terminal winner.
  itBounded.live("extensions take monotonic sequences with one lifetime winner", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const { jobs, calls, scope } = yield* harness()
      const base = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k66",
        type: "test",
        run: Deferred.await(release).pipe(Effect.as(noAnswer)),
      })
      const lifetime = base.lifetime!
      if (!base.handle) return yield* Effect.die("base invocation was not accepted")

      const first = yield* jobs.extendExact({
        admission: syntheticAdmission(),
        lifetime,
        run: Effect.succeed(noAnswer),
      })
      expect(first.extended).toBe(true)
      if (!first.extended) return yield* Effect.die("first extension was not accepted")
      expect(first.sequence).toBe(1)
      const second = yield* jobs.extendExact({
        admission: syntheticAdmission(),
        lifetime,
        run: Effect.succeed(noAnswer),
      })
      expect(second.extended).toBe(true)
      if (!second.extended) return yield* Effect.die("second extension was not accepted")
      expect(second.sequence).toBe(2)
      expect(calls.map((item) => item.sequence)).toEqual([0, 1, 2])

      expect((yield* jobs.observe({ lifetime, sequence: 1 }))?.accepted).toBe(true)
      expect((yield* jobs.observe({ lifetime, sequence: 2 }))?.accepted).toBe(true)
      expect((yield* jobs.observeHandle(first.handle))?.invocations).toEqual(
        new Set([base.handle, first.handle, second.handle]),
      )

      // A sequence that was never reserved is not accepted.
      expect((yield* jobs.observe({ lifetime, sequence: 99 }))?.accepted).toBe(false)

      yield* Deferred.succeed(release, undefined)
      const terminal = yield* jobs.waitExact({ lifetime })
      expect(terminal.info?.status).toBe("completed")

      // NO PER-SEQUENCE WINNER: every bound sequence reports the one lifetime status.
      const zero = yield* jobs.observe({ lifetime, sequence: 0 })
      const one = yield* jobs.observe({ lifetime, sequence: 1 })
      expect(one?.status).toBe(zero!.status)
      expect(one?.status).toBe("completed")

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // A refused extension leaves no reserved coordinate armed, and the caller
  // falls back to the reviewed fresh-start path against a genuinely new token.
  itBounded.live("a refused extension arms nothing and the fresh start takes a new token", () =>
    Effect.gen(function* () {
      const { jobs, calls, permits, scope } = yield* harness((input, made) =>
        input.sequence === 0
          ? Effect.succeed({ kind: "arm_allowed" as const, permit: made.permit })
          : Effect.succeed({ kind: "cancellation_owned" as const }),
      )
      const started = yield* Ref.make(0)

      const release = yield* Deferred.make<void>()
      const base = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k67",
        type: "test",
        // Held RUNNING deliberately. Terminalizing the lifetime first would make
        // `reserve` return absent and the extension would exit before ever reaching the
        // binder - so the refusal path this row is about would go unexercised. A mutant
        // disabling the acceptance gate survived until this was fixed.
        run: Deferred.await(release).pipe(Effect.as(noAnswer)),
      })
      const lifetime = base.lifetime!

      expect(
        yield* jobs.extendExact({
          admission: syntheticAdmission(),
          lifetime,
          run: Ref.update(started, (n) => n + 1).pipe(Effect.as(noAnswer)),
        }),
      ).toEqual({ extended: false })
      expect(yield* Ref.get(started)).toBe(0)
      // The coordinate was reserved and bound, then refused: never accepted, and its
      // permit never consumed.
      expect(calls.map((item) => item.sequence)).toEqual([0, 1])
      expect((yield* jobs.observe({ lifetime, sequence: 1 }))?.accepted).toBe(false)
      expect(yield* permits[1]!.read).toBe("issued")

      yield* Deferred.succeed(release, undefined)
      yield* jobs.waitExact({ lifetime })

      const replacement = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k67",
        type: "test",
        run: Effect.succeed(noAnswer),
      })
      expect(replacement.lifetime?.token).toBeDefined()
      expect(replacement.lifetime!.token).not.toBe(lifetime.token)
      // The fresh start binds its own sequence zero; no extension coordinate was armed.
      expect(calls.map((item) => item.sequence)).toEqual([0, 1, 0])

      yield* Scope.close(scope, Exit.void)
    }),
  )

  // The ABA barrier. A stale handle can reach
  // NOTHING of a replacement registered under the same public id.
  itBounded.live(
    "a stale lifetime handle cannot observe, promote, cancel, wait on or extend a replacement",
    () =>
      Effect.gen(function* () {
        const { jobs, scope } = yield* harness()
        const promotions = yield* Ref.make<readonly string[]>([])

        const original = yield* jobs.startExact({
          admission: syntheticAdmission(),
          id: "job_k68",
          type: "test",
          onPromote: Ref.update(promotions, (v) => [...v, "original"]),
          run: Effect.succeed(noAnswer),
        })
        const stale = original.lifetime!
        yield* jobs.waitExact({ lifetime: stale })

        const release = yield* Deferred.make<void>()
        const replacement = yield* jobs.startExact({
          admission: syntheticAdmission(),
          id: "job_k68",
          type: "test",
          onPromote: Ref.update(promotions, (v) => [...v, "replacement"]),
          run: Deferred.await(release).pipe(Effect.as(noAnswer)),
        })
        const fresh = replacement.lifetime!
        expect(fresh.token).not.toBe(stale.token)

        // POSITIVE PRECONDITION: the replacement is genuinely live under the same id, so
        // each negative below is about identity rather than about an absent job.
        expect((yield* jobs.getExact(fresh))?.status).toBe("running")
        expect((yield* jobs.get("job_k68"))?.status).toBe("running")

        expect(yield* jobs.getExact(stale)).toBeUndefined()
        expect(yield* jobs.promoteExact(stale)).toBeUndefined()
        expect(yield* jobs.cancelExact(stale)).toBeUndefined()
        expect(yield* jobs.waitExact({ lifetime: stale })).toEqual({ timedOut: false })
        expect(yield* jobs.waitForPromotionExact(stale)).toBeUndefined()
        expect(yield* jobs.observe({ lifetime: stale, sequence: 0 })).toBeUndefined()
        expect(
          yield* jobs.extendExact({
            admission: syntheticAdmission(),
            lifetime: stale,
            run: Effect.succeed(noAnswer),
          }),
        ).toEqual({ extended: false })

        // The sharpest edge: the stale promote must not have run the REPLACEMENT's
        // onPromote, which carries attachment ownership.
        expect(yield* Ref.get(promotions)).toEqual([])
        expect((yield* jobs.getExact(fresh))?.status).toBe("running")
        expect((yield* jobs.getExact(fresh))?.metadata?.background).toBeUndefined()

        // The exact current handle still works, and it is the one that runs the callback.
        expect((yield* jobs.promoteExact(fresh))?.metadata?.background).toBe(true)
        expect(yield* Ref.get(promotions)).toEqual(["replacement"])

        yield* Deferred.succeed(release, undefined)
        yield* Scope.close(scope, Exit.void)
      }),
  )

  // The exact surface exists alongside unchanged public compatibility, and the
  // public snapshot never carries the token.
  itBounded.live("the exact surface pairs handles with snapshots while public Info stays unchanged", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const { jobs, scope } = yield* harness()
      const first = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k69_a",
        type: "test",
        metadata: { durable: false },
        run: Deferred.await(release).pipe(Effect.as(noAnswer)),
      })
      const second = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k69_b",
        type: "test",
        run: Deferred.await(release).pipe(Effect.as(noAnswer)),
      })

      const exact = yield* jobs.listExact()
      const plain = yield* jobs.list()
      expect(exact).toHaveLength(2)
      expect(plain).toHaveLength(2)
      expect(exact.map((item) => item.info.id)).toEqual(plain.map((item) => item.id))
      // IDENTITY, not structural equality. A token is an opaque `{}` whose *identity* is
      // the lifetime, so `toEqual` is vacuous here - every token deep-equals every other
      // one. A mutant returning a fresh `{}` survived this assertion until it used toBe.
      expect(exact[0]?.lifetime.token).toBe(first.lifetime!.token)
      expect(exact[1]?.lifetime.token).toBe(second.lifetime!.token)

      // Public compatibility is byte-shaped as before: no token leaks into Info.
      expect(plain[0]).toMatchObject({ id: "job_k69_a", type: "test", status: "running", metadata: { durable: false } })
      expect("token" in plain[0]!).toBe(false)
      expect("lifetime" in plain[0]!).toBe(false)

      // The id-keyed compatibility methods still resolve by id alone.
      expect((yield* jobs.get("job_k69_a"))?.id).toBe("job_k69_a")
      expect((yield* jobs.wait({ id: "job_k69_a", timeout: 0 })).timedOut).toBe(true)

      yield* Deferred.succeed(release, undefined)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  // The compatibility boundary, pinned so a later change cannot silently move it: an
  // ID-keyed promote does act on whatever currently occupies the id. That is why an
  // id-keyed list-then-promote sequence is not evidence that the promoted run is the
  // one that was listed; only the exact handle carries that.
  itBounded.live("an id-keyed promote deliberately still acts on the current occupant", () =>
    Effect.gen(function* () {
      const { jobs, scope } = yield* harness()
      const promotions = yield* Ref.make<readonly string[]>([])

      const original = yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k69_compat",
        type: "test",
        onPromote: Ref.update(promotions, (v) => [...v, "original"]),
        run: Effect.succeed(noAnswer),
      })
      yield* jobs.waitExact({ lifetime: original.lifetime! })

      const release = yield* Deferred.make<void>()
      yield* jobs.startExact({
        admission: syntheticAdmission(),
        id: "job_k69_compat",
        type: "test",
        onPromote: Ref.update(promotions, (v) => [...v, "replacement"]),
        run: Deferred.await(release).pipe(Effect.as(noAnswer)),
      })

      expect((yield* jobs.promote("job_k69_compat"))?.metadata?.background).toBe(true)
      expect(yield* Ref.get(promotions)).toEqual(["replacement"])

      yield* Deferred.succeed(release, undefined)
      yield* Scope.close(scope, Exit.void)
    }),
  )
})
