import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Context, Deferred, Effect, Fiber, Layer, Queue, Ref } from "effect"
import { BackgroundJob } from "@/background/job"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { AttachmentParticipant } from "@/session/attachment/participant"
import { Workspace } from "@/control-plane/workspace"
import { SessionStatus } from "@/session/status"
import { Session } from "@/session/session"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts } from "@/session/closure/ports"
import { SessionClosureDiscovery } from "@/session/closure/discovery"
import { SessionClosureHighWater } from "@/session/closure/high-water"
import { SessionClosureRecord } from "@/session/closure/record"
import { SessionClosureIdentity } from "@/session/closure/identity"
import { SessionClosureLineage } from "@/session/closure/lineage"
import { SessionClosureLocation } from "@/session/closure/location"
import { SessionClosureToolPart } from "@/session/closure/toolpart"
import { SessionClosureRunState } from "@/session/closure/run-state"
import { SessionCompaction } from "@/session/compaction"
import { SessionRunState } from "@/session/run-state"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it, testEffect } from "../lib/effect"

type AnyNode = LayerNode.Node<unknown, unknown, any>

const reachable = (root: AnyNode) => {
  const seen = new Set<AnyNode>()
  const walk = (node: AnyNode) => {
    if (seen.has(node)) return
    seen.add(node)
    node.dependencies.forEach(walk)
  }
  walk(root)
  return seen
}

const runState: SessionClosurePorts.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

