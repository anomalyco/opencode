import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Ref, Scope } from "effect"
import { BackgroundJob } from "@/background/job"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { WorkspaceRef } from "@/effect/instance-ref"
import { SessionAdmission } from "@/session/closure/admission"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionMutation } from "@/session/closure/mutation"
import { SessionReplayPermit } from "@/session/closure/replay-permit"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionRunState } from "@/session/run-state"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { unusedJobs } from "../lib/closure"
import { itBounded as it, pollWithTimeout } from "../lib/effect"

type HeldRun = { readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }

const reply = { info: { id: "msg_gate3_admission" }, parts: [] } as unknown as SessionV1.WithParts

const capability: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

describe("SessionAdmission refusal classification", () => {
  it.live("accepts only a pure typed refusal and rejects composite defect or interruption causes", () =>
    Effect.gen(function* () {
      const refusal = new SessionClosure.AdmissionRefused({
        session: SessionID.make("ses_refusal_classifier"),
        reason: "closing",
      })
      const pure = yield* Effect.fail(refusal).pipe(Effect.exit)
      const defect = yield* Effect.fail(refusal).pipe(Effect.ensuring(Effect.die("finalizer defect")), Effect.exit)
      const interrupted = yield* Effect.fail(refusal).pipe(Effect.ensuring(Effect.interrupt), Effect.exit)

      expect(Exit.isFailure(pure) && SessionAdmission.isAdmissionRefusal(pure.cause)).toBe(true)
      expect(Exit.isFailure(defect) && SessionAdmission.isAdmissionRefusal(defect.cause)).toBe(false)
      expect(Exit.isFailure(interrupted) && SessionAdmission.isAdmissionRefusal(interrupted.cause)).toBe(false)
    }),
  )
})

const heldDriver = (runs: Queue.Queue<HeldRun>): Ports.Driver => ({
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs, { input, release })
      yield* Deferred.await(release)
    }),
  command: () => Effect.void,
})

// SessionStatus is stubbed so this file proves the closure edge without dragging the EventV2
// chain in. The *real* SessionStatus/BackgroundJob chain under the new dependency is proved by
// `prompt.test.ts` and `attachment-final-request.test.ts`, which build it and stay green.
const statusStub = Layer.succeed(
  SessionStatus.Service,
  SessionStatus.Service.of({
    get: () => Effect.succeed({ type: "idle" as const }),
    list: () => Effect.succeed(new Map()),
    set: () => Effect.void,
  }),
)

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

// The node graph memoises every node, so the `SessionClosure.Service` the body resolves is the same
// instance `SessionRunState` and the job binder captured. That identity is what makes the fenced
// case below a real test rather than two unrelated coordinators agreeing by accident.
const withRunState = <A, E, R>(
  closure: Layer.Layer<SessionClosure.Service, never, never>,
  body: (directory: string) => Effect.Effect<A, E, R | SessionRunState.Service | SessionClosure.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    // `BackgroundJob` takes `SessionClosure` from the graph rather than beside it, so the binder and
    // the admission seam share ONE coordinator instance. The override list is what pins it.
    const graph = LayerNode.compile(
      LayerNode.group([SessionRunState.node, BackgroundJob.node, SessionClosure.node, SessionStatus.node]),
      [
        [SessionClosure.node, closure],
        [SessionStatus.node, statusStub],
      ],
    )
    return yield* body(directory).pipe(Effect.provide(graph), provideInstanceEffect(directory))
  }).pipe(Effect.provide(services))

const realClosure = (ports: Ports.RuntimePorts) =>
  SessionClosure.layer.pipe(
    Layer.provide(SessionToolPartPermit.layer),
    Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
  )

type Recorder = {
  readonly bound: Model.AdmissionOwner[]
  readonly retired: Model.LeaseID[]
}

// A coordinator whose admission answer is scripted, used only where the *seam's* reaction is under
// test rather than the model's. It records bind/retire so the lease lifecycle is observable
// without reaching into coordinator state.
const fakeClosure = (record: Recorder, acquire: SessionClosure.Interface["acquire"]) =>
  Layer.succeed(
    SessionClosure.Service,
    SessionClosure.Service.of({
      ...unusedJobs,
      request: () => Effect.die("unused"),
      view: Effect.die("unused"),
      identity: Effect.die("unused"),
      acquire,
      bind: (_lease, owner) => Effect.sync(() => void record.bound.push(owner)),
      retire: (lease) => Effect.sync(() => void record.retired.push(lease)),
      reserveMutation: () => Effect.die("unused"),
      activateMutation: () => Effect.void,
      retireMutation: () => Effect.void,
    }),
  )

const admits: SessionClosure.Interface["acquire"] = () =>
  Effect.succeed({
    type: "admitted",
    lease: Model.id("lease", "lease_fake"),
    epoch: 0n,
    instance: Model.id("instance", "instance_fake"),
  })

const leaseOf = (view: Model.View, session: Model.SessionID) => view.leases.filter((item) => item.session === session)

type Calls = {
  readonly acquired: SessionID[]
  readonly bound: Model.AdmissionOwner[]
  readonly retired: Model.LeaseID[]
}

const calls = (): Calls => ({ acquired: [], bound: [], retired: [] })

// `admitted` takes the coordinator as a plain parameter, so the context-reuse rules can be tested
// directly with no layer machinery. `acquired` is the discriminator: a pass-through leaves it
// untouched, a fresh decision appends to it.
const fakeInterface = (record: Calls, acquire: SessionClosure.Interface["acquire"]): SessionClosure.Interface => ({
  ...unusedJobs,
  request: () => Effect.die("unused"),
  view: Effect.die("unused"),
  identity: Effect.die("unused"),
  acquire: (input) => {
    record.acquired.push(input.session)
    return acquire(input)
  },
  bind: (_lease, owner) => Effect.sync(() => void record.bound.push(owner)),
  retire: (lease) => Effect.sync(() => void record.retired.push(lease)),
  reserveMutation: () => Effect.die("unused"),
  activateMutation: () => Effect.void,
  retireMutation: () => Effect.void,
})

const fencedAcquire: SessionClosure.Interface["acquire"] = () =>
  Effect.succeed({
    type: "fenced",
    state: "closing",
    operation: Model.id("operation", "operation_fenced"),
    epoch: 0n,
  })

const ambientFor = (session: SessionID): SessionAdmission.Interface => ({
  coordinator: Model.id("instance", "instance_ambient"),
  session,
  leases: [Model.id("lease", "lease_ambient")],
  kind: "pre_bind",
  epoch: 0n,
  origin: "external",
  retry: "initial",
})

class FifoSentinel extends Context.Service<FifoSentinel, string>()("@opencode/test/FifoSentinel") {}

