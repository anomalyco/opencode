import { describe, expect } from "bun:test"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Layer, Queue, Scope } from "effect"
import { BackgroundJob } from "@/background/job"
import { noAnswer } from "../lib/background"
import { BackgroundJobBinder } from "@/background/binder"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionRunState } from "@/session/run-state"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it } from "../lib/effect"

/**
 * The binder: the bridge that answers core's "may this arm?" out of closure authority.
 *
 * The authority-dependent answers are proved against the real coordinator and real model, because
 * they are the thing that would be wrong if the bridge mistranslated. Only the two outcomes that
 * are purely the bridge's own translation - a Location failure, and a `joined` the coordinator can
 * emit but core should never provoke - use a narrow fake, since a real fixture for those would
 * restate the coordinator's behaviour instead of testing the mapping.
 */

type HeldRun = { readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }

const capability: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const heldDriver = (runs: Queue.Queue<HeldRun>): Ports.Driver => ({
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs, { input, release })
      yield* Deferred.await(release)
    }),
  command: () => Effect.void,
})

const statusStub = Layer.succeed(
  SessionStatus.Service,
  SessionStatus.Service.of({
    get: () => Effect.succeed({ type: "idle" as const }),
    list: () => Effect.succeed(new Map()),
    set: () => Effect.void,
  }),
)

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

const withRunState = <A, E, R>(
  closure: Layer.Layer<SessionClosure.Service, never, never>,
  body: (directory: string) => Effect.Effect<A, E, R | SessionRunState.Service | SessionClosure.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    // The group exposes SessionClosure to the body alongside SessionRunState, and the override list
    // pins the one closure instance the binder and the admission seam must share.
    const runState = LayerNode.compile(
      LayerNode.group([SessionRunState.node, BackgroundJob.node, SessionClosure.node, SessionStatus.node]),
      [
        [SessionClosure.node, closure],
        [SessionStatus.node, statusStub],
      ],
    )
    return yield* body(directory).pipe(Effect.provide(runState), provideInstanceEffect(directory))
  }).pipe(Effect.provide(services))

const realClosure = (ports: Ports.RuntimePorts) =>
  SessionClosure.layer.pipe(
    Layer.provide(SessionToolPartPermit.layer),
    Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
  )

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
    return { pending, held }
  })

const holdLease = (closure: SessionClosure.Interface, session: SessionID, tag: string) =>
  Effect.gen(function* () {
    const signal = yield* Deferred.make<void>()
    const decision = yield* closure.acquire({
      session,
      origin: "internal",
      retry: "initial",
      source: `test.g4.${tag}`,
      owner: { id: Model.id("scope", `g4:${tag}`), signal },
    })
    expect(decision.type).toBe("admitted")
    if (decision.type !== "admitted") return yield* Effect.die("expected an admission")
    return { lease: decision.lease, epoch: decision.epoch }
  })

/** A core lifetime handle. `token` is an object because reference identity IS the handle. */
const lifetimeOf = (id: string) => ({ id, token: {} })

