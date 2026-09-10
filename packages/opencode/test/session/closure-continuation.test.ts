import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Exit, Fiber, Layer, Queue } from "effect"
import { SessionAdmission } from "@/session/closure/admission"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionID } from "@/session/schema"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { unusedJobs } from "../lib/closure"
import { itBounded as it } from "../lib/effect"

// CP-023 §18 Gate 3 step 1 / K70-K71. The causal continuation lease.
//
// These assert at the COORDINATOR's own boundary rather than through `tool/task.ts`, because what
// needs proving here is that a continuation lease can be acquired, carried, and settled with a
// disposition at all. The Task-side consolidation that consumes it is proved separately; driving
// both through one pipeline could not distinguish a defect in one from a defect in the other.
//
// The pure model already implements every rule these exercise — `reserveLease` rejects a
// continuation whose `originEpoch` has moved (model.ts:2019-2020, I-31's "cannot remint"), and
// `finishLease` rejects a second settlement as `noop/settled` (model.ts:2076-2077, §7.2's "no
// intermediate retirement"). What is unproven, and what these cover, is whether the COORDINATOR
// actually reaches those rules or silently flattens them into `pre_bind` + `retired`.

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

// No driver work is needed: these tests never raise a fence, so nothing is ever dispatched.
const idleDriver: Ports.Driver = { run: () => Effect.void, command: () => Effect.void }

const withDriver = <A, E, R>(driver: Ports.Driver, body: Effect.Effect<A, E, R | SessionClosure.Service>) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    return yield* body.pipe(
      Effect.provide(
        SessionClosure.layer.pipe(
          Layer.provide(SessionToolPartPermit.layer),
          Layer.provide(Ports.makeLayer(() => Effect.succeed({ driver, participants: [], hooks: {} }))),
        ),
      ),
      provideInstanceEffect(directory),
    )
  }).pipe(Effect.provide(services))

const withClosure = <A, E, R>(body: Effect.Effect<A, E, R | SessionClosure.Service>) => withDriver(idleDriver, body)

const owner = Effect.gen(function* () {
  const signal = yield* Deferred.make<void>()
  return { id: Model.id("scope", `scope_${crypto.randomUUID()}`), signal }
})

const leasesFor = (view: Model.View, session: SessionID) =>
  view.leases.filter((item) => item.session === Model.id("session", session))

