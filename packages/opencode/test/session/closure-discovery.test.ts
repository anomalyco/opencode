import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { BackgroundJob } from "@/background/job"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureDiscovery } from "@/session/closure/discovery"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionID } from "@/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { noAnswer, syntheticAdmission } from "../lib/background"
import { admittingJobs } from "../lib/closure"
import { pollWithTimeout, testEffectBounded } from "../lib/effect"

// The runtime-resident active-leaf adapters that branch cancellation discovers work through.
//
// The sharp case is the one this file exists for: a running job must be authoritative WHILE every
// status projection reads idle. That is the defect the adapters exist to close — a selected ancestor
// can appear idle while hidden descendant work is still active — so a fixture where status also
// reports busy would prove nothing about the case it claims to cover.
//
// The adapter enumerates; it classifies nothing. No assertion here expects a proof value.

/**
 * Admits execution AND job binds. `admittingClosure` cannot be reused: its `acquire` dies, and
 * `SessionRunState.ensureRunning` acquires an execution lease before it will start a Runner.
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
          lease: Model.id("lease", `lease_discovery_${leases}`),
          epoch: 0n,
          instance: Model.id("instance", "instance_discovery"),
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

/**
 * One registry each, shared by every adapter in the graph.
 *
 * That property is what these tests depend on and it is easy to lose: an adapter built beside its
 * dependencies rather than from them gets its own `SessionRunState` and `BackgroundJob`, and then
 * reports on registries nothing else in the test can reach. Resolving the node graph gives it by
 * construction — `SessionClosureDiscovery` depends on `SessionRunState`, `BackgroundJob` and
 * `SessionPhysical`, each of those on `SessionClosure`, and the builder memoises every node — so
 * the physical adapter and the adapter under test necessarily share one Runner registry.
 *
 * The group names the services the tests resolve directly, which publishes them. The override is
 * what pins the fake coordinator into every dependent at once.
 */
const graph = (closure: typeof admitting) =>
  LayerNode.compile(
    LayerNode.group([
      SessionClosureDiscovery.node,
      SessionRunState.node,
      SessionStatus.node,
      BackgroundJob.node,
      Database.node,
    ]),
    [[SessionClosure.node, closure]],
  )

const it = testEffectBounded(graph(admitting))

/**
 * A second closure fake whose `jobStart` PARKS, holding a registered token before it can arm.
 *
 * This is the only shape that separates the `state` axis from a status proxy. A registered-unarmed
 * token already reports `status: "running"`, so every fixture where the job has armed is satisfied
 * equally well by an implementation that derives `state` from `status` — the axis would be carried
 * but unproven. Parking the arm is what makes the two disagree.
 *
 * The gate is module-scoped because the layer is built before any test body runs; `Deferred.make`
 * is synchronous, so `runSync` is honest here.
 */