describe("SessionRunState closure admission (CP-023 Gate 3)", () => {
  it.live("admits an unfenced session, binds the lease to the Runner, and retires it after", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
      const session = SessionID.make("ses_gate3_admits")
      const node = Model.id("session", session)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const state = yield* SessionRunState.Service
          const observed = yield* Ref.make<Model.LeaseView[]>([])

          // Positive precondition: the coordinator is reachable and holds no fence and no lease,
          // so everything asserted below is attributable to this call.
          expect((yield* closure.view).fences).toEqual([])
          expect(leaseOf(yield* closure.view, node)).toEqual([])

          // Assert at the stage's own boundary: sample the lease from *inside* the work, which is
          // the only moment the bound state exists. A post-hoc assertion would see only `retired`
          // and could not distinguish "bound then retired" from "never bound".
          const work = Effect.gen(function* () {
            yield* Ref.set(observed, leaseOf(yield* closure.view.pipe(Effect.orDie), node))
            return reply
          })

          const result = yield* state.ensureRunning(session, Effect.succeed(reply), work)
          expect(result).toBe(reply)

          const during = yield* Ref.get(observed)
          expect(during).toHaveLength(1)
          expect(during[0]?.state).toBe("bound")
          expect(during[0]?.kind).toBe("pre_bind")
          expect(during[0]?.origin).toBe("internal")
          // Owner replacement: the reserve-time admission scope has been replaced by the Runner
          // identity exactly once.
          expect(during[0]?.owner).toEqual({ type: "scope", id: Model.id("scope", `runner:${session}`) })

          const after = leaseOf(yield* closure.view, node)
          // The ordinary retired record is no longer a process-lifetime history row. The bound
          // sample above proves the exact lease was live for the work; absence here proves its
          // finalizer both settled and compacted that record.
          expect(after).toEqual([])
          expect(yield* Queue.size(runs)).toBe(0)
        }),
      )
    }),
  )

  it.live("retires natural map authority before sequential replacement discovery and cancellation (CP-033)", () =>
    Effect.gen(function* () {
      const record: Recorder = { bound: [], retired: [] }
      const session = SessionID.make("ses_cp033_sequential_reentry")

      yield* withRunState(fakeClosure(record, admits), () =>
        Effect.gen(function* () {
          const state = yield* SessionRunState.Service

          // The exact onIdle-before-result ordering is proved at Runner's baseline oracle because
          // SessionRunState intentionally exposes no production hook into its map-retirement callback.
          // This production-layer continuation proves the resulting authority remains observable.
          expect(yield* state.ensureRunning(session, Effect.succeed(reply), Effect.succeed(reply))).toBe(reply)
          expect((yield* state.listActive()).some((entry) => entry.session === session)).toBe(false)

          const replacementStarted = yield* Deferred.make<void>()
          const replacementRelease = yield* Deferred.make<void>()
          yield* Effect.addFinalizer(() => Deferred.succeed(replacementRelease, undefined).pipe(Effect.asVoid))
          const replacement = yield* state
            .ensureRunning(
              session,
              Effect.succeed(reply),
              Deferred.succeed(replacementStarted, undefined).pipe(
                Effect.asVoid,
                Effect.andThen(Deferred.await(replacementRelease)),
                Effect.as(reply),
              ),
            )
            .pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.await(replacementStarted)

          expect(yield* state.listActive()).toContainEqual({
            session,
            running: true,
            shell: false,
          })
          expect(Exit.isFailure(yield* state.assertNotBusy(session).pipe(Effect.exit))).toBe(true)
          expect(yield* state.interruptRunner(session)).toBe(true)
          expect(yield* Fiber.join(replacement)).toBe(reply)
          expect((yield* state.listActive()).some((entry) => entry.session === session)).toBe(false)
          expect(record.retired).toHaveLength(2)
        }),
      )
    }),
  )

  it.live("refuses ensureRunning and startShell for a fenced session and never starts the work", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
      const root = SessionID.make("ses_gate3_fenced")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const state = yield* SessionRunState.Service
          const ran = yield* Ref.make(false)
          const work = Ref.set(ran, true).pipe(Effect.as(reply))
          const control = SessionID.make("ses_gate3_control")

          // Positive precondition A: this exact session, through this exact seam, admits and runs
          // before the fence exists. Without it a later refusal could come from a guard that
          // refuses unconditionally, or from a harness that never wired the seam at all.
          expect(yield* state.ensureRunning(control, Effect.succeed(reply), work)).toBe(reply)
          expect(yield* Ref.get(ran)).toBe(true)
          yield* Ref.set(ran, false)

          // Publish an exact F entry while the session is still open, but keep its wrapper release
          // closed. This is the accepted-but-not-selected side of T-13's fence-while-queued race.
          const release = yield* Deferred.make<void>()
          const publication = yield* state.publish(root, Effect.succeed(reply), work, release)
          expect(publication.type).toBe("published")
          expect((yield* state.listActive()).map((item) => item.session)).toContain(root)

          const pending = yield* closure.request({ root, runState: capability }).pipe(Effect.forkScoped)
          const held = yield* Queue.take(runs)
          const claimed = yield* held.input.control.claim({
            operation: held.input.command.operation,
            proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
            signals: [Effect.succeed("success" as const)],
          })

          // Positive precondition B: the claim applied and a fence for this exact session exists.
          expect(claimed.decision).toEqual({ type: "applied" })
          const fences = (yield* closure.view).fences
          expect(fences.map((item) => item.session)).toEqual([node])
          const fenceState = fences[0]!.state

          // Selection now opens behind the standing fence. The fresh execution admission refuses
          // before the work body, while the already-accepted F barrier receives that exact error.
          yield* Deferred.succeed(release, undefined)
          const selected = yield* state.awaitPublished(publication).pipe(Effect.flip)
          expect(selected._tag).toBe("SessionClosureAdmissionRefused")
          if (selected._tag !== "SessionClosureAdmissionRefused")
            return yield* Effect.die("expected a selected admission refusal")
          expect(selected.session).toBe(root)
          expect(selected.reason).toBe(fenceState)

          const refused = yield* state.ensureRunning(root, Effect.succeed(reply), work).pipe(Effect.flip)
          // Narrow explicitly rather than lean on `expect`, which does not narrow. The seam's error
          // is now a union with the destructive-mutation refusal, and `session` exists on only one
          // arm — so reaching it without narrowing would be a type error masquerading as a passing
          // assertion.
          expect(refused._tag).toBe("SessionClosureAdmissionRefused")
          if (refused._tag !== "SessionClosureAdmissionRefused")
            return yield* Effect.die("expected an admission refusal")
          expect(refused.session).toBe(root)
          expect(refused.reason).toBe(fenceState)

          const shell = yield* state.startShell(root, Effect.succeed(reply), work).pipe(Effect.flip)
          expect(shell._tag).toBe("SessionClosureAdmissionRefused")

          // The refusal is an admission decision, not merely a returned error: neither seam handed
          // the work to a Runner.
          expect(yield* Ref.get(ran)).toBe(false)

          // The refused reservations are still *recorded* as suppressed against the operation.
          // That accounting is what release consumes when it must complete or suppress every
          // affected continuation lease; refusing before reserving would erase it.
          const post = leaseOf(yield* closure.view, node)
          const suppressed = post.filter((item) => item.state === "suppressed")
          expect(suppressed).toHaveLength(3)
          expect(suppressed.every((item) => item.origin === "internal")).toBe(true)

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("discovers and physically cancels a genuinely queued F behind a fenced predecessor (CP-033 T-13)", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
      const root = SessionID.make("ses_cp033_queued_fence")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const state = yield* SessionRunState.Service
          const predecessorStarted = yield* Deferred.make<void>()
          const predecessorRelease = yield* Deferred.make<void>()
          const providerCalls = yield* Ref.make(0)
          yield* Effect.addFinalizer(() => Deferred.succeed(predecessorRelease, undefined).pipe(Effect.asVoid))

          const predecessor = yield* state
            .ensureRunning(
              root,
              Effect.succeed(reply),
              Deferred.succeed(predecessorStarted, undefined).pipe(
                Effect.asVoid,
                Effect.andThen(Deferred.await(predecessorRelease)),
                Effect.as(reply),
              ),
            )
            .pipe(Effect.forkChild({ startImmediately: true }))
          yield* Deferred.await(predecessorStarted)

          const release = yield* Deferred.make<void>()
          yield* Deferred.succeed(release, undefined)
          const publication = yield* state.publish(
            root,
            Effect.succeed(reply),
            Ref.update(providerCalls, (count) => count + 1).pipe(Effect.as(reply)),
            release,
          )
          expect(publication.type).toBe("published")
          if (publication.type !== "published") return yield* Effect.die("expected queued F publication")
          expect(yield* Deferred.isDone(publication.done)).toBe(false)
          expect(yield* state.listActive()).toContainEqual({ session: root, running: true, shell: false })

          const pending = yield* closure.request({ root, runState: capability }).pipe(Effect.forkScoped)
          const held = yield* Queue.take(runs)
          yield* Effect.addFinalizer(() => Deferred.succeed(held.release, undefined).pipe(Effect.asVoid))
          const claimed = yield* held.input.control.claim({
            operation: held.input.command.operation,
            proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
            signals: [Effect.succeed("success" as const)],
          })
          expect(claimed.decision).toEqual({ type: "applied" })
          expect((yield* closure.view).fences.map((item) => item.session)).toEqual([node])

          // Discovery sees the live predecessor/F queue, and the exact physical seam cancels that
          // generation before the queued body can acquire execution admission or reach its provider.
          const discovered = yield* state.listActive()
          expect(discovered).toContainEqual({ session: root, running: true, shell: false })
          expect(yield* state.interruptRunner(root)).toBe(true)
          expect(yield* state.awaitPublished(publication)).toBe(reply)
          expect(yield* Fiber.join(predecessor)).toBe(reply)
          expect(yield* Ref.get(providerCalls)).toBe(0)
          expect((yield* state.listActive()).some((entry) => entry.session === root)).toBe(false)
          expect(yield* state.interruptRunner(root)).toBe(false)

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("fails closed when the coordinator answers with a location error, and never binds", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_gate3_misrouted")
      const misrouted = new Ports.LocationError({ expected: "expected-instance", actual: "actual-instance" })
      const control: Recorder = { bound: [], retired: [] }
      const failing: Recorder = { bound: [], retired: [] }

      // Positive control: identical seam and layer shape with an admitting coordinator. This is
      // what makes the refusal below attributable to the LocationError rather than the harness.
      yield* withRunState(fakeClosure(control, admits), () =>
        Effect.gen(function* () {
          const state = yield* SessionRunState.Service
          expect(yield* state.ensureRunning(session, Effect.succeed(reply), Effect.succeed(reply))).toBe(reply)
        }),
      )
      expect(control.bound).toEqual([{ type: "scope", id: Model.id("scope", `runner:${session}`) }])
      expect(control.retired).toEqual([Model.id("lease", "lease_fake")])

      yield* withRunState(
        fakeClosure(failing, () => Effect.fail(misrouted)),
        () =>
          Effect.gen(function* () {
            const state = yield* SessionRunState.Service
            const ran = yield* Ref.make(false)
            const refused = yield* state
              .ensureRunning(session, Effect.succeed(reply), Ref.set(ran, true).pipe(Effect.as(reply)))
              .pipe(Effect.flip)
            expect(refused._tag).toBe("SessionClosureAdmissionRefused")
            if (refused._tag !== "SessionClosureAdmissionRefused") return
            // A misroute stays distinguishable from a fence rather than being reported as one.
            expect(refused.reason).toBe("wrong_instance")
            expect(yield* Ref.get(ran)).toBe(false)
          }),
      )
      // Nothing was admitted, so nothing was bound, and there is no lease to retire.
      expect(failing.bound).toEqual([])
      expect(failing.retired).toEqual([])
    }),
  )

  it.live("retires the lease when the admitted body fails, not only when it succeeds", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_gate3_finalizer")
      const record: Recorder = { bound: [], retired: [] }
      // A refusal raised by the *work* itself — what a subtask admission refused mid-loop looks
      // like to this seam — so no cast is needed to put it in the declared channel.
      const boom = new SessionClosure.AdmissionRefused({ session, reason: "closure_unavailable" })

      // This is the property IR-1 depends on: `prompt` acquires at entry, and its private
      // attachment-scope mismatch check can die before the body completes. Retirement lives in a
      // finalizer precisely so that defect releases rather than stranding the lease.
      yield* withRunState(fakeClosure(record, admits), () =>
        Effect.gen(function* () {
          const state = yield* SessionRunState.Service
          const failed = yield* state.ensureRunning(session, Effect.succeed(reply), Effect.fail(boom)).pipe(Effect.exit)
          expect(failed._tag).toBe("Failure")
        }),
      )
      expect(record.retired).toEqual([Model.id("lease", "lease_fake")])
    }),
  )
})