describe("continuation lease acquisition and settlement (CP-023 §6.2, §7.2, I-31)", () => {
  it.live("settles a reserved lease failed when continuation-handle publication defects", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_continuation_publication_defect")
      const lease = Model.id("lease", "lease_continuation_publication_defect")
      const retired: Array<{ lease: Model.LeaseID; disposition?: SessionClosure.LeaseDisposition }> = []
      const closure: SessionClosure.Interface = {
        ...unusedJobs,
        request: () => Effect.die("unused"),
        view: Effect.die("unused"),
        identity: Effect.die("unused"),
        acquire: () =>
          Effect.succeed({
            type: "admitted" as const,
            lease,
            epoch: 0n,
            get instance(): Model.InstanceID {
              throw new Error("publication defect")
            },
          }),
        bind: () => Effect.void,
        retire: (current, disposition) =>
          Effect.sync(() => {
            retired.push({ lease: current, disposition })
          }),
        reserveMutation: () => Effect.die("unused"),
        activateMutation: () => Effect.void,
        retireMutation: () => Effect.void,
      }

      const exit = yield* SessionAdmission.acquireContinuation(closure, {
        session,
        caller: session,
        target: SessionID.make("ses_continuation_publication_target"),
        source: "test.publication-defect",
      }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(retired).toEqual([{ lease, disposition: "failed" }])
    }),
  )

  // I-31: a continuation lease must be settleable under EVERY exit, including parent-gone. An
  // observer blocked mid-injection into a departed session would otherwise never settle, so
  // quiescence could never be proved and a later `abort` of that branch would fail permanently.
  //
  // Removal is deliberately NOT modelled as a fence: §0.1 is explicit that cancellation preserves
  // the branch while removal deletes it, so the trigger is the `remove_session` mutation lease
  // Slice D already takes. This asserts at the coordinator's own boundary because that is where the
  // signal originates; the Task-side consumer cannot prove it (a recording fake never runs `store`).
  it.live("signals a departing session's continuation lease, settling it suppressed (I-31)", () =>
    withClosure(
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const parent = SessionID.make("ses_departing_parent")
        const child = SessionID.make("ses_departing_child")

        const held = yield* SessionAdmission.acquireContinuation(closure, {
          session: parent,
          caller: parent,
          target: child,
          source: "test.departure",
        })

        const started = yield* Deferred.make<void>()
        const blocked = yield* Deferred.make<void>()
        const observer = yield* held
          .observe(Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(blocked))))
          .pipe(Effect.exit, Effect.forkScoped)
        yield* Deferred.await(started)

        // Positive precondition: the lease is live and OUTSTANDING while the observer genuinely
        // runs. Without it, a later `suppressed` could mean the observer never started at all.
        const before = leasesFor(yield* closure.view, parent).filter((item) => item.kind === "continuation")
        expect(before).toHaveLength(1)
        expect(before[0]?.state).not.toBe("suppressed")

        yield* closure.reserveMutation({ sessions: [parent], kind: "remove_session" })

        // FACT 1 - the coordinator signalled. `blocked` is never resolved, so the observer can only
        // have terminated by interruption reaching its scope.
        const settled = yield* Fiber.join(observer)
        expect(Exit.hasInterrupts(settled)).toBe(true)

        // FACT 2 - the signalled observer settled its ordinary lease and retention cleanup removed
        // the terminal row. The adapter-level outcome test below separately proves that this exact
        // interrupted/refused shape supplies `suppressed`, rather than flattening every exit.
        const after = leasesFor(yield* closure.view, parent).filter((item) => item.kind === "continuation")
        expect(after).toEqual([])
      }),
    ),
  )

  it.live("acquires a continuation lease carrying its caller, target, and origin epoch", () =>
    withClosure(
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const caller = SessionID.make("ses_continuation_caller")
        const target = SessionID.make("ses_continuation_target")
        const handle = yield* owner

        // Positive precondition: nothing is fenced and no lease exists, so everything asserted
        // below is attributable to this one acquisition.
        expect((yield* closure.view).fences).toEqual([])
        expect(leasesFor(yield* closure.view, caller)).toEqual([])

        const decision = yield* closure.acquire({
          session: caller,
          origin: "internal",
          retry: "initial",
          source: "test.continuation",
          owner: handle,
          kind: "continuation",
          caller,
          target,
          originEpoch: 0n,
        })
        expect(decision.type).toBe("admitted")

        // The load-bearing claim: the coordinator reached the model's `continuation` variant rather
        // than flattening to `pre_bind`. Provenance is what a delayed callback is later checked
        // against, so a lease that lost it could be reminted at a newer epoch undetected.
        const held = leasesFor(yield* closure.view, caller)
        expect(held).toHaveLength(1)
        expect(held[0]?.kind).toBe("continuation")
        expect(held[0]?.state).toBe("reserved")
        if (held[0]?.kind !== "continuation") return yield* Effect.die("expected a continuation lease")
        expect(held[0].caller).toBe(Model.id("session", caller))
        expect(held[0].target).toBe(Model.id("session", target))
        expect(held[0].originEpoch).toBe(0n)
      }),
    ),
  )

  it.live("compacts successful and suppressed continuations while retaining failed evidence", () =>
    withClosure(
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const session = SessionID.make("ses_continuation_settle")

        const acquireOne = Effect.gen(function* () {
          const handle = yield* owner
          const decision = yield* closure.acquire({
            session,
            origin: "internal",
            retry: "initial",
            source: "test.settle",
            owner: handle,
            kind: "continuation",
            caller: session,
            target: session,
            originEpoch: 0n,
          })
          if (decision.type !== "admitted") return yield* Effect.die("expected admission")
          return decision.lease
        })

        const retired = yield* acquireOne
        const suppressed = yield* acquireOne
        const failed = yield* acquireOne

        // Positive precondition: all three are live and indistinguishable before settlement, so the
        // differences asserted after are produced by the disposition and nothing else.
        const before = leasesFor(yield* closure.view, session)
        expect(before).toHaveLength(3)
        expect(before.every((item) => item.state === "reserved")).toBe(true)

        yield* closure.retire(retired)
        yield* closure.retire(suppressed, "suppressed")
        yield* closure.retire(failed, "failed")

        // Ordinary success/refusal rows are history and disappear. Failure remains a pre-fence
        // blocker even before an operation adopts it; a later closure must not prove quiescence by
        // forgetting a known owner defect.
        const after = leasesFor(yield* closure.view, session)
        expect(after.map((item) => item.id)).toEqual([failed])
        expect(after[0]?.state).toBe("failed")
      }),
    ),
  )

  it.live("refuses a second settlement, so a carried lease cannot be intermediately retired", () =>
    withClosure(
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const session = SessionID.make("ses_continuation_once")
        const handle = yield* owner

        const decision = yield* closure.acquire({
          session,
          origin: "internal",
          retry: "initial",
          source: "test.once",
          owner: handle,
          kind: "continuation",
          caller: session,
          target: session,
          originEpoch: 0n,
        })
        if (decision.type !== "admitted") return yield* Effect.die("expected admission")

        yield* closure.retire(decision.lease, "suppressed")
        // Positive precondition: the lease was present above and the first settlement removed its
        // terminal record, so the second call below is necessarily a late duplicate.
        expect(leasesFor(yield* closure.view, session)).toEqual([])

        // §7.2: the same lease object spans the whole chain and no intermediate retirement is
        // allowed. A later fork settling again must not overwrite the first disposition — which is
        // how a suppressed continuation could otherwise be laundered into a normal retirement.
        yield* closure.retire(decision.lease)
        expect(leasesFor(yield* closure.view, session)).toEqual([])
      }),
    ),
  )

  it.live("acquires force-fresh rather than reusing an ambient context for the same session", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_continuation_fresh")
      const acquired: SessionID[] = []
      const fake: SessionClosure.Interface = {
        ...unusedJobs,
        request: () => Effect.die("unused"),
        view: Effect.die("unused"),
        identity: Effect.die("unused"),
        acquire: (input) =>
          Effect.sync(() => {
            acquired.push(input.session)
            return {
              type: "admitted" as const,
              lease: Model.id("lease", `lease_${acquired.length}`),
              epoch: 0n,
              instance: Model.id("instance", "instance_fake"),
            }
          }),
        bind: () => Effect.void,
        retire: () => Effect.void,
        reserveMutation: () => Effect.die("unused"),
        activateMutation: () => Effect.void,
        retireMutation: () => Effect.void,
      }

      const ambient: SessionAdmission.Interface = {
        coordinator: Model.id("instance", "instance_ambient"),
        session,
        leases: [Model.id("lease", "lease_ambient")],
        kind: "pre_bind",
        epoch: 0n,
        origin: "external",
        retry: "initial",
      }

      yield* SessionAdmission.continuation(
        fake,
        { session, caller: session, target: session, source: "t" },
        () => Effect.void,
      ).pipe(Effect.provideService(SessionAdmission.Service, ambient))

      // The hazard this closes: Effect forks INHERIT context but are not joined, so a detached
      // observer can hold an ambient context whose lease the outer `ensuring` already retired. A
      // continuation that reused it would ride a settled lease and defeat its own accounting.
      expect(acquired).toEqual([session])
    }),
  )

  it.live("settles by outcome: completion retires, refusal suppresses, and a dead observer fails", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_continuation_outcome")
      const settled: { lease: Model.LeaseID; disposition?: SessionClosure.LeaseDisposition }[] = []
      let issued = 0
      const fake: SessionClosure.Interface = {
        ...unusedJobs,
        request: () => Effect.die("unused"),
        view: Effect.die("unused"),
        identity: Effect.die("unused"),
        acquire: () =>
          Effect.sync(() => {
            issued = issued + 1
            return {
              type: "admitted" as const,
              lease: Model.id("lease", `lease_${issued}`),
              epoch: 0n,
              instance: Model.id("instance", "instance_fake"),
            }
          }),
        bind: () => Effect.void,
        retire: (lease, disposition) => Effect.sync(() => void settled.push({ lease, disposition })),
        reserveMutation: () => Effect.die("unused"),
        activateMutation: () => Effect.void,
        retireMutation: () => Effect.void,
      }
      const run = <A, E>(body: Effect.Effect<A, E>) =>
        SessionAdmission.continuation(
          fake,
          { session, caller: session, target: session, source: "t" },
          () => body,
        ).pipe(Effect.exit)

      yield* run(Effect.void)
      yield* run(Effect.fail(new SessionClosure.AdmissionRefused({ session, reason: "closing" })))
      yield* run(Effect.die("observer died"))

      // Positive precondition: three distinct leases were issued and every one was settled exactly
      // once, so the dispositions below are attributable to the outcomes rather than to a lease
      // that was never settled or settled twice.
      expect(issued).toBe(3)
      expect(settled).toHaveLength(3)

      // §7.4's three outcomes, and the reason the disposition parameter exists at all: an observer
      // that DIED must not be indistinguishable from one that completed. A bare `retire` would
      // report all three as "retired", which is exactly what I-31 forbids.
      expect(settled.map((item) => item.disposition)).toEqual(["retired", "suppressed", "failed"])
    }),
  )

  // §7.4 requires the lease be acquired BEFORE the waiter/fiber is scheduled and settled INSIDE the
  // observer. The all-in-one `continuation` cannot express that ordering: wrapping it and forking
  // acquires inside the forked fiber, while forking inside its body settles the instant `forkIn`
  // returns — the intermediate retirement §7.2 forbids. `acquireContinuation` splits the two so the
  // caller forks `observe`, never the acquisition.
  it.live("acquires before the observer is scheduled and settles the same lease inside it", () =>
    withClosure(
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const caller = SessionID.make("ses_split_caller")
        const target = SessionID.make("ses_split_target")

        // Positive precondition: no lease exists yet, so the lease observed after acquisition is
        // this acquisition's and the ordering assertion below is meaningful.
        expect(leasesFor(yield* closure.view, caller)).toEqual([])

        const held = yield* SessionAdmission.acquireContinuation(closure, {
          session: caller,
          caller,
          target,
          source: "test.split",
        })

        // ORDERING: the lease is live before anything is forked. This is the half the API-half
        // helper could not demonstrate — acquisition has already happened at this point in the
        // caller's own fiber, so no waiter can be scheduled ahead of its accounting.
        const acquired = leasesFor(yield* closure.view, caller)
        expect(acquired).toHaveLength(1)
        expect(acquired[0]?.state).toBe("reserved")
        expect(acquired[0]?.kind).toBe("continuation")

        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const observer = yield* held
          .observe(
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return "delivered" as const
            }),
          )
          .pipe(Effect.forkScoped)

        yield* Deferred.await(entered)
        // SINGLE SETTLEMENT, INSIDE: the observer is genuinely running and the lease is still live.
        // A helper that settled when `forkIn` returned would already read "retired" here, which is
        // exactly the intermediate retirement that would let a release proceed while the
        // continuation can still continue.
        expect(leasesFor(yield* closure.view, caller)[0]?.state).toBe("reserved")

        yield* Deferred.succeed(release, undefined)
        expect(yield* Fiber.join(observer)).toBe("delivered")

        // The only pre-fork lease is gone after the observer exits. Together with the live sample
        // above, this proves the observer held its accounting through completion and left no second
        // or terminal record behind.
        const after = leasesFor(yield* closure.view, caller)
        expect(after).toEqual([])
      }),
    ),
  )

  it.live("derives the settlement disposition from the observer's exit rather than from its caller", () =>
    withClosure(
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const session = SessionID.make("ses_split_outcome")

        const observed = <A, E>(body: Effect.Effect<A, E>) =>
          Effect.gen(function* () {
            const held = yield* SessionAdmission.acquireContinuation(closure, {
              session,
              caller: session,
              target: session,
              source: "test.split.outcome",
            })
            const lease = leasesFor(yield* closure.view, session).find((item) => item.state === "reserved")!.id
            yield* held.observe(body).pipe(Effect.exit)
            return lease
          })

        const completed = yield* observed(Effect.succeed("ok"))
        const refused = yield* observed(
          Effect.fail(new SessionClosure.AdmissionRefused({ session, reason: "closing" })),
        )
        const died = yield* observed(Effect.die("observer died"))

        // Positive precondition: three distinct leases, so the differing states below are produced
        // by the three exits rather than by one lease being read three times.
        expect(new Set([completed, refused, died]).size).toBe(3)

        // `observe` computes the three dispositions from the exits. Successful and refused rows are
        // compacted, while the failed lease remains as the later-claim blocker I-31 requires.
        const after = leasesFor(yield* closure.view, session)
        const stateOf = (id: Model.LeaseID) => after.find((item) => item.id === id)?.state
        expect(stateOf(completed)).toBeUndefined()
        expect(stateOf(refused)).toBeUndefined()
        expect(stateOf(died)).toBe("failed")
      }),
    ),
  )
})

