import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { Clock, Deferred, Effect, Exit, Fiber, Layer, Ref } from "effect"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureDriver } from "@/session/closure/driver"
import { ASYNC_TASK_PROTOCOL } from "@/tool/task-protocol"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it } from "../lib/effect"

const ATTACHMENT_PROTOCOL_TOKEN = "attached async tasks"
const ATTACHMENT_PROTOCOL_MARKER = ASYNC_TASK_PROTOCOL.split("\n")[0]

// The fence-and-quiesce loop: discover, claim, fence, signal, and rescan to a fixed point.
//
// These run the REAL driver through the REAL coordinator. Everything that varies is evidence:
// `Ports.makeLayer` supplies a scripted `discovery`, and the driver, control surface, model, claim
// path, effect dispatch and quiescence proof are all production code. That matters because the
// properties under test are ORDERING and CONVERGENCE properties, and a fixture standing in for the
// coordinator would be asserting its own behaviour.
//
// WHY EVERY TEST FORKS THE REQUEST AND ASSERTS ON STATE. The driver ends at a proved quiescence and
// the record-and-close step belongs to a later stage, so the worker exits without completing the
// operation and the waiter is failed. The outcome of `request` is therefore not the observable;
// what the driver DID is.

const runState: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

type RunnerSpec = {
  readonly session: string
  readonly running?: boolean
  readonly shell?: boolean
  /** What this exact physical signal established. Defaults to the ordinary interrupted case. */
  readonly outcome?: Ports.SignalOutcome
}
type JobSpec = {
  readonly job: string
  readonly state?: "registered_unarmed" | "binding" | "armed" | "terminal"
  readonly target?: string
  readonly owner?: string
  /**
   * Task coordinates, written to job metadata by `task.ts` and surfaced by `discovery.ts`.
   *
   * Supplied directly onto the discovery item here, so these tests exercise what the driver DOES
   * with a coordinate, not the metadata read that produces one. Coverage of that producer/consumer
   * seam lives with the Task tool's own suite.
   */
  readonly taskMessage?: string
  readonly taskCall?: string
  /** What this exact physical signal established. Defaults to the ordinary interrupted case. */
  readonly outcome?: Ports.SignalOutcome
}
/** One sweep's worth of world. The driver re-reads evidence every pass, so a list of these is time. */
type Frame = { readonly runners?: readonly RunnerSpec[]; readonly jobs?: readonly JobSpec[] }

type Probe = {
  /** Captured after the real driver returns. */
  readonly view: Model.View
  /**
   * Whether a fresh stable proof held, observed through the model's own gate rather than a private
   * field.
   *
   * `planning.begin` is accepted only when a quiescence proof exists AND its revision still equals
   * the operation's, so an operation in `planning` — or the later `recording` phase after a
   * successful freeze — is exactly "a fresh stable proof held, and the driver consumed it".
   *
   * The driver reaches `planning` on its own, so this is an observation of the production path
   * rather than a substitute for it: a probe that issued `planning.begin` itself would exercise the
   * property only on a path production never takes. It also discriminates — a driver that returns
   * without proving leaves the operation in `quiescing`, and `phaseOf` reports that verbatim.
   */
  readonly proved: boolean
  /** The exact phase the operation was left in, so a non-`planning` outcome is legible. */
  readonly phase: Model.Phase["type"] | undefined
  /**
   * The failure kind as the REQUESTER received it, rather than as the view records it.
   *
   * Observed in the test fiber from the request's own exit, so unlike `phase` it cannot race a
   * driver that settles the request from inside its own body. See the note at its assignment.
   */
  readonly failureKind: string | undefined
  /** Caller-visible outcome for each sequential request when a row exercises retained repair. */
  readonly failureKinds: readonly (string | undefined)[]
  /** Model snapshots at each waiter-delivery boundary, before a following retained repair begins. */
  readonly settledViews: readonly Model.View[]
  /** How many times the identity capability was consulted. See its construction in `drive`. */
  readonly planIdentityCalls: number
  /** The exact target list passed to each high-water read. */
  readonly highWaterCalls: readonly (readonly string[])[]
  /** Every access to the injected Effect Clock, including unsafe/nanosecond accessors. */
  readonly clockReads: number
  /** The generation frozen before the worker's expected continuation gap makes it exit. */
  readonly generation: Model.GenerationView | undefined
  /** Every PairPermit-bearing write command that reached the driver, in dispatch order. */
  readonly pairWrites: readonly Extract<Model.Command, { readonly type: "pair.write" }>[]
  /** Every pair result the driver returned through its real control seam. */
  readonly pairReturns: readonly Extract<Ports.DriverEvent, { readonly type: "pair.return" }>[]
  /**
   * The constructed facts, as the operation holds them.
   *
   * WITHOUT THIS THE WHOLE SUITE IS VACUOUS ABOUT FACT CONSTRUCTION, and that is not hypothetical
   * reasoning — it is a shape an audit caught twice. `proved` is satisfied by
   * the operation reaching `planning`, and a `describe` that returned nothing at all would reach
   * `planning` just as directly (no `view.require` applies, so the loop falls straight through).
   * Every other assertion in this file would still pass. The fact set is the only observable that
   * can tell a driver which built facts from one which built none.
   */
  readonly facts: readonly Model.FactView[]
  /** Every physical target actually interrupted, in dispatch order. */
  readonly signals: readonly string[]
  /** How many fresh evidence snapshots the driver took. */
  readonly sweeps: number
  /** The view as it stood when the FIRST signal was dispatched, or undefined if none was. */
  readonly atFirstSignal: Model.View | undefined
  /**
   * Every `ToolPartCapability` call the driver made, in order, with the exact coordinate it passed.
   *
   * Recording the COORDINATE rather than a count is what makes the end-to-end path assertable: these
   * values originate in `task.ts`'s job metadata and reach here only by surviving `discovery.ts`'s
   * shape check, `driver.ts::observe`, the per-sweep coordinate retention, and `capture`. A count
   * would pass even if the driver invented them.
   */
  readonly toolPartCalls: readonly ToolPartCall[]
}