// The context-reuse rules, and the property that makes the `handleSubtask` seam correct. These are
// asserted at `admitted`'s own boundary rather than through the prompt pipeline, because a later
// stage there would mask a defect in this one.
describe("SessionAdmission context reuse", () => {
  it.live("reuses an ambient context for the same session instead of taking a second lease", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_ambient_reuse")
      const record = calls()
      const closure = fakeInterface(record, admits)
      const ran = yield* Ref.make(0)
      const bump = () => Ref.update(ran, (n) => n + 1)

      // Positive precondition: with no ambient context this same call does consult the
      // coordinator. Without it, "did not consult" below could just mean the seam never runs.
      yield* SessionAdmission.admitted(closure, { session, origin: "internal", source: "t" }, bump)
      expect(record.acquired).toEqual([session])

      yield* SessionAdmission.admitted(closure, { session, origin: "internal", source: "t" }, bump).pipe(
        Effect.provideService(SessionAdmission.Service, ambientFor(session)),
      )
      // Still one acquisition: `prompt -> loop -> ensureRunning` is one logical admission, not
      // three duplicate leases for the same side effect.
      expect(record.acquired).toEqual([session])
      expect(yield* Ref.get(ran)).toBe(2)
    }),
  )

  it.live("reuseAmbient:false forces a fresh decision inside an already-admitted chain", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_ambient_recheck")
      const record = calls()
      const closure = fakeInterface(record, fencedAcquire)
      const ran = yield* Ref.make(false)

      // This first half *is* the hazard `handleSubtask` faces: a fence raised mid-loop, an ambient
      // lease already held, and the body running anyway because nothing re-checked.
      yield* SessionAdmission.admitted(closure, { session, origin: "internal", source: "t" }, () =>
        Ref.set(ran, true),
      ).pipe(Effect.provideService(SessionAdmission.Service, ambientFor(session)))
      expect(record.acquired).toEqual([])
      expect(yield* Ref.get(ran)).toBe(true)

      // With the flag the seam ignores the ambient context, consults, and refuses — so the next
      // subtask does not start.
      yield* Ref.set(ran, false)
      const refused = yield* SessionAdmission.admitted(
        closure,
        { session, origin: "internal", source: "t", reuseAmbient: false },
        () => Ref.set(ran, true),
      ).pipe(Effect.provideService(SessionAdmission.Service, ambientFor(session)), Effect.flip)

      expect(refused._tag).toBe("SessionClosureAdmissionRefused")
      expect(refused.reason).toBe("closing")
      expect(record.acquired).toEqual([session])
      expect(yield* Ref.get(ran)).toBe(false)
    }),
  )

  it.live("does not let a different session inherit an ambient context", () =>
    Effect.gen(function* () {
      const parent = SessionID.make("ses_ambient_parent")
      const child = SessionID.make("ses_ambient_child")
      const record = calls()
      const closure = fakeInterface(record, admits)

      yield* SessionAdmission.admitted(
        closure,
        { session: child, origin: "internal", source: "t" },
        () => Effect.void,
      ).pipe(Effect.provideService(SessionAdmission.Service, ambientFor(parent)))

      // A Task target or subtask child is a new logical admission; inheriting here would let it
      // ride the parent's fence-freedom.
      expect(record.acquired).toEqual([child])
    }),
  )
})

describe("SessionRunState exact FIFO context (CP-033 T-06)", () => {
  it.live("retains queuer services and refs while replacing stale authority and Scope", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_cp033_context")
      const workspace = WorkspaceV2.ID.make("wrk_cp033_context")
      const acquired = yield* Ref.make(0)
      const record: Recorder = { bound: [], retired: [] }
      const acquire: SessionClosure.Interface["acquire"] = () =>
        Ref.modify(acquired, (current) => [current + 1, current + 1] as const).pipe(
          Effect.map((sequence) => ({
            type: "admitted" as const,
            lease: Model.id("lease", `lease_cp033_${sequence}`),
            epoch: 0n,
            instance: Model.id("instance", "instance_cp033"),
          })),
        )

      yield* withRunState(fakeClosure(record, acquire), (directory) =>
        Effect.gen(function* () {
          const state = yield* SessionRunState.Service
          const closure = yield* SessionClosure.Service
          const callerScope = yield* Scope.Scope
          const release = yield* Deferred.make<void>()
          const entered = yield* Deferred.make<void>()
          const scopeClosed = yield* Deferred.make<void>()
          const work = Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            const admission = yield* Effect.serviceOption(SessionAdmission.Service)
            const mutation = yield* Effect.serviceOption(SessionMutation.Active)
            const replay = yield* Effect.serviceOption(SessionReplayPermit.Service)
            const sentinel = yield* Effect.serviceOption(FifoSentinel)
            const generation = yield* Effect.serviceOption(Scope.Scope)
            const instance = yield* InstanceState.context
            const observedWorkspace = yield* WorkspaceRef
            const observedAls = yield* EffectBridge.fromPromise(() => WorkspaceContext.workspaceID)

            expect(Option.isSome(admission)).toBe(true)
            if (Option.isSome(admission)) {
              expect(admission.value.leases).toEqual([Model.id("lease", "lease_cp033_1")])
              expect(admission.value.leases).not.toEqual(ambientFor(session).leases)
            }
            expect(Option.isNone(mutation)).toBe(true)
            expect(Option.isNone(replay)).toBe(true)
            expect(Option.isSome(sentinel) ? sentinel.value : undefined).toBe("retained")
            expect(Option.isSome(generation)).toBe(true)
            if (Option.isSome(generation)) {
              expect(generation.value).not.toBe(callerScope)
              yield* Scope.addFinalizer(generation.value, Deferred.succeed(scopeClosed, undefined))
            }
            expect(instance.directory).toBe(directory)
            expect(observedWorkspace).toBe(workspace)
            expect(observedAls).toBe(workspace)

            // The selected work's fresh execution lease is ambient for nested same-Session work.
            yield* SessionAdmission.admitted(
              closure,
              { session, origin: "internal", source: "cp033.nested" },
              () => Effect.void,
            )
            return reply
          })

          const publication = yield* state
            .publish(session, Effect.succeed(reply), work, release)
            .pipe(
              Effect.provideService(SessionAdmission.Service, ambientFor(session)),
              Effect.provideService(SessionMutation.Active, { sessions: new Set([session]) }),
              Effect.provideService(SessionReplayPermit.Service, { aggregates: new Set([session]) }),
              Effect.provideService(FifoSentinel, "retained"),
              Effect.provideService(WorkspaceRef, workspace),
            )
          expect(publication.type).toBe("published")
          expect(yield* Deferred.isDone(entered)).toBe(false)

          yield* Deferred.succeed(release, undefined)
          expect(yield* state.awaitPublished(publication)).toBe(reply)
          yield* Deferred.await(scopeClosed)
          expect(yield* Ref.get(acquired)).toBe(1)
          expect(record.bound).toEqual([{ type: "scope", id: Model.id("scope", `runner:${session}`) }])
          expect(record.retired).toEqual([Model.id("lease", "lease_cp033_1")])
        }),
      )
    }),
  )
})