describe("SessionClosure LayerNode graph", () => {
  it.live("D3 compiles and builds the acyclic closure-to-RunState integration graph", () =>
    Effect.gen(function* () {
      expect(SessionClosure.node.dependencies).toEqual([SessionClosurePorts.node, SessionToolPartPermit.node])
      expect(SessionClosure.node.dependencies.includes(SessionRunState.node)).toBe(false)

      /**
       * §7.5's permit registry, held from BOTH sides of the Session/closure boundary.
       *
       * `SessionClosure.node` is inside the closure graph and `SessionClosureToolPart.node` is
       * downstream of `Session`, which itself depends on `SessionClosure`. A shared node reached
       * from both is safe only while it depends on nothing — so this pair of assertions is the same
       * fact `SessionClosurePorts.node.dependencies` carries below, for the second dependency-free
       * node this design now rests on.
       *
        * IT MUST BE ONE NODE, not two layers with the same shape. `LayerNode.compile` caches by
       * node, so a single node reached twice compiles once and both holders resolve the SAME service
       * — which is what keeps the issue side and the consume side on one per-Instance registry. Two
       * registries would not fail loudly: `issue` would simply never find the coordinator's grant,
       * and every ToolPart would degrade to `unknown` while the suite stayed green.
       */
      expect(SessionToolPartPermit.node.dependencies).toEqual([])
      expect(SessionClosureToolPart.node.dependencies).toEqual([Session.node, SessionToolPartPermit.node])
      expect(reachable(SessionToolPartPermit.node).has(SessionClosure.node)).toBe(false)
      expect(reachable(SessionToolPartPermit.node).has(Session.node)).toBe(false)
      // Gate 5's request adapters are assembled here. Five transitively reach SessionClosure.node —
      // Discovery through SessionRunState/BackgroundJob/SessionPhysical and the Session-backed
      // adapters through Session — so a node providing Ports.Service could not depend on them
      // without closing a cycle. HighWater is the deliberate exception: it depends only on Database,
      // but remains request-borne so the capability has one source and no fallback.
      expect(SessionClosureRunState.node.dependencies).toEqual([
        SessionClosure.node,
        SessionRunState.node,
        SessionClosureDiscovery.node,
        SessionClosureLineage.node,
        SessionClosureToolPart.node,
        SessionClosureLocation.node,
        SessionClosureIdentity.node,
        SessionClosureHighWater.node,
        SessionClosureRecord.node,
      ])

      // The load-bearing direction check for the five closure-reaching adapters. Each must reach the
      // coordinator (WHY it cannot be a Ports dependency) and must NOT reach this node (why it is
      // safe here). Asserting only the first would pass for an adapter wired the wrong way round.
      for (const adapter of [
        SessionClosureDiscovery.node,
        SessionClosureLineage.node,
        SessionClosureToolPart.node,
        SessionClosureLocation.node,
        SessionClosureIdentity.node,
      ]) {
        expect(reachable(adapter).has(SessionClosure.node)).toBe(true)
        expect(reachable(adapter).has(SessionClosureRunState.node)).toBe(false)
      }

      // HighWater's ruled backing service is Database, not Session. This negative assertion keeps a
      // later convenience refactor from silently coupling timestamp arithmetic to Session/closure.
      expect(reachable(SessionClosureHighWater.node).has(SessionClosure.node)).toBe(false)
      expect(reachable(SessionClosureHighWater.node).has(SessionClosureRunState.node)).toBe(false)
      expect(reachable(SessionClosureRecord.node).has(SessionClosure.node)).toBe(false)
      expect(reachable(SessionClosureRecord.node).has(SessionClosureRunState.node)).toBe(false)

      // Ports must not REACH any service that depends on closure. That is the mechanism the whole
      // late-binding design rests on: the moment Ports acquires an edge toward one of those adapters,
      // `SessionClosure -> Ports -> Discovery -> SessionRunState -> SessionClosure` closes and
      // `LayerNode.compile` detects and reports a cycle rather than constructing the graph.
      //
      // ASSERTED AS REACHABILITY RATHER THAN AS AN EMPTY LIST, and the correction is itself evidence.
      // This line read `toEqual([])` until Gate 8 gave Ports two LEAF dependencies, at which point it
      // went red and stayed red — an artifact guard that broke the moment the artifact changed while
      // the mechanism it stood for was perfectly intact. `ports.ts` states the rule in terms: "`deps:
      // []` was SUFFICIENT for that, never NECESSARY, and guarding the empty list rather than the
      // reachability rule is the artifact-versus-mechanism error this CP has now hit three times."
      // Guarding reach means a future editor may add a dependency and is stopped only if its
      // TRANSITIVE closure actually closes the loop — which is the property, not its 2026 shape.
      expect(reachable(SessionClosurePorts.node).has(SessionClosure.node)).toBe(false)
      expect(reachable(SessionClosurePorts.node).has(SessionClosureRunState.node)).toBe(false)
      expect(reachable(SessionClosurePorts.node).has(SessionRunState.node)).toBe(false)

      // D3 trap: a Gate-3 admission guard inside SessionRunState must depend on SessionClosure.node,
      // never on SessionClosureRunState.node — the latter closes a cycle that LayerNode.compile
      // detects and rejects.
      // Gate 3 took the required edge: the guard consumes the coordinator directly.
      expect(SessionRunState.node.dependencies).toEqual([BackgroundJob.node, SessionStatus.node, SessionClosure.node])
      expect(SessionRunState.node.dependencies.includes(SessionClosureRunState.node)).toBe(false)
      expect(reachable(SessionRunState.node).has(SessionClosureRunState.node)).toBe(false)

      // Gate 6 K95 makes Workspace a CONSUMER of the assembled request service. The reverse
      // reachability assertion is the cycle discriminator: a direct dependency can look correct while
      // a transitive Workspace edge underneath RunState makes LayerNode.compile reject the graph.
      expect(Workspace.node.dependencies.includes(SessionClosureRunState.node)).toBe(true)
      expect(reachable(SessionClosureRunState.node).has(Workspace.node)).toBe(false)
      expect(() => LayerNode.compile(LayerNode.group([Workspace.node]))).not.toThrow()

      // Slice G took the same edge for SessionCompaction, whose prune now holds a `replace_part`
      // lease. Same trap, same rule: depend on SessionClosure.node, never on
      // SessionClosureRunState.node. The `reachable` check is the load-bearing one — the direct
      // `includes` assertions would still pass if a cycle arrived through a transitive dependency.
      expect(SessionCompaction.node.dependencies.includes(SessionClosure.node)).toBe(true)
      expect(SessionCompaction.node.dependencies.includes(SessionClosureRunState.node)).toBe(false)
      expect(reachable(SessionCompaction.node).has(SessionClosureRunState.node)).toBe(false)
      expect(reachable(SessionCompaction.node).has(SessionClosure.node)).toBe(true)

      const graph = LayerNode.group([SessionClosure.node, SessionClosureRunState.node])
      const compiled = LayerNode.compile(graph)
      const context = yield* Layer.build(compiled)
      expect(Context.get(context, SessionClosureRunState.Service)).toBeDefined()

      // Gate 3 needs SessionClosure.Service itself reachable from the app graph. Compile publishes
      // exactly its top-level nodes, so this only holds while SessionClosure.node stays listed.
      const closure = Context.get(context, SessionClosure.Service)
      expect(closure).toBeDefined()

      // …and it must be the same coordinator the integration service already wraps. `view`/`identity`
      // are forwarded by reference in run-state.ts, so reference equality proves one shared instance
      // and therefore that publishing the node changed nothing an existing consumer resolves.
      const integration = Context.get(context, SessionClosureRunState.Service)
      expect(integration.view).toBe(closure.view)
      expect(integration.identity).toBe(closure.identity)
    }),
  )

  it.live(
    "§18 G8-01 + Gate-8 Finding 3: the PRODUCTION Ports graph DELIVERS the participant, and the flag alone decides",
    () =>
      /**
       * THE INERT-WIRING CASE, which nothing else in this suite could have caught.
       *
       * This file already records the hazard in its own words: through Gate 4 the driver's
       * capabilities "were supplied only by test-authored `RuntimePorts`", and §6.9 calls a production
       * path that differs from the test path this program's most productive defect source. EVERY
       * closure fixture — including this file at two of its own sites — hands `SessionClosure` a
       * hand-built `participants: []`. So a participant-bearing node could compile perfectly as an
       * inert sibling while the real `SessionClosure` received an empty list, and not one existing
       * assertion in the suite would move.
       *
       * `ports.ts` states exactly why that failure is AVAILABLE rather than hypothetical:
       * `LayerNode.compile` "resolves strictly by the declared `deps` object graph ... there is no
       * service-tag lookup across the assembled group, so a participant-bearing sibling node would
       * compile into the `provideMerge` fold while `SessionClosure` still received this module's
       * `participants` — correct-looking surface, inert on the path that matters".
       *
       * So this row resolves the REAL `SessionClosurePorts.layer` and reads what it actually hands
       * out. It is deliberately BEHAVIOURAL rather than a source-shape guard: the D3 assertion above
       * was a source-shape guard that broke SILENTLY the moment its artifact changed while the
       * mechanism was intact, and repeating that shape here would repeat that failure.
       *
       * The flag-off arm is the positive control that keeps the flag-on arm honest — asserting a list
       * is non-empty proves nothing if it could never have been empty — and it is simultaneously
       * G8-01's feature-off property read OFF the production graph rather than asserted about it.
       */
      Effect.gen(function* () {
        const identity: SessionClosurePorts.RuntimeIdentity = {
          instance: Model.id("instance", "inst_g8_wiring"),
          directory: "/g8-wiring",
          worktree: "/g8-wiring",
          project: "g8-wiring",
          workspace: "g8-wiring",
        }
        const delivered = (enabled: boolean) =>
          Effect.gen(function* () {
            const ports = yield* SessionClosurePorts.Service
            const runtime = yield* ports.make(identity)
            return runtime.participants
          }).pipe(
            Effect.provide(
              SessionClosurePorts.layer.pipe(
                Layer.provide(AttachmentCoordinator.layer),
                Layer.provide(RuntimeFlags.layer({ experimentalBackgroundSubagents: enabled })),
              ),
            ),
          )

        const on = yield* delivered(true)
        expect(on.map((item) => item.id)).toEqual([AttachmentParticipant.ID])
        expect(typeof on[0]?.discover).toBe("function")
        expect(typeof on[0]?.claim).toBe("function")
        expect(typeof on[0]?.cancel).toBe("function")
        expect(typeof on[0]?.observe).toBe("function")

        const off = yield* delivered(false)
        expect(off).toEqual([])
      }),
  )

  it.live("the actual Instance HttpApi LayerNode graph publishes the coordinator and the integration", () =>
    Effect.promise(() => import("@/server/routes/instance/httpapi/server")).pipe(
      Effect.tap((server) =>
        Effect.sync(() => {
          expect(server.routes).toBeDefined()
          expect(server.app.dependencies.includes(SessionClosure.node)).toBe(true)
          expect(server.app.dependencies.includes(SessionClosureRunState.node)).toBe(true)
          expect(server.app.dependencies.includes(SessionRunState.node)).toBe(true)

          // The target leaves `InstanceStore.bootstrapNode` intentionally unbound and production
          // binds it through `AppNodeBuilderV1`. Building the actual graph through that same seam
          // preserves the cycle check without treating the target's bootstrap boundary as missing.
          expect(() => AppNodeBuilderV1.build(server.app)).not.toThrow()
        }),
      ),
      Effect.asVoid,
    ),
  )

  it.live("the shipped SessionClosure and Ports default layers fail a request closed", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const identity = yield* closure.identity
        expect(identity.directory).toBe(directory)

        // The production Ports node ships the REAL driver as of Gate 5 slice B1, and supplies it no
        // `discovery` — so the run advances to `fencing`, then `quiescing`, then takes §8.5's
        // fail-closed return. The worker exits unproved, its finalizer emits worker.exited, and the
        // request settles as a typed failure rather than hanging or succeeding.
        //
        // THE KIND CHANGED AT SLICE D, and the previous note here is why the row existed. Through
        // Gate 4 this settled `closure_unavailable` — §12.2's "current worker defects" — because the
        // driver returned bare and the exit seam inferred it. §6.9's known-open item 5 recorded that
        // as a misattribution owed its own row; the driver now declares `quiescence_failed` at the
        // return, which is §12.2's "stable scan cannot be proved" and what actually happened.
        //
        // This assertion still cannot tell a real driver from a stub — both fail, and the stub's
        // fabricated kind would differ but a reader cannot see that here — which is why the B1 test
        // below exists. The control that keeps `closure_unavailable` REACHABLE is the next test.
        const failure = yield* closure
          .request({ root: SessionID.make("ses_gate2_default_layer"), runState })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("SessionClosureError")
        if (failure._tag !== "SessionClosureError") return
        expect(failure.kind).toBe("quiescence_failed")

        const view = yield* closure.view
        expect(view.operations[0]?.phase.type).toBe("quiescence_failed")
        expect(view.operations[0]?.driver.state).toBe("failed")
      }).pipe(Effect.provide(LayerNode.compile(SessionClosure.node)), provideInstanceEffect(directory))
    }).pipe(Effect.provide(services)),
  )

  /**
   * THE CONTROL FOR SLICE D, and the reason the slice is a correction rather than a relabelling.
   *
   * Slice D made an unproved return report `quiescence_failed`. The failure mode that invites is
   * making EVERY failure report it — at which point `closure_unavailable` becomes unreachable and
   * §12.2's two kinds stop distinguishing anything. §6.9's known-open item 5 asks for "its own row
   * and its own control"; the row is in `closure-driver.test.ts`, and this is the control.
   *
   * A DEFECTING WORKER IS THE THING THE OTHER KIND IS FOR. Here the driver genuinely dies, which is
   * §12.2's "current worker defects" and the §6.5 matrix's "unexpected worker exit" — nothing
   * declared a quiescence outcome, so the exit seam infers, and inferring is CORRECT for this case.
   * That is precisely the distinction `unproved` preserves: it declares only where the driver stopped
   * deliberately, and leaves the inference intact everywhere else.
   */
  it.live("a DEFECTING worker still reports the worker-defect kind, so §12.2's two kinds stay distinct", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const failure = yield* closure
          .request({ root: SessionID.make("ses_gate5_worker_defect"), runState })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("SessionClosureError")
        if (failure._tag !== "SessionClosureError") return
        expect(failure.kind).toBe("closure_unavailable")

        const view = yield* closure.view
        expect(view.operations[0]?.phase.type).toBe("closure_unavailable")
      }).pipe(
        Effect.provide(
          SessionClosure.layer.pipe(
            Layer.provide(SessionToolPartPermit.layer),
            Layer.provide(
              SessionClosurePorts.makeLayer(() =>
                Effect.succeed({
                  // Dies rather than returning. The real driver's every deliberate exit declares or
                  // returns cleanly, so a defect is the one shape that must still reach the seam.
                  driver: { run: () => Effect.die("worker defect"), command: () => Effect.void },
                  participants: [],
                  hooks: {},
                }),
              ),
            ),
          ),
        ),
        provideInstanceEffect(directory),
      )
    }).pipe(Effect.provide(services)),
  )

  /**
   * THE NODE-GRAPH PATH, which nothing else in this file builds.
   *
   * Every other test here composes through `LayerNode.compile` (the NODE path, used by
   * `server.ts`) or builds `SessionClosure.node` alone. The combined SessionClosureRunState graph
   * is a third path and it is the one `app-runtime.ts` uses — so it deserves its own assertion,
   * especially now that Gate 5 grew it from two providers to six: SessionClosure, SessionRunState,
   * Discovery, Lineage, ToolPart and Location. Those transitively re-provide `Session`,
   * `BackgroundJob` and `SessionPhysical`, and `Session` itself self-provides `SessionClosure`.
   *
   * THE PROPERTY IS ONE COORDINATOR, not merely that it builds. `Layer` memoises on layer OBJECT
   * identity, so the repeated `SessionClosure.node` deep in those chains should collapse to a
   * single instance. If it did not, this would compile and be silently wrong in exactly the way
   * `app-runtime.ts` warns about — the admission seam asking one coordinator while the job binder
   * asks another.
   *
   * ASSERTED ON COORDINATOR STATE, and the first attempt is worth recording because it was VACUOUS.
   * Comparing `RuntimeIdentity.instance` looked like a direct test of the collapse and is not:
   * that id is derived from the routed Instance, so two distinct coordinators in one directory
   * report the SAME value. Hand-falsified with `Layer.fresh` forcing a second build, it stayed green.
   * An operation, by contrast, lives in exactly one coordinator's state — so running one through the
   * wrapper and finding it in the PUBLISHED service's view is a fact no shared identity can fake.
   */
  it.live("the SessionClosureRunState node graph resolves the SAME coordinator the graph publishes", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const integration = yield* SessionClosureRunState.Service
        const closure = yield* SessionClosure.Service
        const session = yield* Session.Service

        /**
         * A REAL Session, and slice C is why it has to be. The first draft named a synthetic id and
         * got `SessionClosureLocationError`: the wrapper now supplies §5.1's Location gate, which
         * refuses an unpersisted root before the coordinator raises a driver at all. That refusal is
         * C working, and it means a synthetic root can no longer reach the seam this test is about.
         */
        const created = yield* session.create({ title: "shared-coordinator" })

        /**
         * The wrapper's own coordinator runs this, and it now SUCCEEDS - CP-023 Gate 6.
         *
         * This row previously asserted a failure, and its own note said the kind was left unpinned
         * because it "reflects Gate 5's unfinished record phase" and would "pin this row to an
         * incompleteness that is scheduled to change". Gate 6 is that change: a freshly created
         * Session has no in-scope active work, and 0.5 says such a request "remains HTTP 200/`true`
         * and writes no record". The failure this row rested on was the defect where a work-free
         * operation minted a generation with no referent and then failed its own release verification.
         *
         * POSITIVE PRECONDITION, preserved and strengthened. A success outcome carries the operation
         * and view IDs the coordinator allocated, which proves the request passed 5.1's Location gate
         * and reached the COORDINATOR just as the old `SessionClosureError` assertion did - a Location
         * refusal never raises a driver and would leave nothing for the discriminator to find.
         */
        const outcome = yield* integration.request(created.id)
        expect(outcome.operation).toBeTruthy()

        // THE DISCRIMINATOR, unchanged and still the point of this row. `closure` is resolved from
        // the graph's published `SessionClosure`, not through the wrapper. Seeing the wrapper's own
        // operation here means both names denote one coordinator; a second instance would hold an
        // empty operation set.
        const view = yield* closure.view
        expect(view.operations).toHaveLength(1)
        expect(view.operations[0]?.id).toBe(outcome.operation)
      }).pipe(
        // The target has no `defaultLayer` composition. One compiled node graph is its equivalent:
        // `LayerNode.compile` memoizes each node identity across the group, so `SessionClosureRunState`,
        // `Session` and the published `SessionClosure` resolve the same coordinator. The discriminator
        // above verifies that the resulting published services observe that one coordinator.
        Effect.provide(
          LayerNode.compile(LayerNode.group([SessionClosureRunState.node, Session.node, SessionClosure.node])),
        ),
        provideInstanceEffect(directory),
      )
    }).pipe(Effect.provide(services)),
  )
})

