import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue, Ref, Semaphore } from "effect"
import { reconcileParticipantFences, SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { AttachmentParticipant } from "@/session/attachment/participant"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, itBounded as it } from "../lib/effect"

type HeldRun = { readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }

// Bound for probes that must complete *while* something else is parked, where a
// violation shows up as "never returns" rather than a wrong value. The authority
// lock is only ever held across small synchronous `Model` work, so an uncontended
// `closure.view` returns in well under a millisecond — this is ~500x that, far
// outside any scheduling jitter, and it is the difference between a lock-nesting
// regression naming itself in half a second and deadlocking the runner.
const AUTHORITY_PROBE = "500 millis"

const runState: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const heldDriver = (runs: Queue.Queue<HeldRun>, commands?: Queue.Queue<Ports.DriverCommand>): Ports.Driver => ({
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs, { input, release })
      yield* Deferred.await(release)
    }),
  command: (input) => (commands ? Queue.offer(commands, input).pipe(Effect.asVoid) : Effect.void),
})

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

const withClosure = <A, E, R>(
  ports: Ports.RuntimePorts,
  body: (directory: string) => Effect.Effect<A, E, R | SessionClosure.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const layer = SessionClosure.layer.pipe(
      Layer.provide(SessionToolPartPermit.layer),
      Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
    )
    return yield* body(directory).pipe(Effect.provide(layer), provideInstanceEffect(directory))
  }).pipe(Effect.provide(services))

const request = (closure: SessionClosure.Interface, root: SessionID) =>
  closure.request({ root, runState }).pipe(Effect.forkScoped)