// CP-023 Gate 3 Slice H1 — the signalable pre-bind owner (I-32).
//
// A pre-bind "owner" that is only an opaque NAME (`scope_<uuid>`) cannot be reached by a fence
// landing during plugin/template/command/prompt/shell setup, so "immediately binds it to an
// interruptible admission fiber/scope" would be satisfied in vocabulary only. These tests assert
// the mechanism, not the vocabulary.
//
// Every body below is deliberately parked on a Deferred, because the property under test is
// exactly "does a fence reach work that is still in flight". `itBounded` turns a failure to reach
// it into a fast 3s failure rather than a wedged runner.

const inflightPorts = () =>
  Effect.gen(function* () {
    const runs = yield* Queue.unbounded<HeldRun>()
    const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
    return { runs, ports }
  })

const raiseFence = (
  closure: SessionClosure.Interface,
  runs: Queue.Queue<HeldRun>,
  root: SessionID,
  node: Model.SessionID,
) =>
  Effect.gen(function* () {
    const pending = yield* closure.request({ root, runState: capability }).pipe(Effect.forkScoped)
    const held = yield* Queue.take(runs)
    const claimed = yield* held.input.control.claim({
      operation: held.input.command.operation,
      proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
      signals: [Effect.succeed("success" as const)],
    })
    expect(claimed.decision).toEqual({ type: "applied" })
    expect((yield* closure.view).fences.map((item) => item.session)).toEqual([node])
    return { pending, held }
  })

describe("SessionAdmission signalable pre-bind owner", () => {
  it.live("interrupts an in-flight pre-bind owner when a fence lands", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_h1_interrupts")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const entered = yield* Deferred.make<void>()
          const blocker = yield* Deferred.make<void>()
          const interrupted = yield* Ref.make(false)
          const completed = yield* Ref.make(false)

          // Positive precondition A: nothing is fenced, so anything observed below is attributable
          // to the fence this test raises rather than to leftover state.
          expect((yield* closure.view).fences).toEqual([])

          const inflight = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "external", source: "test.h1.interrupts" },
            () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(blocker)
                yield* Ref.set(completed, true)
                return reply
              }).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true))),
          ).pipe(Effect.forkScoped)

          // Positive precondition B: the setup is genuinely IN FLIGHT — the body has started and
          // is parked. Without this the interrupt assertion could pass against work that never ran.
          yield* Deferred.await(entered)
          const before = leaseOf(yield* closure.view, node)
          expect(before).toHaveLength(1)
          expect(before[0]?.kind).toBe("pre_bind")
          expect(before[0]?.state).not.toBe("retired")

          const { pending, held } = yield* raiseFence(closure, runs, root, node)

          // The load-bearing claim: the fence REACHED the in-flight owner. Before H1 this join
          // never settles and the 3s bound fails the test.
          yield* Fiber.join(inflight).pipe(Effect.exit)
          expect(yield* Ref.get(interrupted)).toBe(true)
          expect(yield* Ref.get(completed)).toBe(false)

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )

  it.live("control: the same in-flight owner runs to completion when nothing fences it", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_h1_control")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const entered = yield* Deferred.make<void>()
          const blocker = yield* Deferred.make<void>()
          const interrupted = yield* Ref.make(false)
          const completed = yield* Ref.make(false)

          const inflight = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "external", source: "test.h1.control" },
            () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(blocker)
                yield* Ref.set(completed, true)
                return reply
              }).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true))),
          ).pipe(Effect.forkScoped)

          yield* Deferred.await(entered)
          // Positive precondition for the interrupt test above: this exact shape, unfenced, does
          // complete. Without it "interrupted" could merely mean the harness never let it finish.
          yield* Deferred.succeed(blocker, undefined)
          expect(yield* Fiber.join(inflight)).toBe(reply)
          expect(yield* Ref.get(completed)).toBe(true)
          expect(yield* Ref.get(interrupted)).toBe(false)
          expect(yield* Queue.size(runs)).toBe(0)
        }),
      )
    }),
  )

  // WHAT THIS TEST DOES AND DOES NOT DISCRIMINATE, established by mutation rather than assumed.
  //
  // It proves an interrupted owner's finalizer can call back into the coordinator and COMPLETE —
  // i.e. the shipped configuration has no finalizer/authority-lock deadlock. That is real: the
  // deadlock class it guards against wedges the runner instead of failing.
  //
  // It does NOT prove the flush must sit outside the lock. Moving the flush INSIDE the permit was
  // mutated and this test stayed green, because `Deferred.succeed` does not run the awaiting
  // fiber's continuation inline: the `raceFirst` watcher resumes on its own fiber, after the
  // permit is released. The safety is therefore inherent to the signalling primitive, and the
  // outside-the-lock ordering in `locked` is defence in depth — it is what would save this if the
  // primitive were ever swapped for one that resumes synchronously, such as a plain callback.
  it.live("lets an interrupted owner's finalizer call back into the coordinator", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_h1_finalizer")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const entered = yield* Deferred.make<void>()
          const blocker = yield* Deferred.make<void>()
          const finalized = yield* Ref.make(false)

          const inflight = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "external", source: "test.h1.finalizer" },
            () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(blocker)
                return reply
              }).pipe(
                // The hazard this test exists for: `store` runs under the authority lock, and
                // `locked` is the same semaphore every coordinator call takes. If signalling ran
                // the interrupted fiber's finalizers inline under that lock, this `view` would
                // deadlock. It fails fast at the 3s bound rather than wedging the runner.
                Effect.onInterrupt(() =>
                  closure.view.pipe(
                    Effect.flatMap(() => Ref.set(finalized, true)),
                    Effect.orDie,
                  ),
                ),
              ),
          ).pipe(Effect.forkScoped)

          yield* Deferred.await(entered)
          const { pending, held } = yield* raiseFence(closure, runs, root, node)

          yield* Fiber.join(inflight).pipe(Effect.exit)
          // The finalizer both RAN and completed a coordinator call that needs the lock.
          expect(yield* Ref.get(finalized)).toBe(true)

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )

  // HONEST SCOPE OF THIS TEST: it passed BEFORE H1 existed, because with no signalling at all the
  // coordinator is trivially responsive and the lease trivially unretired. It is therefore NOT
  // evidence that the signalable owner works — the two tests above are. Its job is to stay green
  // afterwards: it fails if anyone later makes the signalling path await the owner's unwinding or
  // attaches a timeout to it, both of which are forbidden. A regression guard, not a proof.
  it.live("does not wait for an unresponsive owner and never times it out", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_h1_unresponsive")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const entered = yield* Deferred.make<void>()
          const blocker = yield* Deferred.make<void>()

          // An owner that cannot answer the signal. There is NO finite-liveness promise here, and
          // elapsed time may not convert a lease to retirement, so the coordinator must neither
          // block on it nor time it out.
          const inflight = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "external", source: "test.h1.unresponsive" },
            () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(blocker)
                return reply
              }).pipe(Effect.uninterruptible),
          ).pipe(Effect.forkScoped)

          yield* Deferred.await(entered)
          const { pending, held } = yield* raiseFence(closure, runs, root, node)

          // The coordinator stayed responsive while the owner is unresolved: this call needs the
          // authority lock and returns. The fence remains, and the lease is NOT retired — it is
          // pending, which is exactly "remains pending and fenced".
          const view = yield* closure.view
          expect(view.fences.map((item) => item.session)).toEqual([node])
          const during = leaseOf(view, node)
          expect(during).toHaveLength(1)
          expect(during[0]?.state).not.toBe("retired")

          // Release the owner so the scope tears down cleanly.
          yield* Deferred.succeed(blocker, undefined)
          yield* Fiber.join(inflight).pipe(Effect.exit)
          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )
})