// ---------------------------------------------------------------------------
// THE PRODUCTION GRAPH DRIVES REQUEST-BORNE CAPABILITIES — Gate 5 slices B1 and B2.
//
// Gate 4 built `FENCE_AND_QUIESCE` and assembled it nowhere. `SessionClosureDriver.make()` had
// exactly ONE construction site in the tree and it was a test file; discovery, lineage and toolPart
// were supplied only by test-authored `RuntimePorts`. §6.9 records that as the most consequential
// thing that gate handed forward: a production path that differs from the test path is this
// program's most productive defect source. B1 shipped the real driver; B2 moved the three evidence
// capabilities onto the REQUEST, which is the only seam that can carry them without closing a layer
// cycle — and is now the same seam `closure/run-state.ts` uses in production.
//
// WHY THESE TESTS EXIST RATHER THAN THE ONES ABOVE. Landing the real driver changed nothing any
// existing assertion could see, and that was MEASURED rather than assumed — the full 354-test closure
// suite stayed green across the change, because with no `discovery` the real driver takes §8.5's
// fail-closed return and settles `closure_unavailable`, exactly the observable the no-op produced.
// §6.9's standing check applies directly: before recording that a mechanism closes a gap, ask what
// would have to be true for the gap to be reachable at all. Nothing already here could falsify it.
//
// WHAT DRIVING THE REAL GRAPH REVEALED, AND WHY SLICE C EXISTS. `validateSession` is a FOURTH
// capability of exactly the same shape, and B2 found it unsupplied in production. Its absence is
// FAIL-CLOSED: `coordinator.ts` reads an absent `validateSession` as `false` for any session that
// does not already hold an epoch, and `model.ts::create` seeds an epoch only for the REQUESTED ROOT.
// So the production graph could claim the root and nothing else — every discovered descendant was
// rejected with a `LocationError` at claim time, ending the run before any signal was dispatched.
//
// It survived four gates because both halves of the hazard were present at once: the stub driver
// never reached the claim gate, and every driver fixture supplies `validateSession: () => true`. The
// test path had it and the production path did not.
//
// Slice C supplies it, from `closure/location.ts` through the same request seam. §5.1 settles the
// semantics without inventing any — "validates its persisted Location/workspace metadata against the
// current routed Instance" — and §5.1's C-S3 disposition settles the placement by describing the
// bound as TWO mechanisms, "directory-keyed `InstanceState` PLUS validated Location/workspace
// metadata", which K46 splits by verb: (d) distinct Sessions "cannot cross-claim", structural; (b) a
// wrong Location "rejects", this check.
//
// THE DECLARED LIMIT B2 WROTE HERE DID ITS JOB. That assertion said the run stops at the gate, and
// recorded that a later slice closing the gap SHOULD turn it red. It did, on the first run after
// slice C landed — which is why the A/B below is now an assertion about the gate's REACH rather than
// about its absence.