const armGate = Effect.runSync(Deferred.make<void>())
const parkedAdmitting = Layer.succeed(
  SessionClosure.Service,
  SessionClosure.Service.of({
    ...admittingJobs,
    jobStart: () => Deferred.await(armGate).pipe(Effect.andThen(admittingJobs.jobStart())),
    acquire: () =>
      Effect.succeed({
        type: "admitted" as const,
        lease: Model.id("lease", "lease_discovery_parked"),
        epoch: 0n,
        instance: Model.id("instance", "instance_discovery"),
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

const itParked = testEffectBounded(graph(parkedAdmitting))

// A Runner's work and interrupt channels are typed `SessionV1.WithParts`. Nothing here inspects the
// value — the tests assert on Runner STATE, not on results — so a minimal stand-in is honest.
const reply = {} as SessionV1.WithParts

describe("closure.discovery", () => {
  it.instance("a running job is active-leaf evidence while every status projection reads idle", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const projections = yield* SessionStatus.Service
      const adapter = yield* SessionClosureDiscovery.Service

      const parent = SessionID.make("ses_k6_owner")
      const child = SessionID.make("ses_k6_target")
      const release = yield* Deferred.make<string>()

      const started = yield* background.startExact({
        id: "job_k6",
        type: "test",
        run: Deferred.await(release).pipe(Effect.as(noAnswer)),
        admission: syntheticAdmission("k6"),
        metadata: { sessionId: child, parentSessionId: parent },
      })

      return yield* Effect.gen(function* () {
        // Precondition, not the assertion: the job is genuinely RUNNING. Without this the row could
        // pass against a terminal job, which would prove nothing about hidden active work.
        expect(started.lifetime).toBeDefined()
        const live = yield* background.getExact(started.lifetime!)
        expect(live?.status).toBe("running")

        // The other half of the precondition, and the half that makes this a disagreement test
        // rather than a generic enumeration test: EVERY status projection reads idle/zero while
        // that job runs.
        expect((yield* projections.list()).size).toBe(0)
        expect((yield* projections.get(child)).type).toBe("idle")
        expect((yield* projections.get(parent)).type).toBe("idle")

        // And no Runner exists, so the job evidence cannot be an echo of runner state either. This
        // job is authoritative entirely on its own.
        expect(yield* adapter.runners).toHaveLength(0)

        const jobs = yield* adapter.jobs
        const found = jobs.find((item) => item.job === "job_k6")
        expect(found).toBeDefined()
        expect(found?.status).toBe("running")
        // The lifetime phase, which `status` cannot express: sequence zero armed before forking.
        expect(found?.state).toBe("armed")
        // The owner/target coordinates, carried from the job's metadata.
        expect(found?.target).toBe(child)
        expect(found?.owner).toBe(parent)
      }).pipe(
        // Release on EVERY path. A parked run fiber would otherwise keep the suite's scope from
        // closing, which turns a failing assertion into a hang that cannot report itself.
        Effect.ensuring(Deferred.succeed(release, "done").pipe(Effect.asVoid)),
      )
    }),
  )

  it.instance("a live Runner is reported, so an empty runner list is a fact and not a default", () =>
    Effect.gen(function* () {
      const runState = yield* SessionRunState.Service
      const adapter = yield* SessionClosureDiscovery.Service

      const session = SessionID.make("ses_runner_axis")
      const release = yield* Deferred.make<SessionV1.WithParts>()

      // The test above asserts `runners` is EMPTY. That assertion is satisfied just as well by an
      // adapter that can never report anything, so this one proves the same call reports a real
      // Runner — otherwise that expected value is reachable by a second route.
      expect(yield* adapter.runners).toHaveLength(0)

      const fiber = yield* runState
        .ensureRunning(session, Effect.succeed(reply), Deferred.await(release))
        .pipe(Effect.forkScoped)

      return yield* Effect.gen(function* () {
        const active = yield* pollWithTimeout(
          adapter.runners.pipe(Effect.map((items) => (items.length > 0 ? items : undefined))),
          "a busy Runner never appeared in discovery evidence",
        )
        expect(active).toHaveLength(1)
        expect(active[0]?.session).toBe(session)
        expect(active[0]?.running).toBe(true)
        expect(active[0]?.shell).toBe(false)
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(release, reply).pipe(Effect.andThen(Fiber.join(fiber)), Effect.exit, Effect.asVoid),
        ),
      )
    }),
  )

  itParked.instance("an unarmed token is reported by lifetime phase, which `status` cannot express", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const adapter = yield* SessionClosureDiscovery.Service
      const child = SessionID.make("ses_unarmed_target")

      // The arm parks inside `jobStart`, so this token sits registered-but-not-armed for as long as
      // the gate is shut. Forked, because the parked arm would otherwise block the test body.
      // `jobStart` is reached AFTER the registry's own lock is released, so enumeration still works.
      const fiber = yield* background
        .startExact({
          id: "job_unarmed",
          type: "test",
          run: Effect.succeed(noAnswer),
          admission: syntheticAdmission("unarmed"),
          metadata: { sessionId: child },
        })
        .pipe(Effect.forkScoped)

      return yield* Effect.gen(function* () {
        const found = yield* pollWithTimeout(
          adapter.jobs.pipe(Effect.map((items) => items.find((item) => item.job === "job_unarmed"))),
          "the registered token never appeared in discovery evidence",
        )

        // The precondition that makes this a discriminator rather than another enumeration test: the
        // PUBLIC status already reads "running" for a token that has NOT armed. An implementation
        // deriving `state` from `status` answers "armed" here, and only this fixture catches it.
        expect(found.status).toBe("running")
        expect(found.state).not.toBe("armed")
        expect(["registered_unarmed", "binding"]).toContain(found.state)
        // The coordinate travels while unarmed too: this token counts as an active leaf precisely
        // because its admission can still create work.
        expect(found.target).toBe(child)
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(armGate, undefined).pipe(Effect.andThen(Fiber.join(fiber)), Effect.exit, Effect.asVoid),
        ),
      )
    }),
  )
})