// The external branch of refusal accounting.
//
// `Model.reserveLease` splits a fenced reservation by origin: an internal one is recorded
// `suppressed` and attached to the operation, an external one is adopted `reserved` and JOINED to
// it. The seam then refuses both identically, and the external lease is never settled — release
// must complete or suppress every affected lease, and a permanently `reserved` one can satisfy
// neither.
describe("SessionAdmission external refusal lease accounting", () => {
  it.live("leaves no live lease behind when a fence refuses an external admission", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_j_external_leak")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const { pending, held } = yield* raiseFence(closure, runs, root, node)
          const ran = yield* Ref.make(0)
          const bump = () => Ref.update(ran, (n) => n + 1)

          // POSITIVE PRECONDITION. The internal polarity on this same fence settles terminally:
          // the model writes `suppressed`, which is a settled state. So the harness observes lease
          // state correctly, the fence is real, and any live lease found below is specific to the
          // external path rather than an artefact of refusal in general.
          const internal = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "internal", source: "test.j.internal" },
            bump,
          ).pipe(Effect.flip)
          expect(internal._tag).toBe("SessionClosureAdmissionRefused")
          const afterInternal = leaseOf(yield* closure.view, node)
          expect(afterInternal).toHaveLength(1)
          expect(afterInternal[0]?.state).toBe("suppressed")

          // `retryable: false` is the seam class that must refuse rather than wait, because retrying
          // it would resume a blocked tool inside a closed branch. It is also the only external shape
          // that still REFUSES, which makes it the exact case where an abandoned adopted lease would
          // go unnoticed.
          const external = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "external", source: "test.j.external", retryable: false },
            bump,
          ).pipe(Effect.flip)
          expect(external._tag).toBe("SessionClosureAdmissionRefused")

          // Neither body ran — the refusal is real on both polarities.
          expect(yield* Ref.get(ran)).toBe(0)

          // THE DEFECT. The external reservation is adopted onto the operation as `reserved` and
          // nothing ever settles it, so quiescence can never be proved for this branch.
          const live = leaseOf(yield* closure.view, node).filter(
            (item) => item.state === "reserved" || item.state === "bound",
          )
          expect(live).toHaveLength(0)

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )

  // The polarity rule, against the REAL coordinator and a REAL fence. Internal rejects or becomes
  // cancellation-owned and never waits; external joins and waits. This is load-bearing rather than
  // inert because a Task-internal prompt recording `external` would acquire the waiting semantics
  // internal admissions are forbidden.
  it.live("refuses an internal admission immediately while an external one waits on the same fence", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_j_polarity")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const { pending, held } = yield* raiseFence(closure, runs, root, node)
          const ran = yield* Ref.make(0)
          const bump = () => Ref.update(ran, (n) => n + 1)

          // INTERNAL. This fence is never released in this test, so anything that waits would hit
          // itBounded's 3s bound. Returning at all is the assertion.
          const refused = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "internal", source: "test.j.polarity.internal" },
            bump,
          ).pipe(Effect.flip)
          expect(refused._tag).toBe("SessionClosureAdmissionRefused")
          expect(refused.reason).toBe("closing")
          expect(yield* Ref.get(ran)).toBe(0)

          // EXTERNAL, same fence, same instant. Forked because it is expected NOT to return.
          const external = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "external", source: "test.j.polarity.external" },
            bump,
          ).pipe(Effect.forkScoped)

          // It genuinely reached the JOIN rather than being stuck earlier: the model adopted its
          // lease onto the intersecting operation as `reserved` at `initial`. Polled rather than
          // slept, so this is a happens-after fact and not a timing guess.
          const adopted = yield* pollWithTimeout(
            closure.view.pipe(
              Effect.map((view) =>
                view.leases.find((item) => item.source === "test.j.polarity.external" && item.state === "reserved"),
              ),
            ),
            "external admission never joined the intersecting operation",
          )
          expect(adopted.retry).toBe("initial")
          expect(adopted.operation).toBeDefined()

          // The discriminator. Same fence, same moment: the internal one is already refused above
          // while this one has neither refused nor run its body.
          expect(yield* Ref.get(ran)).toBe(0)
          const parked = yield* Fiber.join(external).pipe(
            Effect.timeoutOrElse({ duration: "150 millis", orElse: () => Effect.succeed("parked" as const) }),
          )
          expect(parked).toBe("parked")
          expect(yield* Ref.get(ran)).toBe(0)

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )
})

// The join-and-retry clauses at their OWN boundary. Release is driven here rather than through the
// real coordinator deliberately: reaching `release.commit` needs the operation phase machinery the
// coordinator owns, so a real-coordinator wake is not available at this seam. What is under test is
// `admission.ts`'s contract — wait before the body, retry once, carry the adopted lease back — and a
// scripted coordinator is the instrument that can state it exactly.
type JoinScript = {
  readonly acquired: Array<{ retry: string; origin: string; lease?: Model.LeaseID }>
  readonly retired: Array<{ lease: Model.LeaseID; disposition?: string }>
}

const joinedLease = Model.id("lease", "lease_j_joined")

const joiningClosure = (
  script: JoinScript,
  release: Deferred.Deferred<void>,
  second: SessionClosure.Interface["acquire"],
): SessionClosure.Interface => ({
  ...unusedJobs,
  request: () => Effect.die("unused"),
  view: Effect.die("unused"),
  identity: Effect.die("unused"),
  acquire: (input) =>
    Effect.suspend(() => {
      script.acquired.push({ retry: input.retry, origin: input.origin, lease: input.lease })
      if (script.acquired.length > 1) return second(input)
      return Effect.succeed<SessionClosure.Admission>({
        type: "joined" as const,
        lease: joinedLease,
        state: "closing" as const,
        operation: Model.id("operation", "operation_j"),
        epoch: 0n,
        instance: Model.id("instance", "instance_j"),
        release: Deferred.await(release),
      })
    }),
  bind: () => Effect.void,
  retire: (lease, disposition) => Effect.sync(() => void script.retired.push({ lease, disposition })),
  reserveMutation: () => Effect.die("unused"),
  activateMutation: () => Effect.void,
  retireMutation: () => Effect.void,
})

const joinScript = (): JoinScript => ({ acquired: [], retired: [] })