describe("continuation owner defects under a retained fence (CP-023 K84, I-32)", () => {
  it.live("turns a known owner defect into retained quiescence_failed without timing out the owner", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const driver: Ports.Driver = {
        run: (input) =>
          Effect.gen(function* () {
            const release = yield* Deferred.make<void>()
            yield* Queue.offer(runs, { input, release })
            yield* Deferred.await(release)
          }),
        command: () => Effect.void,
      }

      yield* withDriver(
        driver,
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const session = SessionID.make("ses_k84_owner_defect")
          const node = Model.id("session", session)
          const handle = yield* owner
          const decision = yield* closure.acquire({
            session,
            origin: "internal",
            retry: "initial",
            source: "test.k84.owner-defect",
            owner: handle,
            kind: "continuation",
            caller: session,
            target: session,
            originEpoch: 0n,
          })
          if (decision.type !== "admitted") return yield* Effect.die("expected continuation admission")

          const pending = yield* closure
            .request({
              root: session,
              runState: { assertNotBusy: () => Effect.void, cancel: () => Effect.void },
            })
            .pipe(Effect.forkScoped)
          const held = yield* Queue.take(runs)
          const claimed = yield* held.input.control.claim({
            operation: held.input.command.operation,
            proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
            signals: [Effect.succeed("success" as const)],
          })
          expect(claimed.decision).toEqual({ type: "applied" })

          // Positive precondition at the ownership boundary: this exact live lease belongs to this
          // exact retained operation before the owner defect is reported. Without both links, the
          // terminal state below could be an unrelated operation failure.
          const before = yield* closure.view
          const lease = before.leases.find((item) => item.id === decision.lease)
          const operation = before.operations.find((item) => item.id === held.input.command.operation)
          expect(lease?.operation).toBe(held.input.command.operation)
          expect(operation?.executionLeases).toContain(decision.lease)
          expect(before.fences.map((item) => item.session)).toEqual([node])
          expect(operation?.failure).toBeUndefined()

          // This is the coordinator-visible form of a known owner-fiber/adapter defect. I-32 does
          // not infer failure from elapsed time; it acts only when the owner reports a failed exit.
          yield* closure.retire(decision.lease, "failed")

          const after = yield* closure.view
          const failedLease = after.leases.find((item) => item.id === decision.lease)
          const failedOperation = after.operations.find((item) => item.id === held.input.command.operation)
          expect(failedLease?.state).toBe("failed")
          expect(failedOperation?.phase).toEqual({ type: "quiescence_failed" })
          expect(failedOperation?.failure?.kind).toBe("quiescence_failed")
          expect(after.fences.map((item) => item.session)).toEqual([node])

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )
})