const B1_ROOT = "ses_b1_root"
const B1_CHILD = "ses_b1_child"

/**
 * One live Task edge that is gone by the second sweep.
 *
 * `runners` advances the sweep counter and `jobs` answers from it, pinning one frame per pass — the
 * discipline `closure-driver.test.ts::world` uses, and for its reason: a world that kept changing
 * could not distinguish convergence from a driver that never converges. Sweep 1 shows the edge, so
 * the driver must claim, fence and signal; sweep 2 is empty, so it converges on the proof it
 * accumulated rather than on fresh evidence.
 */
const b1World = (signals: Ref.Ref<readonly string[]>, sweeps: Ref.Ref<number>) =>
  ({
    runners: Ref.update(sweeps, (count) => count + 1).pipe(
      Effect.map(() => [] as readonly SessionClosurePorts.RunnerEvidence[]),
    ),
    jobs: Ref.get(sweeps).pipe(
      Effect.map((count): readonly SessionClosurePorts.JobEvidence[] =>
        count === 1
          ? [
              {
                job: "job_b1",
                state: "armed",
                // Idle on purpose. §8.2 makes status a diagnostic rather than active-leaf authority,
                // so a fixture whose status agreed with its lifetime state could not tell an
                // authority-respecting driver from one proxying status.
                status: "completed",
                owner: SessionID.make(B1_ROOT),
                target: SessionID.make(B1_CHILD),
                // §8.3's Task coordinates, written to job metadata by `task.ts` and surfaced by
                // `discovery.ts`. Carried here because `capture` skips `terminalize` when either is
                // absent — the absent-COORDINATE half of §8.5's fail-closed reading — so without
                // them the toolPart assertion below would be vacuously empty for the right reason
                // and prove nothing about forwarding.
                taskMessage: "msg_b1",
                taskCall: "call_b1",
                interrupt: Ref.update(signals, (current) => [...current, "job:job_b1"]).pipe(
                  Effect.as("interrupted" as const),
                ),
              },
            ]
          : [],
      ),
    ),
  }) satisfies SessionClosurePorts.DiscoveryCapability

type B1Run = {
  readonly sweeps: number
  readonly signals: readonly string[]
  readonly toolPartCalls: readonly string[]
  readonly lineageCalls: number
}