describe("SessionAdmission external join-then-retry", () => {
  it.live("waits for release, then runs the body exactly once under the lease it joined", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_j_retry_once")
      const script = joinScript()
      const release = yield* Deferred.make<void>()
      const ran = yield* Ref.make(0)
      const closure = joiningClosure(script, release, () =>
        Effect.succeed({
          type: "admitted" as const,
          lease: joinedLease,
          epoch: 1n,
          instance: Model.id("instance", "instance_j"),
        }),
      )

      const admission = yield* SessionAdmission.admitted(
        closure,
        { session, origin: "external", source: "test.j.retry" },
        () => Ref.update(ran, (n) => n + 1),
      ).pipe(Effect.forkScoped)

      // CLAUSE 3/4. The join has happened and the body has NOT. Nothing durable or executable has
      // run, which is why there is nothing to roll back and clause 4 costs no machinery.
      yield* pollWithTimeout(
        Effect.sync(() => (script.acquired.length === 1 ? script.acquired[0] : undefined)),
        "the admission never joined",
      )
      expect(yield* Ref.get(ran)).toBe(0)
      expect(script.acquired[0]?.retry).toBe("initial")
      expect(script.acquired[0]?.lease).toBeUndefined()

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(admission)

      // CLAUSE 5/6. Exactly two acquisitions, and the second is a RETRY of the first rather than a
      // new reservation — same LeaseID, retry polarity set. Passing the id back is what routes this
      // through `Model.reserveLease`'s replace-once rule instead of a counter kept here.
      expect(script.acquired).toHaveLength(2)
      expect(script.acquired[1]?.retry).toBe("post_closure_external_retry")
      expect(script.acquired[1]?.lease).toBe(joinedLease)
      // The body ran once. Not "at least once", and not twice: the hazard list reduces to exactly
      // this once the wait precedes the body.
      expect(yield* Ref.get(ran)).toBe(1)
      // And the lease settles normally, once.
      expect(script.retired).toEqual([{ lease: joinedLease, disposition: undefined }])
    }),
  )

  it.live("refuses a second closure conflict without a third attempt, and settles the joined lease", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_j_second_conflict")
      const script = joinScript()
      const release = yield* Deferred.make<void>()
      const ran = yield* Ref.make(0)
      // A NEW fence landed during the wait. `Model.reserveLease` takes its replace path before the
      // fence check, so the coordinator reports this through the pre-read as `fenced` rather than a
      // second `joined` — which is exactly why no third attempt is even representable here.
      const closure = joiningClosure(script, release, fencedAcquire)

      const admission = yield* SessionAdmission.admitted(
        closure,
        { session, origin: "external", source: "test.j.second" },
        () => Ref.update(ran, (n) => n + 1),
      ).pipe(Effect.forkScoped)

      yield* pollWithTimeout(
        Effect.sync(() => (script.acquired.length === 1 ? script.acquired[0] : undefined)),
        "the admission never joined",
      )
      yield* Deferred.succeed(release, undefined)
      const refused = yield* Fiber.join(admission).pipe(Effect.flip)

      expect(refused._tag).toBe("SessionClosureAdmissionRefused")
      expect(refused.reason).toBe("closing")
      // Returns an error rather than recursing indefinitely. Two acquisitions, never three.
      expect(script.acquired).toHaveLength(2)
      expect(script.acquired[1]?.retry).toBe("post_closure_external_retry")
      expect(yield* Ref.get(ran)).toBe(0)
      // The accounting still holds on the failing path: the adopted lease is SUPPRESSED, not
      // abandoned.
      expect(script.retired).toEqual([{ lease: joinedLease, disposition: "suppressed" }])
    }),
  )

  it.live("does not wait when the seam declares itself non-retryable", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_j_non_retryable")
      const script = joinScript()
      // Never completed. A seam that waited would hang here rather than fail an assertion, and
      // itBounded turns that into a fast failure.
      const release = yield* Deferred.make<void>()
      const ran = yield* Ref.make(0)
      const closure = joiningClosure(script, release, () => Effect.die("must not retry"))

      const refused = yield* SessionAdmission.admitted(
        closure,
        { session, origin: "external", source: "test.j.row21", retryable: false },
        () => Ref.update(ran, (n) => n + 1),
      ).pipe(Effect.flip)

      expect(refused._tag).toBe("SessionClosureAdmissionRefused")
      // These seams refuse for a DIFFERENT reason than internal ones do: origin is external and the
      // join happened, but retrying would resume a blocked tool inside a closed branch.
      expect(script.acquired).toHaveLength(1)
      expect(script.acquired[0]?.origin).toBe("external")
      expect(yield* Ref.get(ran)).toBe(0)
      // The refusal still settles what it joined — a refusal is a decision, not a licence to
      // abandon accounting.
      expect(script.retired).toEqual([{ lease: joinedLease, disposition: "suppressed" }])
    }),
  )
})

// The scope-bound lease behind the Task caller's admission.
//
// `admitted` settles from a BODY; `admitScoped` settles from a SCOPE. The two properties that
// difference has to preserve are (1) settlement is exactly-once on every exit, not only the happy
// one, and (2) the lease is genuinely this seam's own rather than a borrowed ambient one.
describe("SessionAdmission.admitScoped", () => {
  it.live("holds the lease open for the life of the scope and settles it exactly once at close", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_scoped_close")
      const record = calls()
      const closure = fakeInterface(record, admits)

      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* SessionAdmission.admitScoped(closure, {
            session,
            origin: "internal",
            source: "test.scoped",
          })
          expect(context.session).toBe(session)
          expect(context.origin).toBe("internal")
          expect(context.leases).toHaveLength(1)

          // The load-bearing half. A lease that were settled at acquisition would still satisfy
          // "one acquire, one retire" measured after the scope closed — this is what distinguishes
          // a lease that SPANS the scope from one that merely passed through it.
          expect(record.acquired).toEqual([session])
          expect(record.retired).toEqual([])
        }),
      )

      expect(record.retired).toHaveLength(1)
    }),
  )

  it.live("settles on failure and on interrupt, not only on success", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_scoped_exits")
      const record = calls()
      const closure = fakeInterface(record, admits)
      const acquire = SessionAdmission.admitScoped(closure, { session, origin: "internal", source: "test.scoped" })

      // Failure. The accounting does not get to depend on the seam succeeding.
      yield* Effect.scoped(acquire.pipe(Effect.andThen(Effect.fail("boom" as const)))).pipe(Effect.flip)
      expect(record.retired).toHaveLength(1)

      // Interrupt — the fence path, and the one a `try/finally` idiom would miss. The body parks
      // after acquiring so the interrupt genuinely lands mid-scope rather than after it.
      const entered = yield* Deferred.make<void>()
      const blocker = yield* Deferred.make<void>()
      const fiber = yield* Effect.scoped(
        acquire.pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Deferred.await(blocker))),
      ).pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      expect(record.acquired).toHaveLength(2)
      // Positive precondition: still live at the moment of interruption, so the retirement below is
      // caused by the interrupt rather than having already happened.
      expect(record.retired).toHaveLength(1)

      yield* Fiber.interrupt(fiber)
      expect(record.retired).toHaveLength(2)
      yield* Deferred.succeed(blocker, undefined)
    }),
  )

  it.live("refuses a fenced session and leaves nothing for the scope to settle", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_scoped_fenced")
      const record = calls()
      const closure = fakeInterface(record, fencedAcquire)
      const ran = yield* Ref.make(false)

      const refused = yield* Effect.scoped(
        SessionAdmission.admitScoped(closure, { session, origin: "internal", source: "test.scoped" }).pipe(
          Effect.andThen(Ref.set(ran, true)),
        ),
      ).pipe(Effect.flip)

      expect(refused._tag).toBe("SessionClosureAdmissionRefused")
      expect(refused.reason).toBe("closing")
      // Nothing downstream of the refusal ran, and `acquireRelease` registered no finalizer for a
      // lease that was never granted — a spurious retirement here would settle someone else's.
      expect(yield* Ref.get(ran)).toBe(false)
      expect(record.acquired).toEqual([session])
      expect(record.retired).toEqual([])
    }),
  )

  it.live("never consults an ambient context, so a same-session caller lease stays separate", () =>
    Effect.gen(function* () {
      const session = SessionID.make("ses_scoped_ambient")
      const record = calls()
      const closure = fakeInterface(record, admits)
      const ambient = Effect.provideService(SessionAdmission.Service, ambientFor(session))

      // Positive precondition AND the discriminator. Under this exact ambient context `admitted`
      // passes through without consulting the coordinator — which is correct for a layered call,
      // and is precisely what would silently erase the rule that each Task caller and target obtains
      // a separate lease, if `admitScoped` behaved the same way. The Task caller lease is taken on
      // the SAME session as the enclosing loop, so ambient would always match.
      yield* SessionAdmission.admitted(
        closure,
        { session, origin: "internal", source: "test.body" },
        () => Effect.void,
      ).pipe(ambient)
      expect(record.acquired).toEqual([])

      yield* Effect.scoped(
        SessionAdmission.admitScoped(closure, { session, origin: "internal", source: "test.scoped" }),
      ).pipe(ambient)
      expect(record.acquired).toEqual([session])
      expect(record.retired).toHaveLength(1)
    }),
  )
})