/** One `ToolPartCapability.terminalize` invocation, flattened to plain strings for comparison. */
type ToolPartCall = { readonly session: string; readonly message: string; readonly call: string }

/**
 * A scripted world.
 *
 * `runners` advances the frame and `jobs` re-reads the frame it advanced to, which pins one frame
 * per sweep. That does couple the fixture to the driver reading runners before jobs in a pass — the
 * alternative, advancing on both, would silently consume two frames per sweep and make every
 * multi-frame test mean something other than it says.
 *
 * The last frame repeats forever, so a test scripts only the changes it cares about and the world
 * then holds still. A world that kept changing would make convergence impossible to distinguish
 * from a driver that never converges.
 */
const world = (
  frames: readonly Frame[],
  record: (target: string) => Effect.Effect<void>,
  beforeSweep: (index: number) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const taken = yield* Ref.make(0)
    const frame = yield* Ref.make(frames[0] ?? {})
    const at = (index: number) => frames[Math.min(index, frames.length - 1)] ?? {}
    return {
      sweeps: taken,
      capability: {
        runners: Ref.getAndUpdate(taken, (count) => count + 1).pipe(
          Effect.tap(beforeSweep),
          Effect.tap((count) => Ref.set(frame, at(count))),
          Effect.map((count) =>
            (at(count).runners ?? []).map((spec) => ({
              session: SessionID.make(spec.session),
              running: spec.running ?? true,
              shell: spec.shell ?? false,
              interrupt: record(`runner:${spec.session}`).pipe(Effect.as(spec.outcome ?? ("interrupted" as const))),
            })),
          ),
        ),
        jobs: Ref.get(frame).pipe(
          Effect.map((current) =>
            (current.jobs ?? []).map((spec) => ({
              job: spec.job,
              state: spec.state ?? ("armed" as const),
              // Deliberately ALWAYS idle. Status is a diagnostic, not active-leaf authority, and
              // this is the case where the two disagree — a fixture whose status agreed with the
              // lifetime state could not tell an authority-respecting driver from a status proxy.
              status: "completed" as const,
              target: spec.target ? SessionID.make(spec.target) : undefined,
              owner: spec.owner ? SessionID.make(spec.owner) : undefined,
              taskMessage: spec.taskMessage,
              taskCall: spec.taskCall,
              interrupt: record(`job:${spec.job}`).pipe(Effect.as(spec.outcome ?? ("interrupted" as const))),
            })),
          ),
        ),
      } satisfies Ports.DiscoveryCapability,
    }
  })

/**
 * Runs one closure request against the real coordinator with the real driver, and reports what the
 * driver did.
 *
 * `discovery: false` omits the capability entirely rather than supplying an empty one — ABSENT,
 * which must stay distinguishable from ENUMERATED-AND-EMPTY.
 */