/**
 * One closure request through the FULLY UNSUBSTITUTED production graph, with every capability
 * supplied on the REQUEST — the seam `closure/run-state.ts` uses in production.
 *
 * Both arms build `SessionClosure.node`, which reaches the production Ports node and
 * therefore the real driver. Nothing is substituted in either. The ONLY difference is whether
 * `validateSession` is on the request, which is what makes the pair an A/B about §5.1's Location gate
 * rather than about two different graphs.
 *
 * REBUILT AT SLICE C, and the previous shape is worth recording because it went silently vacuous.
 * Through B2 the `validate: true` arm injected `validateSession` through a substituted
 * `RuntimePorts`. Slice C moved that capability onto the request, so the injected field became a
 * property nothing read — the arm still compiled, still ran, and controlled nothing. A control that
 * stops controlling is worse than an absent one, because the assertions around it keep passing.
 */
const b1Run = (validate: boolean) =>
  Effect.gen(function* () {
    const signals = yield* Ref.make<readonly string[]>([])
    const sweeps = yield* Ref.make(0)
    const toolPartCalls = yield* Ref.make<readonly string[]>([])
    const lineageCalls = yield* Ref.make(0)

    const directory = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const closure = yield* SessionClosure.Service
      // Fails once the worker exits without a record phase — `RECORD_AND_CLOSE` is not complete, so
      // the outcome is `closure_unavailable` in BOTH arms and cannot discriminate. What the driver
      // DID is the observable, and it is captured in test-owned Refs that survive the failure.
      yield* closure
        .request({
          root: SessionID.make(B1_ROOT),
          runState,
          discovery: b1World(signals, sweeps),
          lineage: { parents: () => Ref.update(lineageCalls, (count) => count + 1).pipe(Effect.as([])) },
          toolPart: {
            terminalize: (call) =>
              Ref.update(toolPartCalls, (current) => [
                ...current,
                `${String(call.session)}/${String(call.message)}/${call.call}`,
              ]).pipe(Effect.as({ outcome: "cancelled" as const })),
          },
          // The sessions in this fixture are synthetic, so a real Location lookup would refuse them
          // all. Answering `true` isolates the GATE's effect on the driver's reach; the real adapter
          // is `closure-location.test.ts`, and its production wiring is asserted below.
          ...(validate ? { validateSession: () => Effect.succeed(true) } : {}),
        })
        .pipe(Effect.exit)
    }).pipe(Effect.provide(LayerNode.compile(SessionClosure.node)), provideInstanceEffect(directory))

    return {
      sweeps: yield* Ref.get(sweeps),
      signals: yield* Ref.get(signals),
      toolPartCalls: yield* Ref.get(toolPartCalls),
      lineageCalls: yield* Ref.get(lineageCalls),
    } satisfies B1Run
  })

describe("the production closure graph drives request-borne capabilities", () => {
  it.live("every capability reaches the real driver through the unsubstituted graph, and the Location gate bounds its reach", () =>
    Effect.gen(function* () {
      const ungated = yield* b1Run(false)
      const gated = yield* b1Run(true)

      // B1 + B2's POSITIVE CLAIM. Nothing is substituted: `SessionClosure.node` reaches
      // the production Ports, the driver is the real one, and the capability arrived on the request.
      // A stub driver enumerates nothing, and a capability that failed to reach the driver would
      // enumerate nothing either — so a non-zero sweep count is exactly "the request-borne discovery
      // reached the real driver through the real graph".
      expect(ungated.sweeps).toBeGreaterThan(0)

      // §5.1's GATE, OBSERVED. Without a Location capability the claim refuses every session that
      // holds no epoch, and only the requested root is epoch-seeded — so the discovered child is
      // rejected and the run ends before any signal. This is the state production was in through
      // Gate 4, and it is asserted rather than described.
      expect(ungated.signals).toEqual([])
      expect(ungated.toolPartCalls).toEqual([])

      // THE CONTROL. Same graph, same driver, same scripted world; one capability added to the
      // request. If the emptiness above came from a world that never offered work, this would be
      // empty too.
      expect(gated.signals).toEqual(["job:job_b1"])
      expect(gated.sweeps).toBeGreaterThan(ungated.sweeps)

      // A SECOND CAPABILITY, REACHED THROUGH THE SAME SEAM — and the one that proves the forwarding
      // chain rather than just its first link. `terminalize` is called from `capture`, which runs
      // only AFTER the fixed point holds, so this coordinate could not appear unless the request's
      // `toolPart` survived request -> ticket -> worker -> `DriverRun` and the branch actually proved.
      // The exact triple is asserted rather than a count: these values originate in the scripted
      // job's metadata, so a driver that invented them would fail here.
      expect(gated.toolPartCalls).toEqual([`${B1_ROOT}/msg_b1/call_b1`])

      // Lineage is correctly NOT consulted: §8.4 step 4 reaches for it only to bridge an INCOMPLETE
      // edge, and this fixture's edge carries both endpoints. Asserted rather than omitted, because
      // "never called" is the claim — a lineage consulted here would mean the driver was bridging a
      // path current evidence had already proven whole, which is the I-06 overreach `proof.ts`
      // exists to prevent. Its request-borne forwarding is covered by closure-driver.test.ts, whose
      // whole harness now supplies all three capabilities through the request.
      expect(gated.lineageCalls).toBe(0)
    }).pipe(Effect.provide(services)),
  )
})