// The pre-fence reservation window.
//
// A fence starts after lease allocation, so the canonical closure operation adopts the pre-fence
// lease. The lease holder may not disappear from accounting. It must either bind into
// cancellation-owned work, which is then signalled and included in the fixed-point rescan, or retire
// before quiescence can be proved.

/** `claiming -> fencing -> quiescing`, the phase `quiescence.prove` requires (model.ts:2225). */
const driveToQuiescing = (held: HeldRun, operation: Model.OperationID) =>
  Effect.gen(function* () {
    for (const to of [{ type: "fencing" } as const, { type: "quiescing" } as const]) {
      const step = yield* held.input.control.transition({ type: "operation.advance", operation, to })
      expect(step.decision).toEqual({ type: "applied" })
    }
  })

/** One fixed-point rescan. */
const scanOnce = (held: HeldRun, operation: Model.OperationID) => held.input.control.scan(operation)

/** Submit an explicit scan pair for proof, without constraining whether the two agree. */
const proveWith = (held: HeldRun, operation: Model.OperationID, prior: Model.ScanCapture, current: Model.ScanCapture) =>
  held.input.control
    .transition({ type: "quiescence.prove", operation, prior, current })
    .pipe(Effect.map((step) => step.decision))

/**
 * A STABLE fixed-point attempt: two fresh scans, pinned equal, then a prove.
 *
 * THE EQUALITY ASSERTION IS THE DISCRIMINATOR, not decoration. `prove` returns the SAME
 * `rejected/unverified` for an unstable scan pair as it does for a live blocker (model.ts:2228),
 * so without pinning `prior === current` a rejection proves nothing about blockers — a merely
 * noisy harness would produce it too.
 */
const attemptProof = (held: HeldRun, operation: Model.OperationID) =>
  Effect.gen(function* () {
    const prior = yield* scanOnce(held, operation)
    const current = yield* scanOnce(held, operation)
    expect(current).toEqual(prior)
    return yield* proveWith(held, operation, prior, current)
  })

/**
 * A pre-fence lease held open at the coordinator's own boundary.
 *
 * NO FORKED, PARKED BODY — deliberately. The obvious way to hold a lease open is to run
 * `admitted` with a body that parks, made `Effect.uninterruptible` so the landing fence cannot
 * kill it. That shape works on the happy path and WEDGES THE RUNNER on any failure before the
 * body is released: an uninterruptible fiber parked on a Deferred nobody completes cannot be
 * interrupted, so scope teardown never finishes and a red test becomes a hang. Verified the hard
 * way while building this — a mutation run had to be abandoned at a 180s timeout rather than
 * reporting the red it had correctly produced.
 *
 * Acquiring directly has neither problem and asserts where the property lives: K7 is about the
 * OPERATION adopting a lease and quiescence blocking on it, which is coordinator-side. That
 * `admitted` mints exactly this shape — `kind: "pre_bind"` with a scope owner — is already pinned
 * by this file's first test, so the seam linkage is covered without re-proving it here.
 */
const holdLease = (closure: SessionClosure.Interface, session: SessionID, origin: "external" | "internal") =>
  Effect.gen(function* () {
    const signal = yield* Deferred.make<void>()
    const decision = yield* closure.acquire({
      session,
      origin,
      retry: "initial",
      source: `test.k7.${origin}`,
      owner: { id: Model.id("scope", `k7:${origin}`), signal },
    })
    expect(decision.type).toBe("admitted")
    if (decision.type !== "admitted") return yield* Effect.die("expected an admission")
    return decision.lease
  })

describe("SessionAdmission pre-fence lease adoption", () => {
  it.live("adopts a paused pre-fence lease and blocks quiescence until it retires", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_k7_pause")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service

          // Positive precondition: nothing is fenced, so every observation below is attributable
          // to the fence this test raises.
          expect((yield* closure.view).fences).toEqual([])

          // The internal half of the pair. Its external twin in the next test runs the identical
          // sequence and reaches the identical outcome, because `blockers` discriminates on
          // acquisition timing rather than on origin.
          const leaseID = yield* holdLease(closure, root, "internal")

          // STAGE 0 — reserved and NOT yet adopted: the row's "after reservation but before bind".
          // Asserting `operation` is absent here is what makes the adoption below attributable to
          // the fence rather than to how the lease was minted.
          const before = leaseOf(yield* closure.view, node)
          expect(before).toHaveLength(1)
          expect(before[0]?.id).toBe(leaseID)
          expect(before[0]?.state).toBe("reserved")
          expect(before[0]?.kind).toBe("pre_bind")
          expect(before[0]?.origin).toBe("internal")
          expect(before[0]?.operation).toBeUndefined()

          // "start abort"
          const { pending, held } = yield* raiseFence(closure, runs, root, node)
          const operation = held.input.command.operation

          // STAGE 1 — "prove operation adopts lease" (model.ts:1889-1893). Same lease id, now
          // stamped with the operation, still unbound.
          const adopted = leaseOf(yield* closure.view, node)
          expect(adopted).toHaveLength(1)
          expect(adopted[0]?.id).toBe(leaseID)
          expect(adopted[0]?.state).toBe("reserved")
          expect(adopted[0]?.operation).toBe(operation)

          yield* driveToQuiescing(held, operation)

          // "cannot declare quiescence": the adopted reservation is a blocker (model.ts:2214).
          expect(yield* attemptProof(held, operation)).toEqual({ type: "rejected", reason: "unverified" })

          // STAGE 2 — BOUND IS STILL NOT ENOUGH. The disjunction is "binds into cancellation OR
          // retires"; a plain bind is neither, and `blockers` treats `bound` exactly as it treats
          // `reserved`. Binding into cancellation-owned work is the coordinator's own mechanism, so
          // this asserts the half reachable here: an ordinary bind does not buy quiescence.
          yield* closure.bind(leaseID, { type: "scope", id: Model.id("scope", "k7:owner") })
          expect(leaseOf(yield* closure.view, node)[0]?.state).toBe("bound")
          expect(yield* attemptProof(held, operation)).toEqual({ type: "rejected", reason: "unverified" })

          // STAGE 3 — retirement, the other disjunct.
          yield* closure.retire(leaseID)
          expect(leaseOf(yield* closure.view, node)).toEqual([])

          // THE POSITIVE CONTROL for both rejections above. The same scan-and-prove procedure, on
          // the same operation, now succeeds — so those rejections were caused by the lease and
          // not by a harness that could never prove quiescence at all.
          expect(yield* attemptProof(held, operation)).toEqual({ type: "applied" })

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )

  // THE POLARITY.
  //
  // Claim-time adoption folds EVERY unstamped lease on a claimed session into `executionLeases`,
  // regardless of origin or state. An earlier design had `blockers` then exempt external ones
  // outright, and the consequence is the reason this test exists: a PRE-fence external lease is a
  // caller whose work was ALREADY IN FLIGHT when the fence landed, so exempting it let quiescence be
  // proved over live work — retirement before quiescence, violated, for the single most ordinary
  // external caller there is (a user prompt).
  //
  // The discriminator is ACQUISITION TIMING, which is the property that actually governs. The
  // exemption origin was standing in for is real but belongs to the POST-fence join — a parked
  // caller cannot run, and blocking on it would deadlock release against quiescence — and that case
  // is named directly instead of being approximated by origin.
  //
  // So this test and its internal twin above are identical in outcome as well as in shape: same
  // pre-fence reservation, same claim-time adoption, same live `reserved` lease, same rejection.
  // What still differs by origin is what is asked of the caller afterwards, not whether the
  // operation may declare quiescence over it.
  it.live("polarity: an adopted EXTERNAL pre-fence lease blocks quiescence exactly as an internal one does", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_k7_external")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service

          // Positive precondition, as in the internal twin: nothing is fenced, so every observation
          // below is attributable to the fence this test raises.
          expect((yield* closure.view).fences).toEqual([])

          const leaseID = yield* holdLease(closure, root, "external")

          const { pending, held } = yield* raiseFence(closure, runs, root, node)
          const operation = held.input.command.operation

          // Identical to the internal case in every respect the row names: same pre-fence
          // reservation, same claim-time adoption, same live `reserved` lease. ONLY origin differs.
          const adopted = leaseOf(yield* closure.view, node)
          expect(adopted).toHaveLength(1)
          expect(adopted[0]?.id).toBe(leaseID)
          expect(adopted[0]?.state).toBe("reserved")
          expect(adopted[0]?.origin).toBe("external")
          expect(adopted[0]?.operation).toBe(operation)
          // The stamp itself, read from the committed view. Asserting it here is what ties the
          // outcome below to acquisition timing rather than to anything else that changed: the
          // lease was minted while `fences` was provably empty, and the model recorded that.
          expect(adopted[0]?.acquisition).toBe("pre_fence")

          yield* driveToQuiescing(held, operation)

          // THE CORRECTED MEASUREMENT. Quiescence is NOT provable while this lease is live and
          // unsettled — the internal twin's Stage 1 outcome, reached through the other origin.
          expect(yield* attemptProof(held, operation)).toEqual({ type: "rejected", reason: "unverified" })
          expect(leaseOf(yield* closure.view, node)[0]?.state).toBe("reserved")

          // Bound is still not enough, for the same reason it is not enough internally: the
          // disjunction is "binds into cancellation OR retires", and a plain bind is neither.
          yield* closure.bind(leaseID, { type: "scope", id: Model.id("scope", "k7:external-owner") })
          expect(leaseOf(yield* closure.view, node)[0]?.state).toBe("bound")
          expect(yield* attemptProof(held, operation)).toEqual({ type: "rejected", reason: "unverified" })

          // THE POSITIVE CONTROL for both rejections above. The same scan-and-prove procedure, on
          // the same operation, succeeds once the other disjunct is taken — so those rejections
          // were caused by this lease and not by a harness that could never prove quiescence.
          yield* closure.retire(leaseID)
          expect(leaseOf(yield* closure.view, node)).toEqual([])
          expect(yield* attemptProof(held, operation)).toEqual({ type: "applied" })

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )
})