describe("SessionClosure authority interpreter", () => {
  it.live("participant fence refs release and remint only across the Session epoch boundary", () =>
    Effect.sync(() => {
      const session = Model.id("session", "ses_participant_fence_lifecycle")
      const firstOperation = Model.id("operation", "op_participant_fence_first")
      const mergedOperation = Model.id("operation", "op_participant_fence_merged")
      const nextOperation = Model.id("operation", "op_participant_fence_next")
      const resources = new Map<Model.SessionID, { readonly epoch: bigint; readonly ref: Ports.ParticipantFenceRef }>()

      reconcileParticipantFences(resources, [{ session, epoch: 0n, operation: firstOperation, state: "closing" }])
      const first = resources.get(session)?.ref
      expect(first).toBeDefined()

      // Recanonicalization is an owner-label change, not a new semantic fence generation.
      reconcileParticipantFences(resources, [{ session, epoch: 0n, operation: mergedOperation, state: "closing" }])
      expect(resources.get(session)?.ref).toBe(first)

      // Epoch is the semantic generation even if a future model transition replaces one fence with
      // another without exposing an intermediate empty view. This kills `if (current) continue`.
      reconcileParticipantFences(resources, [{ session, epoch: 1n, operation: nextOperation, state: "closing" }])
      const second = resources.get(session)?.ref
      expect(second).toBeDefined()
      expect(second).not.toBe(first)

      // Release removes the coordinator's strong root. This assertion kills deletion of the release
      // loop directly rather than inferring collection from a later epoch or from GC timing.
      reconcileParticipantFences(resources, [])
      expect(resources.has(session)).toBe(false)

      reconcileParticipantFences(resources, [{ session, epoch: 2n, operation: nextOperation, state: "closing" }])
      expect(resources.get(session)?.ref).not.toBe(second)
    }),
  )
  it.live("a failed participant capture cannot suppress signals owned by a committed claim", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_claim_window_failure")
          const rootID = Model.id("session", root)
          const pending = yield* request(closure, root)
          const run = yield* Queue.take(runs)
          const signalRan = yield* Deferred.make<void>()
          const fenced = yield* Deferred.make<Model.OperationID>()

          const claimed = yield* run.input.control
            .claim({
              operation: run.input.command.operation,
              proofs: [
                {
                  value: "proven_connected",
                  root: rootID,
                  active: rootID,
                  path: [rootID],
                  edges: [],
                },
              ],
              signals: [Deferred.succeed(signalRan, undefined).pipe(Effect.as("success" as const))],
              beforeSignals: (operation) =>
                closure.view.pipe(
                  Effect.tap((view) => {
                    const current = view.operations.find((item) => item.id === operation)
                    const installed = view.fences.some(
                      (item) => item.session === rootID && item.operation === operation && item.state === "closing",
                    )
                    if (!current || !installed) return Effect.die("claim window opened before its fence")
                    return Deferred.succeed(fenced, operation).pipe(Effect.asVoid)
                  }),
                  Effect.andThen(Effect.die(new Error("injected participant capture defect"))),
                ),
            })
            .pipe(Effect.exit)

          expect(Exit.isFailure(claimed)).toBe(true)
          expect(yield* Deferred.isDone(fenced)).toBe(true)
          expect(yield* Deferred.isDone(signalRan)).toBe(true)

          yield* Deferred.succeed(run.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("K46(a,b,d) isolates runtime tokens and rejects cross-Instance authority before effects", () =>
    Effect.gen(function* () {
      const firstDirectory = yield* tmpdirScoped()
      const secondDirectory = yield* tmpdirScoped()
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
      const layer = SessionClosure.layer.pipe(
        Layer.provide(SessionToolPartPermit.layer),
        Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
      )

      yield* Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const firstRoot = SessionID.make("ses_gate2_instance_a")
        const secondRoot = SessionID.make("ses_gate2_instance_b")
        const firstRequest = yield* closure
          .request({ root: firstRoot, runState })
          .pipe(provideInstanceEffect(firstDirectory), Effect.forkScoped)
        const firstRun = yield* Queue.take(runs)
        const secondRequest = yield* closure
          .request({ root: secondRoot, runState })
          .pipe(provideInstanceEffect(secondDirectory), Effect.forkScoped)
        const secondRun = yield* Queue.take(runs)

        expect(firstRun.input.control.identity.directory).toBe(firstDirectory)
        expect(secondRun.input.control.identity.directory).toBe(secondDirectory)
        expect(firstRun.input.control.identity.instance).not.toBe(secondRun.input.control.identity.instance)

        const wrongOwner = yield* firstRun.input.control.view.pipe(provideInstanceEffect(secondDirectory), Effect.exit)
        expect(Exit.isFailure(wrongOwner)).toBe(true)

        const sharedLease = Model.id("lease", "lease_gate2_reused_in_isolated_instances")
        const firstLease = yield* firstRun.input.control
          .transition({
            type: "lease.reserve",
            lease: {
              id: sharedLease,
              session: Model.id("session", firstRoot),
              epoch: 0n,
              source: "gate2",
              origin: "external",
              retry: "initial",
              kind: "ordinary",
            },
          })
          .pipe(provideInstanceEffect(firstDirectory))
        const secondLease = yield* secondRun.input.control
          .transition({
            type: "lease.reserve",
            lease: {
              id: sharedLease,
              session: Model.id("session", secondRoot),
              epoch: 0n,
              source: "gate2",
              origin: "external",
              retry: "initial",
              kind: "ordinary",
            },
          })
          .pipe(provideInstanceEffect(secondDirectory))
        expect(firstLease.decision.type).toBe("applied")
        expect(secondLease.decision.type).toBe("applied")

        const sharedRequest = Model.id("request", "request_gate2_reused_in_isolated_instances")
        const sharedJob = Model.id("job", "job_gate2_reused_in_isolated_instances")
        const sharedLifetime = Model.id("lifetime", "lifetime_gate2_reused_in_isolated_instances")
        const sharedScope = Model.id("scope", "scope_gate2_reused_in_isolated_instances")
        const firstAdmission = yield* closure.view.pipe(provideInstanceEffect(firstDirectory))
        const secondAdmission = yield* closure.view.pipe(provideInstanceEffect(secondDirectory))
        const firstJob = yield* firstRun.input.control
          .transition({
            type: "job.start",
            request: sharedRequest,
            job: sharedJob,
            lifetime: sharedLifetime,
            scope: sharedScope,
            lease: sharedLease,
            epoch: 0n,
            admissionRevision: firstAdmission.authorityRevision,
          })
          .pipe(provideInstanceEffect(firstDirectory))
        const secondJob = yield* secondRun.input.control
          .transition({
            type: "job.start",
            request: sharedRequest,
            job: sharedJob,
            lifetime: sharedLifetime,
            scope: sharedScope,
            lease: sharedLease,
            epoch: 0n,
            admissionRevision: secondAdmission.authorityRevision,
          })
          .pipe(provideInstanceEffect(secondDirectory))
        expect(firstJob.decision).toEqual({ type: "applied" })
        expect(secondJob.decision).toEqual({ type: "applied" })
        yield* firstRun.input.control
          .transition({ type: "job.terminal", job: sharedJob, lifetime: sharedLifetime, winner: "cancelled" })
          .pipe(provideInstanceEffect(firstDirectory))

        const signalRan = yield* Deferred.make<void>()
        const crossClaim = yield* firstRun.input.control
          .claim({
            operation: firstRun.input.command.operation,
            proofs: [
              {
                value: "proven_connected",
                root: Model.id("session", secondRoot),
                active: Model.id("session", secondRoot),
                path: [Model.id("session", secondRoot)],
                edges: [],
              },
            ],
            signals: [Deferred.succeed(signalRan, undefined).pipe(Effect.as("success" as const))],
          })
          .pipe(provideInstanceEffect(firstDirectory), Effect.exit)
        expect(Exit.isFailure(crossClaim)).toBe(true)
        expect(yield* Deferred.isDone(signalRan)).toBe(false)

        const firstView = yield* closure.view.pipe(provideInstanceEffect(firstDirectory))
        const secondView = yield* closure.view.pipe(provideInstanceEffect(secondDirectory))
        // The first Instance terminalized and compacted its exact lifetime; the second Instance's
        // same-named live coordinates remain untouched. This is a stronger isolation assertion than
        // comparing two retained historical rows.
        expect(firstView.leases).toEqual([])
        expect(secondView.leases.map((item) => item.id)).toEqual([sharedLease])
        expect(firstView.jobs).toEqual([])
        // CP-023 Gate 4 (1b). This read `registered_unarmed` until the coordinator began answering
        // the `job.bind` command: before that nothing interpreted it, so the token froze at the state
        // `job.start` left it in. It now advances to `binding` under a real `arm_allowed`, which is
        // the wiring working rather than a regression - the lease is reserved and its session
        // unfenced, which is exactly the case 7.4 says may arm.
        //
        // What this row owns is cross-Instance ISOLATION, not the lifecycle state name: the first
        // Instance terminalized this job and the second must be untouched by that. So the state is
        // asserted alongside the property it stands for, and a future gate moving the state again
        // will not silently weaken the isolation claim.
        expect(secondView.jobs).toContainEqual(expect.objectContaining({ id: sharedJob, state: "binding" }))
        expect(secondView.jobs.map((item) => item.state)).not.toContain("terminal")
        expect(firstView.claims).toHaveLength(0)
        expect(secondView.claims).toHaveLength(0)

        yield* Deferred.succeed(firstRun.release, undefined)
        yield* Deferred.succeed(secondRun.release, undefined)
        yield* Effect.all(
          [firstRequest, secondRequest].map((fiber) => Fiber.join(fiber).pipe(Effect.flip)),
          { concurrency: "unbounded", discard: true },
        )
      }).pipe(Effect.provide(layer))
    }).pipe(Effect.provide(services)),
  )

  it.live("I-04 and I-28 run descriptors outside the lock and never start a revoked issued effect", () =>
    Effect.gen(function* () {
      const dispatchReached = yield* Deferred.make<void>()
      const allowDispatch = yield* Deferred.make<void>()
      const callbackRan = yield* Deferred.make<void>()
      const reentered = yield* Deferred.make<void>()
      const descriptorEntered = yield* Deferred.make<void>()
      const releaseDescriptor = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const box = { dispatches: 0 }
      const ports: Ports.RuntimePorts = {
        driver: heldDriver(runs),
        participants: [],
        hooks: {
          beforeEffectDispatch: () => {
            box.dispatches += 1
            if (box.dispatches === 1) return Effect.void
            return Deferred.succeed(dispatchReached, undefined).pipe(Effect.andThen(Deferred.await(allowDispatch)))
          },
        },
      }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const pending = yield* request(closure, SessionID.make("ses_gate2_revoked_effect"))
          const run = yield* Queue.take(runs)
          const control = run.input.control
          const outside = yield* control
            .issue({
              operation: run.input.command.operation,
              effect: "signal",
              run: Deferred.succeed(descriptorEntered, undefined).pipe(
                Effect.andThen(Deferred.await(releaseDescriptor)),
                Effect.andThen(Deferred.succeed(reentered, undefined)),
                // Retained from the deadlock-based version: the descriptor really
                // does re-enter `control.view` from its own fiber. Bounded, because
                // unbounded re-entry under a violation deadlocks the fiber that
                // holds the lock, and nothing downstream — not scope close, not the
                // suite fiber bound — can then free it for teardown.
                Effect.andThen(
                  awaitWithTimeout(
                    control.view,
                    "I-04: control.view blocked inside its own descriptor — the descriptor is running under the authority lock",
                    AUTHORITY_PROBE,
                  ),
                ),
                Effect.as("success" as const),
              ),
            })
            .pipe(provideInstanceEffect(directory), Effect.forkScoped)

          // I-04 by positive assertion, the shape the I-36 participant probe uses
          // below: park the descriptor mid-run and take the authority lock from a
          // *different* fiber. `closure.view` is lock-taking, so it can only
          // complete here if the coordinator dispatched this descriptor outside the
          // lock — no effect runs under it. Proving the same thing by letting the
          // descriptor re-enter the lock itself detects the violation as a
          // deadlock, which hangs the runner rather than failing it (and `dispose`
          // takes the same lock, so teardown hangs too); this names it in ms.
          yield* Deferred.await(descriptorEntered)
          const duringDescriptor = yield* awaitWithTimeout(
            closure.view,
            "I-04: closure.view could not complete while an effect descriptor was running — the coordinator is holding the authority lock across the descriptor",
            AUTHORITY_PROBE,
          ).pipe(
            // A failed probe means the descriptor is parked while holding the lock,
            // and teardown takes that same lock. Un-park it on the failure path or
            // dispose deadlocks and the runner never reports the violation this
            // probe just caught — measured: the assertion fires at ~506ms, then the
            // file hangs past 240s without this.
            Effect.onError(() => Deferred.succeed(releaseDescriptor, undefined).pipe(Effect.asVoid)),
          )
          // Stage boundary, not pipeline output: the permit is in_flight, so the
          // probe ran against a dispatched, still-running descriptor. A view taken
          // before dispatch or after return would complete for the wrong reason and
          // prove nothing about the lock.
          expect(duringDescriptor.effects[0]?.state).toBe("in_flight")

          yield* Deferred.succeed(releaseDescriptor, undefined)
          yield* Fiber.join(outside)
          // Retained from the deadlock-based version: the descriptor really did
          // re-enter `control.view` from its own fiber and return through it.
          expect(yield* Deferred.isDone(reentered)).toBe(true)
          const returned = yield* closure.view
          expect(returned.effects.find((effect) => effect.state === "returned")).toBeDefined()
          const issued = yield* control
            .issue({
              operation: run.input.command.operation,
              effect: "signal",
              run: Deferred.succeed(callbackRan, undefined).pipe(
                Effect.andThen(control.view),
                Effect.as("success" as const),
              ),
            })
            .pipe(provideInstanceEffect(directory), Effect.forkScoped)

          yield* Deferred.await(dispatchReached)
          // Stage boundary, not pipeline output: the second effect.run really did reach the
          // pre-dispatch point, so a later "callback never ran" cannot pass for the wrong reason
          // (never emitted, never interpreted, request already dead).
          expect(box.dispatches).toBe(2)
          const beforeFailure = yield* closure.view
          const permit = beforeFailure.effects.find((effect) => effect.state === "issued")
          expect(permit).toBeDefined()
          expect(yield* Deferred.isDone(callbackRan)).toBe(false)
          const current = beforeFailure.operations[0]
          expect(current?.driver.state).toBe("running")
          if (!current || current.driver.state !== "running") return yield* Effect.die("missing running driver")
          yield* control.transition({
            type: "operation.fail",
            operation: current.id,
            repair: current.driver.repair,
            revision: current.revision,
            failure: "closure_unavailable",
          })
          const revoked = yield* closure.view
          expect(revoked.effects.find((effect) => effect.id === permit?.id)?.state).toBe("revoked")

          yield* Deferred.succeed(allowDispatch, undefined)
          yield* Fiber.join(issued)
          // The dispatch stage ran exactly once for this permit and the model refused it: an applied
          // effect.dispatch moves the permit to in_flight (and a run descriptor then returns it), so a
          // permit still recorded revoked is the non-applied decision itself — "dispatched and refused",
          // not "silently discarded downstream" and not "never dispatched".
          expect(box.dispatches).toBe(2)
          const settled = yield* closure.view
          expect(settled.effects.find((effect) => effect.id === permit?.id)?.state).toBe("revoked")
          expect(settled.effects.some((effect) => effect.state === "in_flight")).toBe(false)
          expect(yield* Deferred.isDone(callbackRan)).toBe(false)
          yield* Fiber.join(pending).pipe(Effect.flip)
          yield* Deferred.succeed(run.release, undefined)
        }),
      )
    }),
  )

  it.live("I-36 and K79 cross core and fake-participant barriers without either lock nesting", () =>
    Effect.gen(function* () {
      const participantLock = yield* Semaphore.make(1)
      const participantHeld = yield* Deferred.make<void>()
      const releaseParticipant = yield* Deferred.make<void>()
      const participantCalledCore = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const box: { control?: Ports.Control; held: boolean; constructed: boolean } = {
        held: false,
        constructed: false,
      }
      const participantID = Model.id("participant", "participant_gate2_crossed_locks")
      const invoke = (input: Ports.ParticipantCall) => {
        box.constructed = true
        return participantLock
          .withPermits(1)(
            Effect.gen(function* () {
              box.held = true
              yield* Deferred.succeed(participantHeld, undefined)
              yield* Deferred.await(releaseParticipant)
              box.held = false
              return {
                revision: input.participantRevision + 1n,
                result: "success" as const,
                value: { observed: input.operation },
              }
            }),
          )
          .pipe(
            Effect.tap(() => {
              if (box.held) return Effect.die("participant retained its lock across the core callback")
              if (!box.control) return Effect.die("missing core control")
              return box.control.view.pipe(
                Effect.orDie,
                Effect.andThen(Deferred.succeed(participantCalledCore, undefined)),
              )
            }),
          )
      }
      const participant: Ports.Participant = {
        id: participantID,
        discover: invoke,
        claim: invoke,
        cancel: invoke,
        observe: invoke,
      }
      const ports: Ports.RuntimePorts = {
        driver: heldDriver(runs),
        participants: [participant],
        hooks: {
          beforeEffectDispatch: (command) =>
            command.effect === "participant" ? Effect.sync(() => expect(box.constructed).toBe(false)) : Effect.void,
        },
      }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const pending = yield* request(closure, SessionID.make("ses_gate2_participant"))
          const run = yield* Queue.take(runs)
          box.control = run.input.control
          const invoked = yield* run.input.control
            .issueParticipant({
              operation: run.input.command.operation,
              participant: participantID,
              kind: "discover",
            })
            .pipe(provideInstanceEffect(directory), Effect.forkScoped)

          yield* Deferred.await(participantHeld)
          const duringParticipantLock = yield* run.input.control.view.pipe(provideInstanceEffect(directory))
          expect(duringParticipantLock.effects[0]?.state).toBe("in_flight")
          expect(box.held).toBe(true)

          yield* Deferred.succeed(releaseParticipant, undefined)
          yield* Deferred.await(participantCalledCore)
          const exchange = yield* Fiber.join(invoked)
          expect(box.constructed).toBe(true)
          expect(exchange.accepted).toBe(true)
          expect(exchange.result).toEqual({
            revision: 1n,
            result: "success",
            value: { observed: run.input.command.operation },
          })
          expect(box.held).toBe(false)
          const observed = yield* closure.view
          expect(observed.operations[0]?.participants).toEqual([{ id: participantID, revision: 1n }])
          expect(observed.effects[0]?.state).toBe("returned")

          yield* Deferred.succeed(run.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("I-41 snapshots an immutable participant registry before the first request", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const originalCalled = yield* Deferred.make<void>()
      const replacementCalled = yield* Deferred.make<void>()
      const originalID = Model.id("participant", "participant_gate2_original")
      const replacementID = Model.id("participant", "participant_gate2_replacement")
      const originalInvoke = (input: Ports.ParticipantCall) =>
        Deferred.succeed(originalCalled, undefined).pipe(
          Effect.as({ revision: input.participantRevision + 1n, result: "success" as const }),
        )
      const replacementInvoke = (input: Ports.ParticipantCall) =>
        Deferred.succeed(replacementCalled, undefined).pipe(
          Effect.as({ revision: input.participantRevision + 1n, result: "success" as const }),
        )
      const original: Ports.Participant = {
        id: originalID,
        discover: originalInvoke,
        claim: originalInvoke,
        cancel: originalInvoke,
        observe: originalInvoke,
      }
      const replacement: Ports.Participant = {
        id: replacementID,
        discover: replacementInvoke,
        claim: replacementInvoke,
        cancel: replacementInvoke,
        observe: replacementInvoke,
      }
      const participants: Ports.Participant[] = [original]
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants, hooks: {} }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          yield* closure.identity
          Object.assign(original, {
            discover: replacementInvoke,
            claim: replacementInvoke,
            cancel: replacementInvoke,
            observe: replacementInvoke,
          })
          participants.splice(0, participants.length, replacement)
          expect(participants.map((participant) => participant.id)).toEqual([replacementID])

          const pending = yield* request(closure, SessionID.make("ses_gate2_participant_snapshot"))
          const run = yield* Queue.take(runs)
          const exchange = yield* run.input.control
            .issueParticipant({
              operation: run.input.command.operation,
              participant: originalID,
              kind: "discover",
            })
            .pipe(provideInstanceEffect(directory))
          expect(exchange.accepted).toBe(true)
          expect(yield* Deferred.isDone(originalCalled)).toBe(true)
          expect(yield* Deferred.isDone(replacementCalled)).toBe(false)

          const unknown = yield* run.input.control
            .issueParticipant({
              operation: run.input.command.operation,
              participant: replacementID,
              kind: "discover",
            })
            .pipe(provideInstanceEffect(directory), Effect.exit)
          expect(Exit.isFailure(unknown)).toBe(true)
          expect(yield* Deferred.isDone(replacementCalled)).toBe(false)

          yield* Deferred.succeed(run.release, undefined)
          yield* Fiber.join(pending).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("I-41 refuses to publish a runtime whose ports declare a duplicate participant ID", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const participantID = Model.id("participant", "participant_gate2_duplicate")
      const invoke = (input: Ports.ParticipantCall) =>
        Effect.succeed({ revision: input.participantRevision + 1n, result: "success" as const })
      const original: Ports.Participant = {
        id: participantID,
        discover: invoke,
        claim: invoke,
        cancel: invoke,
        observe: invoke,
      }
      const shadow: Ports.Participant = {
        id: participantID,
        discover: invoke,
        claim: invoke,
        cancel: invoke,
        observe: invoke,
      }
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [original, shadow], hooks: {} }

      // The registry is a Map keyed by participant ID, so a duplicate would silently drop one
      // implementation and route every call for that ID to the survivor. makeRuntime dies instead,
      // before any supervisor, queue, ticket or driver exists for the directory.
      const exit = yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          return yield* closure.identity
        }),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) return
      expect(
        Cause.prettyErrors(exit.cause).some((error) => error.message.includes("Duplicate SessionClosure participant")),
      ).toBe(true)
      expect(yield* Queue.size(runs)).toBe(0)
    }),
  )

  it.live("I-28 returns a stale participant snapshot for rescan without admitting its revision", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const participantID = Model.id("participant", "participant_gate2_stale_exchange")
      const invoke = (input: Ports.ParticipantCall) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return {
            revision: input.participantRevision + 1n,
            result: "success" as const,
            value: { stale: input.operationRevision },
          }
        })
      const participant: Ports.Participant = {
        id: participantID,
        discover: invoke,
        claim: invoke,
        cancel: invoke,
        observe: invoke,
      }
      const ports: Ports.RuntimePorts = {
        driver: heldDriver(runs),
        participants: [participant],
        hooks: {},
      }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_participant_stale")
          const pending = yield* request(closure, root)
          const run = yield* Queue.take(runs)
          const invoked = yield* run.input.control
            .issueParticipant({
              operation: run.input.command.operation,
              participant: participantID,
              kind: "discover",
            })
            .pipe(provideInstanceEffect(directory), Effect.forkScoped)

          yield* Deferred.await(entered)
          const inFlight = yield* closure.view
          expect(inFlight.effects[0]?.state).toBe("in_flight")
          const current = inFlight.operations[0]
          expect(current?.driver.state).toBe("running")
          if (!current || current.driver.state !== "running") return yield* Effect.die("missing running driver")
          yield* run.input.control.transition({
            type: "operation.fail",
            operation: current.id,
            repair: current.driver.repair,
            revision: current.revision,
            failure: "closure_unavailable",
          })
          yield* Fiber.join(pending).pipe(Effect.flip)
          const repairRequest = yield* request(closure, root)
          const repair = yield* Queue.take(runs)
          const repaired = yield* closure.view
          expect(repaired.operations[0]?.driver.state).toBe("running")
          expect(repair.input.command.repair).not.toBe(current.driver.repair)

          yield* Deferred.succeed(release, undefined)
          const exchange = yield* Fiber.join(invoked)
          expect(exchange.accepted).toBe(false)
          expect(exchange.result).toEqual({
            revision: 1n,
            result: "success",
            value: { stale: current.revision },
          })
          const after = yield* closure.view
          expect(after.operations[0]?.participants).toEqual([])
          expect(after.effects[0]?.state).toBe("returned")

          const rescanned = yield* repair.input.control
            .issueParticipant({
              operation: repair.input.command.operation,
              participant: participantID,
              kind: "discover",
            })
            .pipe(provideInstanceEffect(directory))
          expect(rescanned.accepted).toBe(true)
          const admitted = yield* closure.view
          expect(admitted.operations[0]?.participants).toEqual([{ id: participantID, revision: 1n }])

          yield* Deferred.succeed(run.release, undefined)
          yield* Deferred.succeed(repair.release, undefined)
          yield* Fiber.join(repairRequest).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("participant observe keeps one opaque fence ref across stale rejection and canonical merge", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const attachments = yield* AttachmentCoordinator.make
      const real = AttachmentParticipant.make(attachments)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const calls = yield* Ref.make<readonly Ports.ParticipantCall[]>([])
      const first = { value: true }
      const participant: Ports.Participant = {
        id: real.id,
        discover: real.discover,
        claim: real.claim,
        cancel: real.cancel,
        observe: (input) =>
          Ref.update(calls, (current) => [...current, input]).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                if (first.value) {
                  first.value = false
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                }
                return yield* real.observe(input)
              }),
            ),
          ),
      }
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [participant], hooks: {} }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const winnerRoot = SessionID.make("ses_fence_ref_winner")
          const subject = SessionID.make("ses_fence_ref_subject")
          const winnerID = Model.id("session", winnerRoot)
          const subjectID = Model.id("session", subject)

          // Create the OLDER operation first. It remains disjoint until the younger operation has
          // captured and issued its real participant observation.
          const winnerRequest = yield* request(closure, winnerRoot)
          const winner = yield* Queue.take(runs)
          const loserRequest = yield* request(closure, subject)
          const loser = yield* Queue.take(runs)

          const scope = yield* attachments.open(subject)
          const reservation = yield* scope.reserve(SessionID.make("ses_fence_ref_attached"))
          expect((yield* scope.claimObserver(reservation)).type).toBe("owner")
          const messageID = MessageID.ascending()
          const response: SessionV1.WithParts = {
            info: {
              id: messageID,
              role: "assistant",
              parentID: MessageID.ascending(),
              sessionID: subject,
              mode: "test",
              agent: "test",
              path: { cwd: "/tmp", root: "/tmp" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: ModelV2.ID.make("test"),
              providerID: ProviderV2.ID.make("test"),
              time: { created: 1, completed: 2 },
              finish: "stop",
            },
            parts: [
              {
                id: PartID.ascending(),
                messageID,
                sessionID: subject,
                type: "text",
                text: "withheld before canonical merge",
              },
            ],
          }
          yield* scope.observeTurn({ assistant: response, clean: true })
          expect(scope.current()).toMatchObject({ candidate: true, everAttached: true, cancelled: false })

          yield* loser.input.control
            .claim({
              operation: loser.input.command.operation,
              proofs: [
                {
                  value: "proven_connected",
                  root: subjectID,
                  active: subjectID,
                  path: [subjectID],
                  edges: [],
                },
              ],
              signals: [Effect.succeed("success" as const)],
            })
            .pipe(provideInstanceEffect(directory))
          const captured = yield* loser.input.control
            .issueParticipant({
              operation: loser.input.command.operation,
              participant: participant.id,
              kind: "claim",
              subjects: [subjectID],
            })
            .pipe(provideInstanceEffect(directory))
          expect(captured.accepted).toBe(true)
          expect(captured.result?.value).toEqual([{ type: "participant_claim", subject: subjectID, claim: "held" }])
          expect(scope.current()).toMatchObject({ candidate: true, cancelled: false })
          yield* scope.claimCancellation("cancelled")
          expect(scope.current()).toMatchObject({ candidate: false, cancelled: true })
          yield* scope.close()
          expect(yield* attachments.locate(subject)).toBeUndefined()

          const stale = yield* loser.input.control
            .issueParticipant({
              operation: loser.input.command.operation,
              participant: participant.id,
              kind: "observe",
              subjects: [subjectID],
            })
            .pipe(provideInstanceEffect(directory), Effect.forkScoped)
          yield* Deferred.await(entered)

          // The older operation now claims the younger operation's fenced subject. Model.combine
          // makes the older operation canonical and rewrites fence ownership without changing epoch.
          yield* winner.input.control
            .claim({
              operation: winner.input.command.operation,
              proofs: [
                {
                  value: "proven_connected",
                  root: winnerID,
                  active: subjectID,
                  path: [winnerID, subjectID],
                  edges: [
                    {
                      id: Model.id("edge", "edge_fence_ref_merge"),
                      owner: winnerID,
                      child: subjectID,
                    },
                  ],
                },
              ],
              signals: [Effect.succeed("success" as const)],
            })
            .pipe(provideInstanceEffect(directory))
          const merged = yield* closure.view
          expect(merged.operations).toHaveLength(1)
          expect(merged.operations[0]?.id).toBe(winner.input.command.operation)
          expect(merged.aliases).toContainEqual({
            alias: loser.input.command.operation,
            canonical: winner.input.command.operation,
          })

          yield* Deferred.succeed(release, undefined)
          const rejected = yield* Fiber.join(stale)
          expect(rejected.accepted).toBe(false)
          expect(rejected.result?.value).toEqual([])

          const retried = yield* winner.input.control
            .issueParticipant({
              operation: winner.input.command.operation,
              participant: participant.id,
              kind: "observe",
              subjects: [subjectID],
            })
            .pipe(provideInstanceEffect(directory))
          expect(retried.accepted).toBe(true)
          expect(retried.result?.value).toEqual(rejected.result?.value)
          const observations = yield* Ref.get(calls)
          expect(observations).toHaveLength(2)
          const refs = observations.map(
            (call) => (call.payload as { readonly fences: readonly Ports.ParticipantFenceInput[] }).fences[0]?.ref,
          )
          expect(refs[0]).toBeDefined()
          expect(refs[1]).toBe(refs[0])
          expect(Object.keys(refs[0] ?? {})).toEqual([])
          expect(Object.isFrozen(refs[0])).toBe(true)

          yield* Deferred.succeed(winner.release, undefined)
          yield* Deferred.succeed(loser.release, undefined)
          yield* Effect.all(
            [winnerRequest, loserRequest].map((fiber) => Fiber.join(fiber).pipe(Effect.flip)),
            { concurrency: "unbounded", discard: true },
          )
        }),
      )
    }),
  )

  it.live("I-43 and I-44 stale worker control cannot mint authority for its running repair", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const callbackRan = yield* Deferred.make<void>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_stale_worker_control")
          const rootID = Model.id("session", root)
          const firstRequest = yield* request(closure, root)
          const first = yield* Queue.take(runs)
          const failing = yield* closure.view
          const current = failing.operations[0]
          expect(first.input.control.authority?.worker).toBe(first.input.command.worker)
          expect(Object.isFrozen(first.input.control.authority)).toBe(true)
          // The whole control surface is immutable, not just `authority`. `identity` is the very
          // object `validate()` compares against and the one `scoped()` stamps onto every event, so
          // one in-place write would either brick the instance for every later caller or forge
          // InstanceIDs. It is the same object reference the runtime and the ports factory hold.
          expect(Object.isFrozen(first.input.control)).toBe(true)
          expect(Object.isFrozen(first.input.control.identity)).toBe(true)
          const stamped = first.input.control.identity.instance
          expect(() =>
            Object.assign(first.input.control.identity, { instance: Model.id("instance", "instance_forged") }),
          ).toThrow()
          expect(() => Object.assign(first.input.control, { view: Effect.succeed(undefined) })).toThrow()
          expect(first.input.control.identity.instance).toBe(stamped)
          const survives = yield* first.input.control.view.pipe(provideInstanceEffect(directory), Effect.exit)
          expect(Exit.isSuccess(survives)).toBe(true)
          expect(current?.driver.state).toBe("running")
          if (!current || current.driver.state !== "running") return yield* Effect.die("missing first worker")
          yield* first.input.control.transition({
            type: "operation.fail",
            operation: current.id,
            repair: current.driver.repair,
            revision: current.revision,
            failure: "closure_unavailable",
          })
          yield* Fiber.join(firstRequest).pipe(Effect.flip)

          const repairRequest = yield* request(closure, root)
          const repair = yield* Queue.take(runs)
          const before = yield* closure.view
          const repaired = before.operations[0]
          expect(repaired?.driver.state).toBe("running")
          expect(repair.input.control.authority?.worker).toBe(repair.input.command.worker)
          expect(first.input.control.authority?.worker).not.toBe(repair.input.control.authority?.worker)
          if (!repaired) return yield* Effect.die("missing repair")

          const advance = yield* first.input.control
            .transition({ type: "operation.advance", operation: repaired.id, to: { type: "fencing" } })
            .pipe(provideInstanceEffect(directory))
          expect(advance.decision).toEqual({ type: "noop", reason: "stale" })
          const issued = yield* first.input.control
            .issue({
              operation: repaired.id,
              effect: "signal",
              run: Deferred.succeed(callbackRan, undefined).pipe(Effect.as("success" as const)),
            })
            .pipe(provideInstanceEffect(directory))
          expect(issued.decision).toEqual({ type: "noop", reason: "stale" })
          const claimed = yield* first.input.control
            .claim({
              operation: repaired.id,
              proofs: [{ value: "proven_connected", root: rootID, active: rootID, path: [rootID], edges: [] }],
              signals: [Deferred.succeed(callbackRan, undefined).pipe(Effect.as("success" as const))],
            })
            .pipe(provideInstanceEffect(directory))
          expect(claimed.decision).toEqual({ type: "noop", reason: "stale" })
          expect(yield* Deferred.isDone(callbackRan)).toBe(false)
          const after = yield* closure.view
          expect(after.operations[0]).toEqual(before.operations[0])
          expect(after.effects).toEqual(before.effects)

          yield* Deferred.succeed(first.release, undefined)
          const afterOldExit = yield* closure.view
          expect(afterOldExit.operations[0]?.driver.state).toBe("running")
          yield* Deferred.succeed(repair.release, undefined)
          yield* Fiber.join(repairRequest).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("I-28 and K113 account a stale in-flight failure without demoting the current repair", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_stale_inflight_failure")
          const firstRequest = yield* request(closure, root)
          const first = yield* Queue.take(runs)
          const issued = yield* first.input.control
            .issue({
              operation: first.input.command.operation,
              effect: "signal",
              run: Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as("failure" as const),
              ),
            })
            .pipe(provideInstanceEffect(directory), Effect.forkScoped)

          yield* Deferred.await(entered)
          const inFlight = yield* closure.view
          expect(inFlight.effects[0]?.state).toBe("in_flight")
          const current = inFlight.operations[0]
          expect(current?.driver.state).toBe("running")
          if (!current || current.driver.state !== "running") return yield* Effect.die("missing first attempt")
          yield* first.input.control.transition({
            type: "operation.fail",
            operation: current.id,
            repair: current.driver.repair,
            revision: current.revision,
            failure: "closure_unavailable",
          })
          yield* Fiber.join(firstRequest).pipe(Effect.flip)

          const repairRequest = yield* request(closure, root)
          const repair = yield* Queue.take(runs)
          const advanced = yield* repair.input.control
            .transition({
              type: "operation.advance",
              operation: repair.input.command.operation,
              to: { type: "fencing" },
            })
            .pipe(provideInstanceEffect(directory))
          expect(advanced.decision).toEqual({ type: "applied" })
          const before = yield* closure.view
          expect(before.operations[0]?.phase.type).toBe("fencing")
          expect(before.operations[0]?.failure).toBeUndefined()
          expect(before.operations[0]?.driver.state).toBe("running")
          expect(repair.input.command.repair).not.toBe(first.input.command.repair)

          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(issued)
          const after = yield* closure.view
          expect(after.effects[0]?.state).toBe("returned")
          expect(after.operations[0]).toEqual(before.operations[0])

          yield* Deferred.succeed(first.release, undefined)
          const afterOldExit = yield* closure.view
          expect(afterOldExit.operations[0]?.driver.state).toBe("running")
          yield* Deferred.succeed(repair.release, undefined)
          yield* Fiber.join(repairRequest).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("the direct plan-read command rejects a stale return after canonical merge", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const commands = yield* Queue.unbounded<Ports.DriverCommand>()
      const ports: Ports.RuntimePorts = { driver: heldDriver(runs, commands), participants: [], hooks: {} }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const firstRoot = SessionID.make("ses_gate2_plan_a")
          const secondRoot = SessionID.make("ses_gate2_plan_b")
          const firstRequest = yield* request(closure, firstRoot)
          const first = yield* Queue.take(runs)
          const firstOperation = first.input.command.operation
          const firstSession = Model.id("session", firstRoot)
          yield* first.input.control
            .claim({
              operation: firstOperation,
              proofs: [
                {
                  value: "proven_connected",
                  root: firstSession,
                  active: firstSession,
                  path: [firstSession],
                  edges: [],
                },
              ],
              signals: [Effect.succeed("success" as const)],
            })
            .pipe(provideInstanceEffect(directory))
          yield* first.input.control
            .transition({ type: "operation.advance", operation: firstOperation, to: { type: "fencing" } })
            .pipe(provideInstanceEffect(directory))
          yield* first.input.control
            .transition({ type: "operation.advance", operation: firstOperation, to: { type: "quiescing" } })
            .pipe(provideInstanceEffect(directory))
          const prior = yield* first.input.control.scan(firstOperation).pipe(provideInstanceEffect(directory))
          const current = yield* first.input.control.scan(firstOperation).pipe(provideInstanceEffect(directory))
          yield* first.input.control
            .transition({ type: "quiescence.prove", operation: firstOperation, prior, current })
            .pipe(provideInstanceEffect(directory))
          yield* first.input.control
            .transition({ type: "planning.begin", operation: firstOperation })
            .pipe(provideInstanceEffect(directory))
          const planning = yield* Queue.take(commands)
          expect(planning.command.type).toBe("plan.read")
          if (planning.command.type !== "plan.read") return yield* Effect.die("missing plan read")

          const secondRequest = yield* request(closure, secondRoot)
          const second = yield* Queue.take(runs)
          const secondOperation = second.input.command.operation
          const secondSession = Model.id("session", secondRoot)
          yield* second.input.control
            .claim({
              operation: secondOperation,
              proofs: [
                {
                  value: "proven_connected",
                  root: secondSession,
                  active: secondSession,
                  path: [secondSession],
                  edges: [],
                },
              ],
              signals: [Effect.succeed("success" as const)],
            })
            .pipe(provideInstanceEffect(directory))
          yield* second.input.control
            .claim({
              operation: secondOperation,
              proofs: [
                {
                  value: "proven_connected",
                  root: secondSession,
                  active: firstSession,
                  path: [secondSession, firstSession],
                  edges: [
                    {
                      id: Model.id("edge", "edge_gate2_plan_merge"),
                      owner: secondSession,
                      child: firstSession,
                    },
                  ],
                },
              ],
              signals: [Effect.succeed("success" as const)],
            })
            .pipe(provideInstanceEffect(directory))

          const merged = yield* closure.view
          expect(merged.operations).toHaveLength(1)
          expect(merged.operations[0]?.id).toBe(firstOperation)
          expect(merged.aliases).toContainEqual({ alias: secondOperation, canonical: firstOperation })
          const stale = yield* first.input.control
            .transition({ type: "planning.return", read: planning.command, identities: [] })
            .pipe(provideInstanceEffect(directory))
          expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
          const after = yield* closure.view
          expect(after.operations[0]?.phase.type).toBe("quiescing")
          expect(after.operations[0]?.generations).toHaveLength(0)

          yield* Deferred.succeed(first.release, undefined)
          yield* Deferred.succeed(second.release, undefined)
          yield* Effect.all(
            [firstRequest, secondRequest].map((fiber) => Fiber.join(fiber).pipe(Effect.flip)),
            { concurrency: "unbounded", discard: true },
          )
        }),
      )
    }),
  )

  it.live("K114 old delivery cleanup and worker finalization cannot touch a new same-root operation", () =>
    Effect.gen(function* () {
      const deliveryReached = yield* Deferred.make<void>()
      const allowDelivery = yield* Deferred.make<void>()
      const oldWorkerExited = yield* Deferred.make<Model.Decision>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const commands = yield* Queue.unbounded<Ports.DriverCommand>()
      const box: { deliveryHeld: boolean; oldWorker?: Model.WorkerID } = { deliveryHeld: false }
      const ports: Ports.RuntimePorts = {
        driver: heldDriver(runs, commands),
        participants: [],
        hooks: {
          beforeWaiterDelivery: (command) => {
            if (command.failure || box.deliveryHeld) return Effect.void
            box.deliveryHeld = true
            return Deferred.succeed(deliveryReached, undefined).pipe(Effect.andThen(Deferred.await(allowDelivery)))
          },
          afterWorkerExit: (input) => {
            if (input.worker !== box.oldWorker) return Effect.void
            return Deferred.succeed(oldWorkerExited, input.decision).pipe(Effect.asVoid)
          },
        },
      }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_release_isolation")
          const rootID = Model.id("session", root)
          const firstRequest = yield* request(closure, root)
          const first = yield* Queue.take(runs)
          box.oldWorker = first.input.command.worker
          const control = first.input.control
          const operationID = first.input.command.operation
          yield* control
            .claim({
              operation: operationID,
              proofs: [
                {
                  value: "proven_connected",
                  root: rootID,
                  active: rootID,
                  path: [rootID],
                  edges: [],
                },
              ],
              signals: [Effect.succeed("success" as const)],
            })
            .pipe(provideInstanceEffect(directory))
          const claimed = yield* closure.view
          const rootView = claimed.operations[0]?.views[0]
          if (!rootView) return yield* Effect.die("missing root view")
          yield* control
            .transition({
              type: "view.require",
              operation: operationID,
              view: rootView.id,
              nodes: [rootID],
              facts: [{ type: "root", root: rootID, direct: { outcome: "cancelled", yielded: false } }],
            })
            .pipe(provideInstanceEffect(directory))
          yield* control
            .transition({ type: "operation.advance", operation: operationID, to: { type: "fencing" } })
            .pipe(provideInstanceEffect(directory))
          yield* control
            .transition({ type: "operation.advance", operation: operationID, to: { type: "quiescing" } })
            .pipe(provideInstanceEffect(directory))
          const prior = yield* control.scan(operationID).pipe(provideInstanceEffect(directory))
          const current = yield* control.scan(operationID).pipe(provideInstanceEffect(directory))
          yield* control
            .transition({ type: "quiescence.prove", operation: operationID, prior, current })
            .pipe(provideInstanceEffect(directory))
          yield* control
            .transition({ type: "planning.begin", operation: operationID })
            .pipe(provideInstanceEffect(directory))
          const plan = yield* Queue.take(commands)
          expect(plan.command.type).toBe("plan.read")
          if (plan.command.type !== "plan.read") return yield* Effect.die("missing plan read")
          const planned = yield* closure.view
          const fact = planned.operations[0]?.facts[0]
          if (!fact) return yield* Effect.die("missing root fact")
          const identity: Model.Identity = {
            source: "session_identity",
            agent: "gate2-test",
            model: {
              providerID: "gate2",
              modelID: "fake",
              variant: { present: false },
            },
          }
          yield* control
            .transition({
              type: "planning.return",
              read: plan.command,
              identities: [{ session: rootID, identity }],
              seed: {
                clockMillis: 100,
                highWaterMillis: 90,
                coordinates: [
                  {
                    fact: fact.id,
                    message: Model.id("message", "msg_gate2_release"),
                    part: Model.id("part", "prt_gate2_release"),
                    messageEvent: Model.id("event", "evt_gate2_release_message"),
                    partEvent: Model.id("event", "evt_gate2_release_part"),
                  },
                ],
              },
            })
            .pipe(provideInstanceEffect(directory))
          const next = yield* control
            .transition({ type: "writer.next", operation: operationID })
            .pipe(provideInstanceEffect(directory))
          const candidate = next.commands.find(
            (item): item is Extract<Model.Command, { readonly type: "pair.candidate" }> =>
              item.type === "pair.candidate",
          )
          if (!candidate) return yield* Effect.die("missing pair candidate")
          const write = yield* Queue.take(commands)
          expect(write.command.type).toBe("pair.write")
          if (write.command.type !== "pair.write") return yield* Effect.die("missing pair write")
          expect(write.command.candidate.fact).toBe(candidate.fact)
          expect((yield* closure.view).pairs[0]?.id).toBe(write.command.permit)
          yield* control
            .transition({ type: "pair.return", write: write.command, message: "verified", part: "verified" })
            .pipe(provideInstanceEffect(directory))
          yield* control
            .transition({ type: "release.prepare", operation: operationID })
            .pipe(provideInstanceEffect(directory))
          const check = yield* Queue.take(commands)
          expect(check.command.type).toBe("release.verify")
          if (check.command.type !== "release.verify") return yield* Effect.die("missing release check")
          const committing = yield* control
            .transition({ type: "release.commit", check: check.command })
            .pipe(provideInstanceEffect(directory), Effect.forkScoped)

          yield* Deferred.await(deliveryReached)
          const released = yield* closure.view
          expect(released.operations[0]?.phase.type).toBe("released_pending_delivery")
          expect(released.fences).toHaveLength(0)
          expect(released.epochs.find((item) => item.session === rootID)?.epoch).toBe(1n)
          const secondRequest = yield* request(closure, root)
          const second = yield* Queue.take(runs)
          const overlapped = yield* closure.view
          expect(overlapped.operations).toHaveLength(2)
          expect(second.input.command.operation).not.toBe(operationID)

          yield* Deferred.succeed(allowDelivery, undefined)
          yield* Fiber.join(committing)
          const firstOutcome = yield* Fiber.join(firstRequest)
          expect(firstOutcome.operation).toBe(operationID)
          const cleaned = yield* closure.view
          expect(cleaned.operations).toHaveLength(1)
          expect(cleaned.operations[0]?.id).toBe(second.input.command.operation)
          expect(cleaned.operations[0]?.driver.state).toBe("running")

          yield* Deferred.succeed(first.release, undefined)
          const staleDecision = yield* Deferred.await(oldWorkerExited)
          expect(staleDecision).toEqual({ type: "noop", reason: "stale" })
          const survived = yield* closure.view
          expect(survived.operations).toHaveLength(1)
          expect(survived.operations[0]?.id).toBe(second.input.command.operation)
          expect(survived.operations[0]?.driver.state).toBe("running")

          yield* Fiber.interrupt(secondRequest)
        }),
      )
    }),
  )
})