// ---------------------------------------------------------------------------
// ONE coordinator in the composed graph, not two.
//
// Slice M's feasibility spike measured that a `LayerNode.compile` substitution reached the
// services the HTTP handler resolves directly but NOT the closure captured inside `Session.layer`,
// and flagged the mechanism open. Two readings were available and they are not close. Benign: one
// shared coordinator, and the spike simply failed to substitute that binding. Serious: the composed
// graph instantiates `SessionClosure` TWICE, giving two fence registries — a fence raised through
// one invisible to the other, which would hollow out every Gate-2/3 admission and mutation lease in
// production rather than only in tests. The whole gate rests on the first reading.
//
// It is the first. Measured two independent ways.
//
//   (1) A COUNT. `Ports.Interface.make` runs exactly once per `makeRuntime` (coordinator.ts:1096),
//       and `makeRuntime` runs once per (coordinator instance x directory) through that instance's
//       OWN `InstanceState` ScopedCache (coordinator.ts:1455; instance-state.ts:30-45 allocates a
//       fresh cache per `make` call, so two coordinators could not share one). In a single-directory
//       graph the call count therefore IS the number of live coordinators. It is 1 after the
//       published coordinator and `Session`'s captured one have both built their runtimes.
//   (2) BEHAVIOUR, which depends on none of that reasoning: a real fence raised through the
//       PUBLISHED coordinator refuses `Session.replacePart`. One registry.
//
// WHY THE SPIKE MISSED IT — established by reproduction, not inferred. `Layer` memoization is keyed
// on layer OBJECT IDENTITY, and `packages/core/src/effect/memo-map.ts` exports ONE process-wide
// `MemoMap` shared by `server.ts:115,340`, `app-runtime.ts:52,114`, `bootstrap-runtime.ts:11` and
// `run-service.ts:7`. `Session.node` and `SessionClosure.node` are module-level constants reused
// by every composition, and `server.ts:335` builds `createRoutes()` at module load. So by the time a
// spike-time recompile carrying `replacements` is built through that shared map, `Session.node` is
// already memoized WITH THE ORIGINAL COORDINATOR; the substituted layer is a different object, so it
// publishes fresh at the top level while every already-memoized consumer keeps the original.
// Building the same graph twice through one `Layer.makeMemoMapUnsafe()` — plain first, substituted
// second — reproduces the spike's exact asymmetry: a direct call on build 2's published
// `SessionClosure.Service` reaches the stub, and `Session.replacePart` does not. Not two instances;
// one instance plus one stale memo hit.
//
// That reproduction is also the negative control for the test below. In the two-build configuration
// `Session` genuinely held a DIFFERENT coordinator and the fenced `replacePart` SUCCEEDED — so this
// instrument does discriminate, and its refusal is not a foregone conclusion.
//
// CARRIED TO GATE 4 AND NOW DISCHARGED THERE. `createRoutes(corsOptions?, replacements?)` has since
// landed, so this is live code rather than a forecast: a substituted graph MUST NOT be served from a
// shared memo map or the substitution is silently ignored for every already-built consumer.
// `testEffect` (isolatedRun) builds fresh; `testEffectShared` and `webHandler` do not. The seam
// closes it with `Layer.fresh`, and the two tests at the bottom of this file are what hold it shut.

type HeldRun = { readonly input: SessionClosurePorts.DriverRun; readonly release: Deferred.Deferred<void> }

const held: { queue?: Queue.Queue<HeldRun> } = {}

// Parks the closure run so its operation holds a fence for the duration of the assertions. The park
// is an interruptible `Deferred.await`, and the test releases it explicitly before returning.
const heldDriver: SessionClosurePorts.Driver = {
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(held.queue!, { input, release })
      yield* Deferred.await(release)
    }),
  command: () => Effect.void,
}

const coordinators: string[] = []

const countingPorts = SessionClosurePorts.makeLayer((identity) =>
  Effect.sync(() => {
    coordinators.push(identity.instance)
    return { driver: heldDriver, participants: [], hooks: {} }
  }),
)

// The real production nodes, composed by the real `LayerNode.compile`, with only Ports
// substituted for a driver that PARKS.
//
// WHY THE SUBSTITUTION IS STILL HERE, ON A DIFFERENT REASON THAN BEFORE. Through Gate 4 this comment
// read "`Ports.layer` never calls `control.claim`, so an unsubstituted graph cannot produce a fence
// to test against at all" — true of the no-op driver, and false since Gate 5 slice B1 shipped the
// real one, which claims and fences on its own. What the substitution buys now is CONTROL OF TIMING:
// `heldDriver` parks inside `run`, so the fence stands for the duration of the assertions instead of
// being raised and released before they execute. Substituting the COORDINATOR remains what this test
// must not do, since the coordinator's identity is the thing under measurement.
//
// The group is unchanged, but it now builds MORE than it lists: `SessionClosureRunState.node` gained
// the three evidence adapters at B2, so `SessionClosureDiscovery`, `SessionClosureLineage` and
// `SessionClosureToolPart` — and through them `BackgroundJob` and `SessionPhysical` — are built here
// transitively. That is what lets the second test below observe what the production supplier supplies.
const composed = LayerNode.compile(
  LayerNode.group([
    Session.node,
    // Present for the same reason it is present in the real `app` group (server.ts:238): the
    // projector is what turns the published events into rows, and the row assertions below are how
    // "the write did / did not happen" is checked rather than merely "the call returned".
    SessionProjector.node,
    SessionClosure.node,
    SessionRunState.node,
    SessionClosureRunState.node,
  ]),
  [[SessionClosurePorts.node, countingPorts]],
)

const itComposed = testEffect(
  Layer.mergeAll(composed, AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer),
)