// The final-scan adversary.
//
// Quiescence is a fixed point: rescan fresh state after signalling and require a stable final scan,
// with no fixed sweep count. Success requires that stable final rescan after every claimed
// execution, lease and participant is quiescent; a sweep count is never proof.
//
// THE AMBIGUITY THESE TESTS EXIST TO DEFEAT. `prove` answers `rejected/unverified` for three
// different causes at one line: a submitted pair that disagrees with itself, a submitted pair gone
// stale against fresh state, or a live blocker. The pre-fence rejections above are the BLOCKER
// cause. These must be the SCAN cause — so each test names which capture field moved, and then
// proves closure on a fresh stable pair. That second half is what rules the blocker cause out: had
// one been involved, the stable pair would reject too.
describe("quiescence fixed-point invalidation", () => {
  it.live("control: with no new work the final scan is stable and quiescence is proved", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_k10_stable")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const { pending, held } = yield* raiseFence(closure, runs, root, node)
          const operation = held.input.command.operation
          yield* driveToQuiescing(held, operation)

          const prior = yield* scanOnce(held, operation)
          const current = yield* scanOnce(held, operation)

          // The row's "no new work" variant, and the positive control for both adversaries below:
          // this is the same procedure they use, and with nothing intervening it succeeds.
          expect(prior.leases).toEqual([])
          expect(prior.mutations).toEqual([])
          expect(current).toEqual(prior)
          expect(yield* proveWith(held, operation, prior, current)).toEqual({ type: "applied" })

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )

  it.live("an admission between the two scans invalidates the fixed point, and closure follows", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_k10_admits")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const { pending, held } = yield* raiseFence(closure, runs, root, node)
          const operation = held.input.command.operation
          yield* driveToQuiescing(held, operation)

          // "the first empty scan" — literally empty, so the membership change below is
          // unambiguous.
          const prior = yield* scanOnce(held, operation)
          expect(prior.leases).toEqual([])

          // THE ADVERSARY, driven through the real seam rather than the model. A post-fence
          // internal admission is refused, but the model still records its reservation
          // `suppressed` against the operation (model.ts:2041-2045) — so it enters
          // `executionLeases` and the capture moves even though no work started.
          const ran = yield* Ref.make(false)
          const refused = yield* SessionAdmission.admitted(
            closure,
            { session: root, origin: "internal", source: "test.k10.adversary" },
            () => Ref.set(ran, true),
          ).pipe(Effect.flip)
          expect(refused._tag).toBe("SessionClosureAdmissionRefused")
          expect(yield* Ref.get(ran)).toBe(false)

          const current = yield* scanOnce(held, operation)

          // WHICH FIELD MOVED, named exactly: membership. A lease the first scan could not see.
          expect(prior.leases).toEqual([])
          expect(current.leases).toHaveLength(1)

          expect(yield* proveWith(held, operation, prior, current)).toEqual({ type: "rejected", reason: "unverified" })

          // AND CLOSURE. The adversary's lease settled `suppressed`, which is not one of the
          // blocker states (model.ts:2214), so a fresh stable pair proves. This is also what
          // attributes the rejection above to scan invalidation: a blocker would reject here too.
          expect(leaseOf(yield* closure.view, node)[0]?.state).toBe("suppressed")
          expect(yield* attemptProof(held, operation)).toEqual({ type: "applied" })

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )

  it.live("a view widening between the two scans invalidates the fixed point with membership unchanged", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_k10_widens")
      const node = Model.id("session", root)
      const late = Model.id("session", "ses_k10_widens_child")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service

          // NO LEASE AT ALL, deliberately — and the reason is a correction rather than a
          // preference.
          //
          // The adversary here was a `lease.bind` on an adopted EXTERNAL pre-fence lease, chosen
          // because `blockers` exempted external leases by origin, so the proof outcome could not
          // be attributed to a blocker. That exemption became an acquisition-timing one, and
          // the shape did not merely change — it became UNREACHABLE. `bindLease` requires
          // `reserved` (model.ts, bindLease), every live pre-fence lease adopted onto the operation
          // now blocks, and a post-fence external lease does not enter `executionLeases` until
          // `planning`, which `prove` refuses to run in. There is no longer any bindable lease that
          // is not also a blocker, so the old fixture could only ever have passed for the wrong
          // reason.
          //
          // `view.require` supplies the same adversary property and is a stronger one. It `touch`es
          // the operation while changing no `ScanCapture` field at all — claims, edges,
          // participants, leases, mutations, effects and successors are each untouched by a node
          // widening — so the revision moves with membership PROVABLY identical rather than
          // identical on one list. It is also the transition the driver itself issues, rather than
          // a shape reached only from a fixture.
          const { pending, held } = yield* raiseFence(closure, runs, root, node)
          const operation = held.input.command.operation
          yield* driveToQuiescing(held, operation)

          const before = yield* held.input.control.view
          const owner = before.operations.find((item) => item.id === operation)
          expect(owner?.views).toHaveLength(1)
          const requested = owner?.views[0]?.id
          if (!requested) return yield* Effect.die("expected exactly one requested-root view")

          const prior = yield* scanOnce(held, operation)
          // Positive precondition: no lease exists, so nothing in this test can block. Without it a
          // rejection below would be attributable to a blocker that happened to be present.
          expect(prior.leases).toEqual([])
          expect(leaseOf(yield* closure.view, node)).toEqual([])

          // THE ADVERSARY.
          const widened = yield* held.input.control.transition({
            type: "view.require",
            operation,
            view: requested,
            nodes: [late],
            facts: [],
          })
          expect(widened.decision).toEqual({ type: "applied" })

          const current = yield* scanOnce(held, operation)

          // THE SHARP DISCRIMINATOR, and it is now total: every captured field is identical once
          // the revision is normalised away, and the revision alone differs. So the rejection
          // cannot be attributed to membership on any axis, and `same()` is demonstrably comparing
          // more than the lists it carries. An outcome-only assertion would not distinguish the two.
          expect({ ...current, revision: prior.revision }).toEqual(prior)
          expect(current.revision).not.toBe(prior.revision)

          expect(yield* proveWith(held, operation, prior, current)).toEqual({ type: "rejected", reason: "unverified" })

          // AND CLOSURE — with nothing retired or settled, deliberately. No blocker exists at any
          // point in this test, so a fresh stable pair proves immediately, which isolates the
          // rejection above to scan invalidation alone.
          expect(yield* attemptProof(held, operation)).toEqual({ type: "applied" })

          yield* Deferred.succeed(held.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.exit)
        }),
      )
    }),
  )
})