const drive = (input: {
  readonly root: string
  readonly frames: readonly Frame[]
  readonly discovery?: false
  readonly lineage?: readonly { readonly session: string; readonly parent: string }[]
  /**
   * Scripted ToolPart outcomes, keyed by tool call id. Omit entirely to run with NO capability,
   * which is the absent-capability reading rather than an empty one — the two are different facts.
   */
  readonly toolPart?: Record<string, Ports.ToolPartOutcome>
  /** Optional generic participants, snapshotted by the real coordinator before the driver runs. */
  readonly participants?: readonly Ports.Participant[]
  /**
   * The identity capability, with THREE distinguishable states rather than two.
   *
   * Omitted entirely means the capability is ABSENT — the driver cannot answer `planning.return` at
   * all. `"none"` means it is present and resolved NO identity, which is the genuine
   * "no validated source exists" reading and fails planning as identity-missing. An `Identity` means
   * it resolved one. Absent and resolved-empty must not collapse: the first is a missing wire, the
   * second is a fact about the transcript, and only the second may fail the operation.
   */
  readonly planIdentity?: "none" | Model.Identity | (() => Model.Identity)
  /** A custom capability takes precedence, while `drive` still counts every invocation. */
  readonly planIdentityCapability?: Ports.PlanIdentityCapability
  /** Undefined is ABSENT; an empty array is a present scripted capability that resolved no rows. */
  readonly highWater?: readonly { readonly session: string; readonly millis: number }[]
  /** A real/custom capability takes precedence over the scripted row adapter when supplied. */
  readonly highWaterCapability?: Ports.HighWaterCapability
  /** The injectable freeze clock. Only a successfully seeded plan should read it. */
  readonly clockMillis?: number
  /** Test-only stand-in: return both halves verified instead of exercising the missing wire. */
  readonly record?: "verified"
  /** Real/custom F1 writer. Unlike `record`, this travels the production request and driver path. */
  readonly recordCapability?: Ports.RecordCapability
  /** Sequential requests in the same Instance; two drives the retained repair rather than a fresh operation. */
  readonly attempts?: number
  /** Test-only lifecycle hooks around the production request and each fresh evidence sweep. */
  readonly beforeRequest?: (closure: SessionClosure.Interface) => Effect.Effect<void>
  readonly beforeSweep?: (index: number, closure: SessionClosure.Interface) => Effect.Effect<void>
  /** Runs inside the scripted physical signal after its target is journalled. */
  readonly onSignal?: (target: string) => Effect.Effect<void>
  /** Runs after a production command returns, while its worker authority is still current. */
  readonly afterCommand?: (input: Ports.DriverCommand) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const signals = yield* Ref.make<readonly string[]>([])
    const captured = yield* Ref.make<Model.View | undefined>(undefined)
    const settledViews = yield* Ref.make<readonly Model.View[]>([])
    const atFirstSignal = yield* Ref.make<Model.View | undefined>(undefined)
    const toolPartCalls = yield* Ref.make<readonly ToolPartCall[]>([])
    const pairWrites = yield* Ref.make<readonly Extract<Model.Command, { readonly type: "pair.write" }>[]>([])
    const pairReturns = yield* Ref.make<readonly Extract<Ports.DriverEvent, { readonly type: "pair.return" }>[]>([])
    // Counts CALLS, not results. A capability that was never consulted and one that resolved nothing
    // produce the same identities array, so only the count can tell "the wire is missing" from
    // "the capability found no source" — which is the whole distinction this turns on.
    const planIdentityCalls = yield* Ref.make(0)
    const highWaterCalls = yield* Ref.make<readonly (readonly string[])[]>([])
    const service = yield* Ref.make<SessionClosure.Interface | undefined>(undefined)
    let clockReads = 0
    const millis = input.clockMillis ?? 4_000
    const countingClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => {
        clockReads++
        return millis
      },
      currentTimeMillis: Effect.sync(() => {
        clockReads++
        return millis
      }),
      currentTimeNanosUnsafe: () => {
        clockReads++
        return BigInt(millis) * 1_000_000n
      },
      currentTimeNanos: Effect.sync(() => {
        clockReads++
        return BigInt(millis) * 1_000_000n
      }),
      sleep: () => Effect.void,
    }

    const scripted = yield* world(
      input.frames,
      (target) =>
        Ref.update(signals, (current) => [...current, target]).pipe(
          Effect.andThen(input.onSignal ? input.onSignal(target) : Effect.void),
        ),
      (index) =>
        input.beforeSweep
          ? Ref.get(service).pipe(
              Effect.flatMap((closure) => (closure ? input.beforeSweep!(index, closure) : Effect.void)),
            )
          : Effect.void,
    )

    const real = SessionClosureDriver.make()
    const driver: Ports.Driver = {
      // Scope the counting Clock to the freeze command itself. Providing it around the whole
      // coordinator measured 27 legitimate framework/runtime reads (ticketing, supervision and
      // test deadlines), which says nothing about the seed. This boundary is the exact closure path that
      // constructs and consumes the seed, and every later record/retry command re-enters the same
      // wrapper — so a future clock read in any of them remains observable without infrastructure
      // noise.
      command: (command) =>
        Effect.gen(function* () {
          const traced: Ports.DriverCommand = {
            ...command,
            control: {
              ...command.control,
              transition: (event) =>
                (event.type === "pair.return"
                  ? Ref.update(pairReturns, (current) => [...current, event])
                  : Effect.void
                ).pipe(Effect.andThen(command.control.transition(event))),
            },
          }
          const write = command.command.type === "pair.write" ? command.command : undefined
          const release = command.command.type === "release.verify" ? command.command : undefined
          if (write) yield* Ref.update(pairWrites, (current) => [...current, write])
          if (write && input.record === "verified") {
            yield* traced.control
              .transition({
                type: "pair.return",
                write,
                message: "verified",
                part: "verified",
              })
              .pipe(Effect.orDie)
          }
          // The stand-in intentionally ends before physical postflight, just as it ends before the
          // writer. Real RecordCapability fixtures take both commands through production; this
          // branch keeps freeze-only rows from pretending a database exists.
          if ((!write && !release) || input.record !== "verified") yield* real.command(traced)
          if (input.afterCommand) yield* input.afterCommand(traced)
        }).pipe(Effect.provideService(Clock.Clock, countingClock)),
      run: (run) =>
        real.run(run).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              // Read-only. The driver issues `planning.begin` itself, so probing here would only
              // re-attempt a transition production already made and report `rejected` for a driver
              // that had in fact proved.
              yield* Ref.set(captured, yield* run.control.view)
            }),
          ),
          Effect.catch(() => Effect.void),
          // UNINTERRUPTIBLE, because the driver can now settle the request from inside its own body.
          //
          // When the sweep bound is exhausted the driver declares `quiescence_failed` before it
          // returns. That failure delivers to the waiting request, so `closure.request` completes,
          // the `provideInstanceEffect` scope closes, and this worker fiber is interrupted — and it
          // was being interrupted BETWEEN `real.run` finishing and this probe running, leaving
          // `captured` undefined. The race is an artifact of probing from inside the driver; nothing
          // in production reads the view after `run`.
          //
          // Safe to mask here because everything inside is bounded: `real.run` terminates at
          // SWEEP_LIMIT at the latest, discovery is scripted and finite, and the probe is two
          // coordinator calls. Masking an unbounded body is what wedges a runner, and this is not
          // one.
          Effect.uninterruptible,
        ),
    }

    const ports: Ports.RuntimePorts = {
      driver,
      participants: input.participants ?? [],
      hooks: {
        // The real dispatch boundary, and it runs BEFORE the effect body and outside the coordinator
        // lock. Reading the view here is what makes the ordering — "claim/fence every newly
        // included Session BEFORE signalling effects" — observable.
        beforeEffectDispatch: () =>
          Effect.gen(function* () {
            if ((yield* Ref.get(atFirstSignal)) !== undefined) return
            const current = yield* Ref.get(service)
            if (current) yield* Ref.set(atFirstSignal, yield* current.view)
          }).pipe(Effect.catch(() => Effect.void)),
        // Terminal failures can settle the requester from inside the driver command, before the
        // post-run probe below is scheduled. Capture at the coordinator's delivery boundary too:
        // this hook runs before the waiter Deferred is completed, so teardown cannot win the race.
        beforeWaiterDelivery: () =>
          Ref.get(service).pipe(
            Effect.flatMap((closure) =>
              closure
                ? closure.view.pipe(
                    Effect.flatMap((view) =>
                      Ref.update(settledViews, (current) => [...current, view]).pipe(
                        Effect.andThen(Ref.update(captured, (current) => current ?? view)),
                      ),
                    ),
                  )
                : Effect.void,
            ),
            Effect.catch(() => Effect.void),
          ),
      },
    }

    /**
     * The Location gate, supplied on the request rather than on `RuntimePorts` — it sits with the
     * other capabilities there, for the same cycle reason.
     *
     * Every session in these fixtures is synthetic, so epoch-based recognition cannot apply and a
     * real Location lookup would refuse them all. Answering `true` here is what keeps these rows
     * about DRIVER behaviour; the gate's own behaviour is `closure-location.test.ts`, and its
     * production wiring is `closure-layer.test.ts`.
     */
    const validateSession = () => Effect.succeed(true)

    /**
     * ABSENT when unscripted, rather than present-and-resolving-nothing — the same absent-versus-empty
     * discipline `discovery` follows, and for a sharper reason here: a present capability that
     * resolves no identity FAILS the operation (`planning_failed_identity_missing`), so collapsing
     * the two would make every unscripted row fail planning instead of stopping at it.
     */
    const planIdentity: Ports.PlanIdentityCapability | undefined = input.planIdentityCapability
      ? {
          resolve: (targets) =>
            Ref.update(planIdentityCalls, (count) => count + 1).pipe(
              Effect.andThen(input.planIdentityCapability!.resolve(targets)),
            ),
        }
      : input.planIdentity === undefined
        ? undefined
        : {
            resolve: (targets) =>
              Ref.update(planIdentityCalls, (count) => count + 1).pipe(
                Effect.as(
                  targets.map((session) => ({
                    session,
                    identity:
                      input.planIdentity === "none"
                        ? undefined
                        : typeof input.planIdentity === "function"
                          ? input.planIdentity()
                          : input.planIdentity,
                  })),
                ),
              ),
          }

    /**
     * The three-state high-water seam. Undefined is a missing wire; `[]` is a real read proving
     * no persisted row for any target; populated rows are passed through with the driver's exact
     * Model.SessionID so the call log and result both preserve the requested coordinates.
     */
    const highWaterRows = input.highWater
    const highWater: Ports.HighWaterCapability | undefined = input.highWaterCapability
      ? {
          read: (targets) =>
            Ref.update(highWaterCalls, (current) => [...current, targets.map(String)]).pipe(
              Effect.andThen(input.highWaterCapability!.read(targets)),
            ),
        }
      : highWaterRows === undefined
        ? undefined
        : {
            read: (targets) =>
              Ref.update(highWaterCalls, (current) => [...current, targets.map(String)]).pipe(
                Effect.as(
                  highWaterRows.flatMap((row) => {
                    const target = targets.find((session) => String(session) === row.session)
                    return target ? [{ session: target, millis: row.millis }] : []
                  }),
                ),
              ),
          }

    /**
     * THE THREE EVIDENCE CAPABILITIES RIDE THE REQUEST, not `RuntimePorts`.
     *
     * Supplying them here as per-Instance ports would make every row in this file exercise a shape
     * the production graph does not have — a stub with no discovery, no lineage and no toolPart at
     * all. The request is the only seam that carries them precisely so this fixture and
     * `closure/run-state.ts` supply capabilities the SAME way. A test path and a production path
     * that differ is a productive defect source.
     */

    /**
     * ABSENT when unscripted, rather than present-and-empty. The two are
     * different facts: an absent capability means no outcome was ever read, which is `unknown`;
     * a present one that finds nothing means the coordinate named no ToolPart, which is ALSO
     * `unknown` but by a different route. Only a fixture that can be genuinely absent can tell a
     * driver that skips the call from one that makes it and learns nothing.
     */
    const toolPart: Ports.ToolPartCapability | undefined =
      input.toolPart === undefined
        ? undefined
        : {
            terminalize: (call) =>
              Ref.update(toolPartCalls, (current) => [
                ...current,
                { session: String(call.session), message: String(call.message), call: call.call },
              ]).pipe(Effect.as(input.toolPart?.[call.call] ?? { outcome: "unknown" as const })),
          }

    const discovery = input.discovery === false ? undefined : scripted.capability

    const lineage: Ports.LineageCapability | undefined = input.lineage
      ? {
          parents: (sessions) =>
            Effect.succeed(
              (input.lineage ?? [])
                .filter((row) => sessions.includes(row.session))
                .map((row) => ({ session: SessionID.make(row.session), parent: SessionID.make(row.parent) })),
            ),
        }
      : undefined

    const directory = yield* tmpdirScoped()
    const layer = SessionClosure.layer.pipe(
      Layer.provide(SessionToolPartPermit.layer),
      Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
    )
    /**
     * The CALLER-VISIBLE failure, which is what the failure kinds exist to communicate.
     *
     * Carried alongside the view rather than instead of it, because the two answer different
     * questions: the view says what the driver left behind, and this says what the requester was
     * told. For failure-KIND rows the second is the right observable, and it is also the only
     * race-free one — see the note below.
     *
     * Reduced to a plain value here rather than inspected as a `Cause`: the typed error channel is
     * all these rows need, and `Effect.catch` is the narrowest way to reach it.
     */
    const failed = yield* Effect.gen(function* () {
      const closure = yield* SessionClosure.Service
      yield* Ref.set(service, closure)
      if (input.beforeRequest) yield* input.beforeRequest(closure)
      const request = {
        root: SessionID.make(input.root),
        runState,
        discovery,
        lineage,
        toolPart,
        validateSession,
        planIdentity,
        highWater,
        record: input.recordCapability,
      }
      // Each request settles before the next begins. The second therefore joins retained state and
      // can only become the retained repair attempt; it cannot race the original waiter or twin it.
      return yield* Effect.forEach(Array.from({ length: input.attempts ?? 1 }), () =>
        closure.request(request).pipe(
          Effect.as(undefined),
          Effect.catch((error) => Effect.succeed(error)),
        ),
      )
    }).pipe(Effect.provide(layer), provideInstanceEffect(directory))

    const failureKinds = failed.map((error) => (error && "kind" in error ? String(error.kind) : undefined))
    const failureKind = failureKinds[0]

    const settled = yield* Ref.get(settledViews)
    // A successful release settles from inside the driver and is therefore newer than the post-run
    // probe; select that exact boundary. Failure-only rows retain the post-run observation that says
    // what the driver established before worker-exit translated its eventual return.
    const released = settled.findLast((view) =>
      view.operations.some((operation) => operation.phase.type === "released_pending_delivery"),
    )
    const view = released ?? (yield* Ref.get(captured))
    // Nonterminal rows are captured after `run`; terminal rows are captured by
    // `beforeWaiterDelivery`, before the requester can close the Instance scope. Together those are
    // exhaustive for this bounded fixture, so an absent view is now a harness defect, not a tolerated
    // teardown race.
    expect(view).toBeDefined()
    const phase = view?.operations[0]?.phase.type
    const generation = view?.operations[0]?.generations.at(-1)
    return {
      view: view!,
      phase,
      failureKind,
      failureKinds,
      settledViews: settled,
      proved: phase === "planning" || generation !== undefined,
      facts: view?.operations[0]?.facts ?? [],
      signals: yield* Ref.get(signals),
      sweeps: yield* Ref.get(scripted.sweeps),
      atFirstSignal: yield* Ref.get(atFirstSignal),
      toolPartCalls: yield* Ref.get(toolPartCalls),
      planIdentityCalls: yield* Ref.get(planIdentityCalls),
      highWaterCalls: yield* Ref.get(highWaterCalls),
      clockReads,
      generation,
      pairWrites: yield* Ref.get(pairWrites),
      pairReturns: yield* Ref.get(pairReturns),
    } satisfies Probe
  }).pipe(Effect.provide(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)))