describe("SessionClosure instance identity across the composed graph", () => {
  itComposed.instance(
    "a fence raised through the published coordinator refuses Session.replacePart — one registry",
    () =>
      Effect.gen(function* () {
        coordinators.length = 0
        held.queue = yield* Queue.unbounded<HeldRun>()

        const session = yield* Session.Service
        const closure = yield* SessionClosure.Service
        const integration = yield* SessionClosureRunState.Service
        const created = yield* session.create({ title: "closure-graph-identity" })
        const node = Model.id("session", created.id)

        const message = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user" as const,
          sessionID: created.id,
          agent: "default",
          model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") },
          time: { created: Date.now() },
        })
        const part = {
          id: PartID.ascending(),
          sessionID: created.id,
          messageID: message.id,
          type: "text" as const,
          text: "seed",
        }
        yield* session.updatePart(part)

        // Force the PUBLISHED coordinator to build its runtime, so the count below is not merely
        // "Session built one".
        yield* closure.identity

        // POSITIVE CONTROL A. Unfenced, the guarded destructive write succeeds through Session's own
        // captured coordinator and really changes the row. Without it the refusal below could come
        // from a guard that refuses unconditionally, or a harness that never reached a coordinator.
        yield* session.replacePart({ ...part, text: "control" })
        expect(textOf(yield* session.messages({ sessionID: created.id }))).toEqual(["control"])

        // INSTRUMENT (1). Two coordinators would have called `make` twice by now: once for the
        // published service and once for whatever `Session` captured.
        expect(coordinators).toHaveLength(1)

        // Gate 2's reference-equality instrument, re-checked in this larger composition — `view` and
        // `identity` are forwarded by reference in run-state.ts, so equality is instance identity.
        expect(integration.view).toBe(closure.view)
        expect(integration.identity).toBe(closure.identity)

        const pending = yield* closure.request({ root: created.id, runState }).pipe(Effect.forkScoped)
        const run = yield* Queue.take(held.queue)
        const claimed = yield* run.input.control.claim({
          operation: run.input.command.operation,
          proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
          signals: [Effect.succeed("success" as const)],
        })

        // POSITIVE CONTROL B. The claim applied and a fence for this exact session now exists in the
        // PUBLISHED coordinator's view — so the refusal below is a fence being observed, not a
        // request that failed for some unrelated reason.
        expect(claimed.decision).toEqual({ type: "applied" })
        const fences = (yield* closure.view).fences
        expect(fences.map((item) => item.session)).toEqual([node])

        // INSTRUMENT (2), AND THE LOAD-BEARING CLAIM. `Session.replacePart` consults the coordinator
        // captured at session.ts:538 — a private binding no test can reach directly. If that were a
        // second instance it would hold a second, empty fence registry and this write would succeed.
        const refused = yield* session.replacePart({ ...part, text: "fenced" }).pipe(Effect.flip)
        expect(refused._tag).toBe("SessionClosureMutationRefused")
        if (refused._tag !== "SessionClosureMutationRefused") return yield* Effect.die("expected a mutation refusal")
        expect(refused.kind).toBe("replace_part")
        expect(refused.reason).toBe("fenced")
        expect(refused.sessions).toEqual([created.id])

        // The refusal preceded the write, so the row still carries control A's value.
        expect(textOf(yield* session.messages({ sessionID: created.id }))).toEqual(["control"])
        expect(coordinators).toHaveLength(1)

        yield* Deferred.succeed(run.release, undefined)
        yield* Fiber.join(pending).pipe(Effect.exit)
      }),
    30000,
  )

  /**
   * THE PRODUCTION SUPPLIER ACTUALLY SUPPLIES — Gate 5 slice B2's closing link.
   *
   * WHY THIS IS SEPARATE FROM THE B2 TEST ABOVE, and finding the gap is the reason it exists. That
   * test calls `closure.request(...)` directly with capabilities it constructs itself, so it proves
   * the COORDINATOR forwards request-borne capabilities to the driver — and proves nothing about
   * whether anything in production ever puts them on a request. `SessionClosureRunState` is the only
   * production caller, and a version of it that passed `{root, runState}` and dropped the other three
   * would leave every assertion above green while production ran exactly the pre-B2 stub semantics.
   *
   * That is §6.9's standing check turned on this slice's own work: before recording that the assembly
   * is closed, ask what would have to be true for it to be falsifiable. The instrument is already in
   * this file — `heldDriver` captures the whole `DriverRun` — so the answer costs one call through
   * `integration.request` instead of `closure.request`.
   *
   * ASSERTED AS DEFINEDNESS, not by identity against the adapter services. §8.5 turns on ABSENT
   * versus PRESENT, which is exactly what a stub-supplied graph gets wrong, and the adapters are
   * resolved inside `run-state.ts`'s own `Effect.gen` where a test cannot hold the same references.
   */
  itComposed.instance(
    "SessionClosureRunState puts all four capabilities on the request it issues",
    () =>
      Effect.gen(function* () {
        held.queue = yield* Queue.unbounded<HeldRun>()

        const session = yield* Session.Service
        const integration = yield* SessionClosureRunState.Service
        const created = yield* session.create({ title: "closure-supplier-capabilities" })

        // The PRODUCTION entry point. `SessionClosureRunState.request` takes a root and nothing else,
        // so every capability the driver receives below was supplied by the production supplier.
        const pending = yield* integration.request(created.id).pipe(Effect.forkScoped)
        const run = yield* Queue.take(held.queue)

        // POSITIVE CONTROL. The run really is the one this request raised, so the assertions below
        // are about a driver invocation rather than about an empty object.
        expect(run.input.command.operation).toBeDefined()
        expect(run.input.control).toBeDefined()

        // `runState` predates B2 and is the control for the other three: it proves the forwarding
        // chain was already intact, so a missing capability below is B2's wiring and not the chain.
        expect(run.input.runState).toBeDefined()

        // THE LOAD-BEARING CLAIM. Gate 4 built these three and assembled them nowhere; §6.9 records
        // that the production layer returned "a no-op driver with no discovery, no lineage and no
        // ToolPart capability". This is the assertion that says otherwise, through the real graph.
        expect(run.input.discovery).toBeDefined()
        expect(run.input.lineage).toBeDefined()
        expect(run.input.toolPart).toBeDefined()

        // `validateSession` is deliberately ABSENT from `DriverRun` — it is coordinator authority,
        // not driver input, because a driver that could validate a session could widen its own
        // scope. It therefore cannot be asserted here, and the test below reaches it behaviourally
        // instead.
        expect("validateSession" in run.input).toBe(false)

        yield* Deferred.succeed(run.release, undefined)
        yield* Fiber.join(pending).pipe(Effect.exit)
      }),
    30000,
  )

  /**
   * THE LOCATION GATE, REACHED THROUGH THE PRODUCTION SUPPLIER — Gate 5 slice C.
   *
   * WHY THIS CANNOT BE THE TEST ABOVE. `validateSession` never reaches `DriverRun`, so no assertion
   * about what the driver received can prove it was supplied. The only way to observe it is to make
   * the coordinator USE it, which means driving a real claim through the real graph.
   *
   * WHAT MAKES IT REAL. The sessions are created through `Session.Service` in this Instance, so
   * `closure/location.ts` resolves genuine rows and compares their persisted `directory`/`workspaceID`
   * against the live `InstanceState` — the §5.1 comparison, against real data, not a fixture's
   * `() => true`. Every closure suite before this one answered the gate affirmatively by construction.
   *
   * THE NEGATIVE CONTROL IS THE POINT. A gate that answered `true` unconditionally would satisfy the
   * positive half exactly as well, and that is precisely the failure this slice exists to prevent —
   * §5.2's "no default/no-op admission capability may make a safety guard permissive". So the same
   * claim is repeated with one session swapped for an id that was never persisted, and it must be
   * refused with a `LocationError` naming that session.
   */
  itComposed.instance(
    "the supplied Location gate admits real in-Instance sessions and refuses one that was never persisted",
    () =>
      Effect.gen(function* () {
        held.queue = yield* Queue.unbounded<HeldRun>()

        const session = yield* Session.Service
        const integration = yield* SessionClosureRunState.Service
        const parent = yield* session.create({ title: "closure-location-parent" })
        const child = yield* session.create({ parentID: parent.id, title: "closure-location-child" })
        const parentNode = Model.id("session", parent.id)
        const childNode = Model.id("session", child.id)

        const pending = yield* integration.request(parent.id).pipe(Effect.forkScoped)
        const run = yield* Queue.take(held.queue)

        // POSITIVE. Both sessions are real and in this Instance, so the gate admits them and the
        // claim applies. Reaching `applied` at all means the request itself passed §5.1's
        // requested-root check too, since a refused root never raises a driver.
        const claimed = yield* run.input.control.claim({
          operation: run.input.command.operation,
          proofs: [{ value: "proven_connected", root: parentNode, active: childNode, path: [parentNode], edges: [] }],
          signals: [Effect.succeed("success" as const)],
        })
        expect(claimed.decision).toEqual({ type: "applied" })

        // NEGATIVE. Same shape, same operation, one session that was never persisted. The claim path
        // consults the gate for every session a proof names that holds no epoch yet, so this is
        // refused — and the error names the offending session, which is what distinguishes a real
        // Location refusal from an unrelated failure.
        const stranger = Model.id("session", "ses_location_never_persisted")
        const refused = yield* run.input.control
          .claim({
            operation: run.input.command.operation,
            proofs: [{ value: "proven_connected", root: parentNode, active: stranger, path: [parentNode], edges: [] }],
            signals: [Effect.succeed("success" as const)],
          })
          .pipe(Effect.flip)
        expect(refused._tag).toBe("SessionClosureLocationError")
        expect(refused.actual).toBe(`session:${stranger}`)

        yield* Deferred.succeed(run.release, undefined)
        yield* Fiber.join(pending).pipe(Effect.exit)
      }),
    30000,
  )
})