describe("BackgroundJob binder", () => {
  it.live("refuses an invocation that carries no admission, and registers nothing", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const binder = yield* BackgroundJobBinder.make(closure)

          const decision = yield* binder.bind({ lifetime: lifetimeOf("job_noadmit"), sequence: 0 })

          // An absent admission capability must never resolve permissively.
          expect(decision.kind).toBe("rejected")
          if (decision.kind === "rejected") expect(decision.reason).toBe("no_admission")

          // Fail-closed means it left no trace: no lifetime was published to the coordinator, so
          // there is nothing a later caller could adopt or mistake for an admitted invocation.
          expect((yield* closure.view).jobs).toHaveLength(0)
        }),
      )
    }),
  )

  it.live("an admitted sequence zero arms, and the permit it returns is the applying claim", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_binder_arm")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const binder = yield* BackgroundJobBinder.make(closure)
          const held = yield* holdLease(closure, root, "binderarm")
          const lifetime = lifetimeOf("job_binderarm")

          const decision = yield* binder.bind({
            lifetime,
            sequence: 0,
            admission: { lease: held.lease, epoch: held.epoch },
          })
          expect(decision.kind).toBe("arm_allowed")
          if (decision.kind !== "arm_allowed") return

          // The permit speaks in CORE's coordinates, not the model's - that translation is the
          // bridge's job and a caller must never see a LifetimeID.
          expect(decision.permit.lifetime).toBe(lifetime)
          expect(decision.permit.sequence).toBe(0)

          const before = yield* closure.view
          expect(before.jobs).toHaveLength(1)
          expect(before.jobs[0]?.state).toBe("binding")

          expect(yield* decision.permit.claim).toBe(true)

          // The claim reached the MODEL, not just the cell: 1c-i's correction, observed through the
          // bridge that will actually run it.
          const after = yield* closure.view
          expect(after.jobs[0]?.state).toBe("armed")
          expect(after.leases.find((item) => item.id === held.lease)?.owner).toEqual({
            type: "job",
            job: Model.id("job", "job_job_binderarm"),
            lifetime: after.jobs[0]!.lifetime,
            sequence: 0n,
          })
        }),
      )
    }),
  )

  it.live("the same token keeps one lifetime across its extensions", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_binder_stable")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const binder = yield* BackgroundJobBinder.make(closure)
          const first = yield* holdLease(closure, root, "stable0")
          const lifetime = lifetimeOf("job_stable")

          const zero = yield* binder.bind({
            lifetime,
            sequence: 0,
            admission: { lease: first.lease, epoch: first.epoch },
          })
          expect(zero.kind).toBe("arm_allowed")
          if (zero.kind !== "arm_allowed") return
          expect(yield* zero.permit.claim).toBe(true)

          const armed = yield* closure.view
          const minted = armed.jobs[0]?.lifetime

          // ONE LEASE, ONE OWNER - and therefore one invocation. Consuming sequence zero's permit
          // bound this lease to that invocation (row 15), and a bound lease is no longer `reserved`,
          // so it can no longer admit anything. An extension is a SEPARATE admission and must carry
          // its own lease; reusing the first one is refused rather than quietly admitted.
          const reused = yield* binder.bind({
            lifetime,
            sequence: 1,
            admission: { lease: first.lease, epoch: first.epoch },
          })
          expect(reused.kind).toBe("rejected")

          const second = yield* holdLease(closure, root, "stable1")
          const one = yield* binder.bind({
            lifetime,
            sequence: 1,
            admission: { lease: second.lease, epoch: second.epoch },
          })
          expect(one.kind).toBe("arm_allowed")
          if (one.kind !== "arm_allowed") return
          expect(one.permit.sequence).toBe(1)

          // Stability is the property under test: the extension bound to the lifetime its sequence
          // zero minted, rather than a second one. One job, one lifetime, two sequences - across two
          // different leases, which is what proves identity followed the TOKEN and not the lease.
          const extended = yield* closure.view
          expect(extended.jobs).toHaveLength(1)
          expect(extended.jobs[0]?.lifetime).toBe(minted!)
        }),
      )
    }),
  )

  it.live("a replacement token under the same job id mints a different lifetime (ABA)", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_binder_aba")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const binder = yield* BackgroundJobBinder.make(closure)
          const first = yield* holdLease(closure, root, "aba0")

          const opened = yield* binder.bind({
            lifetime: lifetimeOf("job_aba"),
            sequence: 0,
            admission: { lease: first.lease, epoch: first.epoch },
          })
          expect(opened.kind).toBe("arm_allowed")
          if (opened.kind !== "arm_allowed") return
          expect(yield* opened.permit.claim).toBe(true)
          const original = (yield* closure.view).jobs[0]!.lifetime

          // Retire it, so the public job id is free for a replacement. This is the ABA setup: same
          // public id, a lifetime that has ended, and a new one taking its place.
          yield* closure.jobCancel(Model.id("job", "job_job_aba"), original)
          expect((yield* closure.view).jobs).toHaveLength(0)

          // A DIFFERENT token object under that same public id.
          const second = yield* holdLease(closure, root, "aba1")
          const replacement = yield* binder.bind({
            lifetime: lifetimeOf("job_aba"),
            sequence: 0,
            admission: { lease: second.lease, epoch: second.epoch },
          })

          // THE DISCRIMINATOR. Because identity follows the token, this new token mints a FRESH
          // LifetimeID, so the model registers a genuinely new lifetime and admits it. Keying the
          // bridge on the public job id instead hands back the TERMINAL lifetime's ID, and the
          // authority refuses it - measured as `cancellation_owned`. Admission versus refusal is
          // what separates the two implementations, so that is what this asserts.
          //
          // An earlier version asserted `rejected` with a specific reason and did NOT discriminate:
          // the id-keyed path reaches that same reason by a different route, because `startJob`'s
          // join branch also requires an exact admissionRevision and that revision has moved by
          // then. A surviving mutant is what exposed it, which is the third test in this gate that
          // read as green while proving nothing.
          expect(replacement.kind).toBe("arm_allowed")
          if (replacement.kind !== "arm_allowed") return

          const view = yield* closure.view
          const minted = view.jobs.find((item) => item.state !== "terminal")?.lifetime
          expect(minted).toBeDefined()
          expect(minted).not.toBe(original)
        }),
      )
    }),
  )

  it.live("natural terminal winners release the public job id for a replacement lifetime", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()

      yield* withRunState(realClosure(ports), () =>
        Effect.forEach(
          ["completed", "error", "cancelled"] as const,
          (winner) =>
            Effect.gen(function* () {
              const closure = yield* SessionClosure.Service
              const jobs = yield* BackgroundJob.Service
              const root = SessionID.make(`ses_g4_terminal_handoff_${winner}`)
              const id = `job_terminal_handoff_${winner}`
              const firstLease = yield* holdLease(closure, root, `${winner}_first`)
              const first = yield* jobs.startExact({
                id,
                type: "test",
                run:
                  winner === "completed"
                    ? Effect.succeed(noAnswer)
                    : winner === "error"
                      ? Effect.fail(new Error("failed"))
                      : Effect.never,
                admission: { lease: firstLease.lease, epoch: firstLease.epoch },
              })
              if (!first.lifetime) return yield* Effect.die("first lifetime did not arm")

              if (winner === "cancelled") yield* jobs.cancelExact(first.lifetime)
              const settled = yield* jobs.waitExact({ lifetime: first.lifetime })
              expect(settled.info?.status).toBe(winner)
              const before = yield* closure.view

              const secondLease = yield* holdLease(closure, root, `${winner}_second`)
              const replacement = yield* jobs.startExact({
                id,
                type: "test",
                run: Effect.never,
                admission: { lease: secondLease.lease, epoch: secondLease.epoch },
              })

              // This is the production regression's discriminator. Before the terminal handoff,
              // core replaces its terminal token but closure still sees the old lifetime as armed,
              // rejects the replacement, and core returns cancelled Info with no Lifetime.
              expect({ status: replacement.info.status, armed: replacement.lifetime !== undefined }).toEqual({
                status: "running",
                armed: true,
              })
              expect(before.jobs.find((item) => item.id === Model.id("job", `job_${id}`))).toBeUndefined()
              if (!replacement.lifetime) return yield* Effect.die("replacement lifetime did not arm")
              expect(replacement.lifetime.token).not.toBe(first.lifetime.token)
              yield* jobs.cancelExact(replacement.lifetime)
            }),
          { discard: true },
        ),
      )
    }),
  )

  it.live("bounds settled closure records across completed job lifetimes", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const jobs = yield* BackgroundJob.Service
          const root = SessionID.make("ses_g4_retention")

          yield* Effect.forEach(
            Array.from({ length: 24 }, (_, index) => index),
            (index) =>
              Effect.gen(function* () {
                const ordinary = yield* holdLease(closure, root, `retention_ordinary_${index}`)
                yield* closure.retire(ordinary.lease)

                const held = yield* holdLease(closure, root, `retention_job_${index}`)
                const started = yield* jobs.startExact({
                  id: `job_retention_${index}`,
                  type: "test",
                  run: Effect.succeed(noAnswer),
                  admission: { lease: held.lease, epoch: held.epoch },
                })
                if (!started.lifetime) return yield* Effect.die("retention lifetime did not arm")
                yield* jobs.waitExact({ lifetime: started.lifetime })
              }),
            { discard: true },
          )

          const view = yield* closure.view
          expect({ leases: view.leases.length, jobs: view.jobs.length, permits: view.armPermits.length }).toEqual({
            leases: 0,
            jobs: 0,
            permits: 0,
          })
        }),
      )
    }),
  )

  it.live("a fenced lease is cancellation-owned rather than armed", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_binder_fence")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const binder = yield* BackgroundJobBinder.make(closure)
          const held = yield* holdLease(closure, root, "binderfence")
          const fence = yield* raiseFence(closure, runs, root, node)

          const decision = yield* binder.bind({
            lifetime: lifetimeOf("job_binderfence"),
            sequence: 0,
            admission: { lease: held.lease, epoch: held.epoch },
          })

          expect(decision.kind).toBe("cancellation_owned")
          expect((yield* closure.view).armPermits).toHaveLength(0)

          yield* Deferred.succeed(fence.held.release, undefined)
        }),
      )
    }),
  )

  // The two outcomes below are purely this module's translation, so they are driven by a narrow
  // fake. Building a real Location mismatch or provoking a coordinator `joined` would exercise the
  // coordinator's behaviour, which slice 1b already proved, rather than the mapping under test.
  const fakeClosure = (jobStart: Effect.Effect<SessionClosure.JobBindOutcome, Ports.LocationError>) =>
    ({ jobStart: () => jobStart, jobExtend: () => jobStart }) as unknown as SessionClosure.Interface

  it.live("a Location failure refuses rather than escaping, because bind has no error channel", () =>
    Effect.gen(function* () {
      const binder = yield* BackgroundJobBinder.make(
        fakeClosure(Effect.fail(new Ports.LocationError({ expected: "a", actual: "b" }))),
      )

      const decision = yield* binder.bind({
        lifetime: lifetimeOf("job_loc"),
        sequence: 0,
        admission: { lease: Model.id("lease", "lease_loc"), epoch: 0n },
      })

      expect(decision.kind).toBe("rejected")
      if (decision.kind === "rejected") expect(decision.reason).toBe("wrong_location")
    }),
  )

  it.live("a joined outcome carries no permit, so it cannot arm", () =>
    Effect.gen(function* () {
      const binder = yield* BackgroundJobBinder.make(fakeClosure(Effect.succeed({ type: "joined" as const })))

      const decision = yield* binder.bind({
        lifetime: lifetimeOf("job_joined"),
        sequence: 0,
        admission: { lease: Model.id("lease", "lease_joined"), epoch: 0n },
      })

      expect(decision.kind).toBe("rejected")
      if (decision.kind === "rejected") expect(decision.reason).toBe("joined_without_permit")
    }),
  )

  /**
   * The RELAY, which is core's half and is otherwise untested here: every test above calls
   * `binder.bind` directly, so none of them proves the registry actually hands the caller's
   * admission across. That is the shape that has already produced two defects in this gate - a
   * production path and a test path that are not the same path - so it is asserted rather than
   * assumed, with a spy standing in for the binder because the relay, not the decision, is the
   * thing under test.
   */
  it.live("core relays the caller's admission to the binder, at sequence zero and at an extension", () =>
    Effect.gen(function* () {
      const seen: BackgroundJob.BindRequest[] = []
      const spy: BackgroundJob.Binder = {
        bind: (input) =>
          Effect.sync(() => {
            seen.push(input)
            return {
              kind: "arm_allowed" as const,
              permit: { lifetime: input.lifetime, sequence: input.sequence, claim: Effect.succeed(true) },
            }
          }),
        terminal: () => Effect.void,
      }

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const jobs = yield* CoreBackgroundJob.makeWith(spy).pipe(Scope.provide(scope))

      const release = yield* Deferred.make<void>()
      const zero = { lease: Model.id("lease", "lease_relay_zero"), epoch: 7n }
      const started = yield* jobs.startExact({
        id: "job_relay",
        type: "test",
        run: Deferred.await(release).pipe(Effect.as(noAnswer)),
        admission: zero,
      })
      expect(started.lifetime).toBeDefined()
      expect(seen).toHaveLength(1)
      expect(seen[0]?.sequence).toBe(0)
      expect(seen[0]?.admission).toEqual(zero)

      // A SECOND lease, because a lease has one owner: sequence zero's is already bound to that
      // invocation. The relay must carry THIS one, not the one the lifetime started with.
      const one = { lease: Model.id("lease", "lease_relay_one"), epoch: 9n }
      const extended = yield* jobs.extendExact({
        lifetime: started.lifetime!,
        run: Effect.succeed(noAnswer),
        admission: one,
      })
      expect(extended.extended).toBe(true)
      expect(seen).toHaveLength(2)
      expect(seen[1]?.sequence).toBe(1)
      expect(seen[1]?.admission).toEqual(one)

      yield* Deferred.succeed(release, undefined)
    }),
  )
})