const operation = (probe: Probe) => probe.view.operations[0]

/**
 * The same brand boundary the driver crosses, crossed back for assertions.
 *
 * The model speaks `Model.ID<"session">` and these fixtures speak plain ids. Comparing as strings
 * keeps each expectation readable as the claim it is — "these sessions, and no others" — rather than
 * requiring every literal in the file to be constructed through a brand it is not asserting about.
 */
const names = (values: readonly Model.SessionID[]) => values.map((item) => String(item)).toSorted()
const claims = (probe: Probe) => names(operation(probe)?.claims ?? [])
const fenced = (probe: Probe) => names(probe.view.fences.map((item) => item.session))

/**
 * One fact flattened to a comparable tuple, carrying every axis the record holds.
 *
 * SORTED, DELIBERATELY. `OperationView.facts` is the merged SET (`model.ts::mergefacts`); the
 * descendant-first postorder is applied later, by `sortfacts` at freeze time. Asserting an order
 * here would assert `mergefacts`' insertion order, which is not a contract — and would silently
 * pass for a driver that emitted the right facts in the wrong order, or fail for one that emitted
 * them in a different but equally valid order. The order assertion belongs to the freeze slice,
 * against the frozen generation, which is where the ordering authority actually runs.
 */
const shapes = (probe: Probe) =>
  probe.facts
    .map((item) =>
      item.type === "self"
        ? `self ${item.subject} outcome=${item.outcome} yielded=${item.yielded}`
        : item.type === "edge"
          ? `edge ${item.owner}->${item.child} subject=${item.subject} outcome=${item.outcome} yielded=${item.yielded} part=${item.taskPart ?? "-"}`
          : `root ${item.root} direct=${item.direct === undefined ? "-" : item.direct.outcome}`,
    )
    .toSorted()