type TextPart = { readonly type: string; readonly text?: string }

const textOf = (messages: readonly { readonly parts: readonly TextPart[] }[]) =>
  messages.flatMap((message) => message.parts).map((part) => (part.type === "text" ? part.text : undefined))

// ---------------------------------------------------------------------------
// A substituted graph must not be served from a SHARED MemoMap.
//
// Gate 4 landed `createRoutes(corsOptions?, replacements?)`, so the hazard the block above carried
// forward is now live code rather than a note. The failure it invites is the dangerous kind: it is
// SILENT. `Layer` memoization is keyed on layer OBJECT IDENTITY, and `Session.layer` is a
// module-level constant, so once anything has built it through the process-wide map
// (`core/src/effect/memo-map.ts`, used by `webHandler` at server.ts:321) a later build carrying
// `replacements` gets the ALREADY-BUILT `Session` — the one holding the original coordinator. The
// substitute is still constructed, still costs the work, and is then thrown away with no error
// raised anywhere. A test written against it passes while asserting nothing.
//
// The two tests below are the reason `createRoutes` wraps its substituted branch in `Layer.fresh`.
// The first reproduces the hazard and the fix in one run, on a two-layer model with the same SHAPE
// as the real one — a module-level consumer constant capturing a dependency at build time. It is
// deliberately synthetic: the question is Effect's memoization semantics, not ours, and answering it
// without a database or fixture makes it fast and impossible to fail for unrelated reasons. The
// second binds that mechanism to the seam that depends on it.

class MemoInner extends Context.Service<MemoInner, { readonly tag: string }>()("test/MemoInner") {}
class MemoOuter extends Context.Service<MemoOuter, { readonly saw: string }>()("test/MemoOuter") {}

const memoBuilds: string[] = []

const memoInner = (tag: string) =>
  Layer.effect(
    MemoInner,
    Effect.sync(() => {
      memoBuilds.push(`inner:${tag}`)
      return MemoInner.of({ tag })
    }),
  )

// The module-level constant. This is `Session.layer`'s role: one object, reused by every
// composition, and therefore the thing the MemoMap keys on.
const memoOuter = Layer.effect(
  MemoOuter,
  Effect.gen(function* () {
    const dep = yield* MemoInner
    memoBuilds.push(`outer:${dep.tag}`)
    return MemoOuter.of({ saw: dep.tag })
  }),
)

const SERVER_SOURCE = new URL("../../src/server/routes/instance/httpapi/server.ts", import.meta.url)

describe("a substituted graph is memo-isolated", () => {
  it.live("Layer.fresh rebuilds the consumer, so substitution cannot be silently shadowed", () =>
    Effect.gen(function* () {
      memoBuilds.length = 0
      const memo = Layer.makeMemoMapUnsafe()
      const scope = yield* Effect.scope
      const build = (layer: Layer.Layer<any, any, any>) => Layer.buildWithMemoMap(layer, memo, scope)

      // POSITIVE CONTROL. The graph resolves at all, and the consumer really does capture its
      // dependency at build time — without this the two comparisons below would be vacuous.
      const plain = yield* build(memoOuter.pipe(Layer.provide(memoInner("real"))))
      expect(Context.get(plain, MemoOuter).saw).toBe("real")

      // THE HAZARD, demonstrated rather than asserted from documentation. Same `memoOuter` object,
      // a different dependency underneath it, built through the SAME map: the consumer is served
      // from the memo and still holds `real`. If Effect ever stops doing this the hardening below
      // has become unnecessary, and this line is what will say so.
      const shadowed = yield* build(memoOuter.pipe(Layer.provide(memoInner("stub"))))
      expect(Context.get(shadowed, MemoOuter).saw).toBe("real")

      // THE LOAD-BEARING CLAIM. `Layer.fresh` is transitive: it rebuilds the consumer too, so the
      // substitution actually reaches it.
      const fresh = yield* build(Layer.fresh(memoOuter.pipe(Layer.provide(memoInner("fresh")))))
      expect(Context.get(fresh, MemoOuter).saw).toBe("fresh")

      // …and this is why the failure is silent. The shadowed build DID construct its substitute —
      // `inner:stub` is present — and then discarded it without rebuilding the consumer and without
      // raising anything. Nothing but the captured value distinguishes it from a working one.
      expect(memoBuilds).toEqual(["inner:real", "outer:real", "inner:stub", "inner:fresh", "outer:fresh"])
    }),
  )

  it.live("createRoutes builds its substituted branch fresh, and leaves the production path shared", () =>
    Effect.promise(() => Bun.file(SERVER_SOURCE).text()).pipe(
      Effect.tap((source) =>
        Effect.sync(() => {
          // POSITIVE CONTROLS. The seam still exists in the shape this guard is written against, so
          // a rename or signature change fails here rather than passing against absent text.
          expect(source).toContain("export function createRoutes(")
          expect(source).toContain("replacements?: LayerNode.Replacements")

          // The substituted branch is fresh; the unsubstituted one deliberately is NOT, because the
          // production graph SHOULD share through the process-wide map.
          expect(source).toContain("Layer.fresh(AppNodeBuilderV1.build(app, replacements))")
          expect(source).not.toContain("Layer.provide(AppNodeBuilderV1.build(app, replacements)),")
        }),
      ),
      Effect.asVoid,
    ),
  )
})