const ROOT = "ses_driver_root"
const CHILD = "ses_driver_child"
const GRANDCHILD = "ses_driver_grandchild"
const STRANGER = "ses_driver_stranger"

describe("closure.driver fence and quiesce", () => {
  it.live("an enumerated-and-empty world is a no-work success — proved, with nothing claimed", () =>
    Effect.gen(function* () {
      const probe = yield* drive({ root: ROOT, frames: [{}] })
      // The positive precondition: the driver really did look. Without this, a driver that returned
      // immediately would satisfy every assertion below.
      expect(probe.sweeps).toBeGreaterThan(0)
      expect(probe.proved).toBe(true)
      expect(claims(probe)).toEqual([])
      expect(fenced(probe)).toEqual([])
      expect(probe.signals).toEqual([])
    }),
  )

  /**
   * The identity capability, and the plan read that consumes it.
   *
   * `beginPlanning` emits `plan.read` as a COMMAND, so a `driver.command` that answered
   * `() => Effect.void` would emit the read into a no-op and planning could never be answered. These
   * rows prove the command is handled, and that the identity-absent outcome is terminal in its own
   * right rather than a stub: `planningReturn` fails to `planning_failed_identity_missing` BEFORE it
   * looks at the seed.
   *
   * THE WORLD HAS TO PROVE AN EDGE. An enumerated-and-empty world constructs no facts at all, so
   * `plantargets` would be empty, `facts.map(identityFor)` would be empty, and the
   * identity gate would be structurally unreachable — the run would fall straight through to the
   * seed check and report `unverified`. A row asserting identity behaviour over an empty world would
   * therefore pass for a driver that never resolved an identity at all.
   */
  const IDENTITY: Model.Identity = {
    source: "session_identity",
    agent: "closure-agent",
    model: { providerID: "anthropic", modelID: "opus", variant: { present: false } },
  }
  const IDENTITY_WORLD: readonly Frame[] = [{ jobs: [{ job: "job_identity", owner: ROOT, target: CHILD }] }, {}]

  it.live("an ABSENT discovery capability cannot prove quiescence, where an empty one can", () =>
    Effect.gen(function* () {
      const blind = yield* drive({ root: ROOT, frames: [{}], discovery: false })
      expect(blind.proved).toBe(false)
      expect(blind.sweeps).toBe(0)

      // AND THE FAILURE IS THE RIGHT ONE, which is a separate claim from its being a failure. A bare
      // return would end the fiber, fire `workerExited`, and record `closure_unavailable` — the
      // "current worker defects" kind. That is correct for a defect and a lie about this: nothing
      // defected. A ticket was issued and a worker opened; the driver then declined to guess at
      // quiescence it had no evidence for, which is the "stable scan cannot be proved" kind. The
      // same misattribution reaches the exhausted sweep bound by a different trigger.
      //
      // The two kinds send a reader to different places — supervisor and queue, versus what kept
      // reappearing in the active set — so asserting only "it failed" lets the wrong one through,
      // which is exactly what happened for four gates. The worker-defect control that keeps
      // `closure_unavailable` reachable lives in `closure-layer.test.ts`, because producing a real
      // defecting worker needs a substituted driver rather than a scripted world.
      //
      // Asserted from the REQUEST's exit rather than the captured view, and not by preference: this
      // return declares and then returns immediately, so the request settles and the Instance scope
      // closes before the in-driver probe's continuation is ever scheduled. `failureKind` is read in
      // the test fiber and cannot race. See the note in `drive`.
      expect(blind.failureKind).toBe("quiescence_failed")

      // The control that makes it a statement about ABSENCE rather than about emptiness: the same
      // fixture, the same empty world, differing only in whether the capability exists at all.
      const seeing = yield* drive({ root: ROOT, frames: [{}] })
      expect(seeing.proved).toBe(true)
    }),
  )

  it.live("a no-work root constructs no facts at all — not even its own root fact", () =>
    Effect.gen(function* () {
      const probe = yield* drive({ root: ROOT, frames: [{}] })
      // The positive precondition, again: the driver looked, and proved. Without it a driver that
      // returned immediately would satisfy the emptiness below for the wrong reason.
      expect(probe.sweeps).toBeGreaterThan(0)
      expect(probe.proved).toBe(true)
      /**
       * The no-work idle case writes nothing: no operation, no generation, no records. The rule that
       * there is "one selected-root record for each requested-root view", taken alone, would emit a
       * root fact here — a record asserting that a branch
       * closed when no branch was ever found. The no-work sentence governs, and this is the row
       * that holds it.
       *
       * It also pins the convergence property: an empty description makes `requireView` answer
       * `noop: "duplicate"` rather than bump the revision, so the no-work path reaches `planning`
       * without the extra re-prove sweep a fact emission costs.
       */
      expect(shapes(probe)).toEqual([])
    }),
  )

  it.live("the fence is installed before the signal is dispatched, not after", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: [{ runners: [{ session: CHILD }], jobs: [{ job: "job_child", owner: ROOT, target: CHILD }] }, {}],
      })
      expect(probe.signals.length).toBeGreaterThan(0)
      expect(probe.atFirstSignal).toBeDefined()
      // At the moment the first physical interrupt was dispatched, the claim had already installed
      // the fence. A driver that signalled first and claimed afterwards would show an empty set.
      expect(names((probe.atFirstSignal?.fences ?? []).map((item) => item.session))).toEqual([CHILD, ROOT].toSorted())
    }),
  )

  it.live("an unrelated branch in the same Instance is never claimed, fenced, or signalled", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: [
          {
            runners: [{ session: CHILD }, { session: STRANGER }],
            jobs: [
              { job: "job_child", owner: ROOT, target: CHILD },
              // Active, and owned by nothing this root can reach.
              { job: "job_stranger", owner: "ses_driver_other_root", target: STRANGER },
            ],
          },
          {
            runners: [{ session: STRANGER }],
            jobs: [{ job: "job_stranger", owner: "ses_driver_other_root", target: STRANGER }],
          },
        ],
      })
      // Positive control first: the in-scope branch really was closed, so the absences below are
      // about scope rather than about a driver that did nothing.
      expect(claims(probe)).toEqual([CHILD, ROOT].toSorted())
      expect(probe.signals).toContain("runner:" + CHILD)
      // Unanchored and unknown — no authority, no failure, no contamination.
      expect(claims(probe)).not.toContain(STRANGER)
      expect(fenced(probe)).not.toContain(STRANGER)
      expect(probe.signals.some((target) => target.includes(STRANGER))).toBe(false)
      // The unrelated branch stays active throughout and does NOT prevent this root proving.
      expect(probe.proved).toBe(true)
      expect(operation(probe)?.views[0]?.result).not.toBe("failure")
    }),
  )

  it.live("with no new work the final scan is stable and the proof holds", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: [{ runners: [{ session: CHILD }], jobs: [{ job: "job_child", owner: ROOT, target: CHILD }] }, {}],
      })
      expect(probe.proved).toBe(true)
      expect(claims(probe)).toEqual([CHILD, ROOT].toSorted())
      // Exactly one claim happened: the driver stopped signalling once nothing was newly active,
      // which is what lets the scan pair agree. A driver that re-claimed each sweep would bump the
      // revision every pass and could never prove.
      expect(probe.signals).toEqual(["runner:" + CHILD, "job:job_child"])
      // THE POSITIVE CONTROL for the `quiescence_failed` assertion in the never-quiescent row below,
      // and a guard in its own right. `exhausted` may fire ONLY on fall-through from the sweep loop;
      // a converging run must never declare a quiescence failure. If the declaration were moved
      // inside the loop, or the `applied` early return were dropped, this run would fail while that
      // row stayed green — so without this assertion that defect has no witness.
      expect(operation(probe).phase).not.toEqual({ type: "quiescence_failed" })
      expect(operation(probe).failure).toBeUndefined()
    }),
  )

  it.live("work that appears AFTER the first sweep is widened in, signalled, and closed", () =>
    Effect.gen(function* () {
      // Sweep 1 sees only the child. The grandchild's job appears in sweep 2 — the adversary — and
      // must still be discovered, claimed, signalled and converged on.
      //
      // THIS IS THE CARRIED OBLIGATION. Sync-Task teardown does not transitively cancel grandchild
      // jobs — that narrowing is deliberate — and the fixed-point rescan is where the work it
      // stopped doing is picked up. A driver that scanned once would leave `job_late` running.
      const probe = yield* drive({
        root: ROOT,
        frames: [
          { runners: [{ session: CHILD }], jobs: [{ job: "job_child", owner: ROOT, target: CHILD }] },
          { jobs: [{ job: "job_late", owner: CHILD, target: GRANDCHILD }] },
          { jobs: [] },
        ],
      })
      expect(probe.proved).toBe(true)
      expect(probe.sweeps).toBeGreaterThanOrEqual(3)
      expect(claims(probe)).toEqual([CHILD, GRANDCHILD, ROOT].toSorted())
      expect(probe.signals).toContain("job:job_late")
      // Order is the assertion, not decoration: the late work was signalled AFTER the first round,
      // which is what makes this a rescan result rather than a single wide scan.
      expect(probe.signals.indexOf("job:job_late")).toBeGreaterThan(probe.signals.indexOf("runner:" + CHILD))
    }),
  )

  it.live("a claimed Session that never stops running is never proved quiescent", () =>
    Effect.gen(function* () {
      // The last frame repeats forever, so the claimed child's Runner never goes away. The model's
      // own accounting is perfectly stable throughout — the claim set stops moving after the first
      // sweep, no lease or effect is outstanding, and any two scans agree — so a driver that proved
      // on the model's evidence alone would report success here.
      //
      // The direction matters as much as the outcome: the sweep bound ENDS the attempt but never
      // certifies it. Exhausting it leaves the operation without a proof, which is a retained
      // failure, not a timeout converted into success.
      const probe = yield* drive({
        root: ROOT,
        frames: [{ runners: [{ session: CHILD }], jobs: [{ job: "job_child", owner: ROOT, target: CHILD }] }],
      })
      expect(probe.proved).toBe(false)
      // The positive control: it really did claim and signal the branch, so the absent proof is
      // about unfinished work rather than about a driver that never engaged.
      expect(claims(probe)).toEqual([CHILD, ROOT].toSorted())
      expect(probe.signals).toContain("runner:" + CHILD)
      // And it signalled exactly once, rather than re-signalling on every one of its many sweeps.
      expect(probe.signals.filter((target) => target === "runner:" + CHILD)).toHaveLength(1)
      expect(probe.sweeps).toBeGreaterThan(3)

      // AND THE FAILURE IS THE RIGHT ONE, which is a separate claim from its being a failure.
      //
      // Left alone, the driver returns, the fiber ends, `workerExited` fires and the model records
      // `closure_unavailable` — the "current worker defects" kind, and an unexpected worker exit.
      // Correct for a defect, and a lie about this: nothing defected here. The machinery issued a
      // ticket, opened a worker, ran the bound to its end and signalled, and what
      // failed is the quiescence — the "stable scan cannot be proved" kind. The two kinds send a
      // reader to different places, so asserting only "it failed" would let the wrong one through.
      //
      // Observed from the captured view, which is taken after `run` returns and therefore after the
      // driver has declared. That the exit path does NOT then overwrite it is the ordering property
      // `unproved` depends on: `fail` leaves the driver `failed`, and `workerExited` no-ops stale.
      expect(operation(probe).phase).toEqual({ type: "quiescence_failed" })
      expect(operation(probe).failure?.kind).toBe("quiescence_failed")
    }),
  )

})
