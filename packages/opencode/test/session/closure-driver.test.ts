import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { CLOSURE_RECORD_METADATA_KEY, isCompleteClosurePair } from "@opencode-ai/core/session/closure-record"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { asc, eq, inArray } from "drizzle-orm"
import { Clock, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureDriver } from "@/session/closure/driver"
import { SessionClosureHighWater } from "@/session/closure/high-water"
import { ASYNC_TASK_PROTOCOL, ASYNC_TASK_STATUS } from "@/tool/task-protocol"
import { AttachmentContract } from "@/session/attachment/contract"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { AttachmentParticipant } from "@/session/attachment/participant"
import { inertCoordinator } from "../lib/attachment"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionClosureRecord } from "@/session/closure/record"
import { SessionAdmission } from "@/session/closure/admission"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it, pollWithTimeout } from "../lib/effect"

const ATTACHMENT_PROTOCOL_TOKEN = "attached async tasks"
const ATTACHMENT_PROTOCOL_MARKER = ASYNC_TASK_PROTOCOL.split("\n")[0]

// CP-023 Gate 4 step 3d — §8.4 steps 7-10 and §8.6's `FENCE_AND_QUIESCE`.
//
// This is the first suite to run the REAL driver through the REAL coordinator. Everything that
// varies is evidence: `Ports.makeLayer` supplies a scripted `discovery`, and the driver, control
// surface, model, claim path, effect dispatch and quiescence proof are all production code. That
// matters because the properties under test are ORDERING and CONVERGENCE properties, and a fixture
// that stood in for the coordinator would be asserting its own behaviour.
//
// WHY EVERY TEST FORKS THE REQUEST AND ASSERTS ON STATE. `requestClosure` cannot succeed at Gate 4:
// the driver ends at a proved quiescence and `RECORD_AND_CLOSE` (§8.9) is Gate 5's, so the worker
// exits without completing the operation and the waiter is failed. The outcome of `request` is
// therefore not the observable; what the driver DID is.

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
  /** §8.3's Task coordinates, written to job metadata by `task.ts` and surfaced by `discovery.ts`. */
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
   * §8.7 clause 11, observed through the model's own gate rather than a private field.
   *
   * `planning.begin` is accepted only when a quiescence proof exists AND its revision still equals
   * the operation's (`model.ts::beginPlanning`), so an operation in `planning` — or the later
   * `recording` phase after a successful freeze — is exactly "a fresh stable proof held, and the
   * driver consumed it".
   *
   * GATE 5 RE-HOMED THIS, and the reason is worth keeping. Through Gate 4 this was measured by the
   * TEST issuing `planning.begin` itself, because production never did — which meant the property
   * was only ever exercised on a path production did not take. Gate 5's driver reaches `planning`
   * on its own, so the probe is now an observation of the production path rather than a substitute
   * for it. It also still discriminates: a driver that returns without proving leaves the operation
   * in `quiescing`, and `phaseOf` reports that verbatim.
   */
  readonly proved: boolean
  /** The exact phase the operation was left in, so a non-`planning` outcome is legible. */
  readonly phase: Model.Phase["type"] | undefined
  /**
   * §12.2's failure kind as the REQUESTER received it, rather than as the view records it.
   *
   * Observed in the test fiber from the request's own exit, so unlike `phase` it cannot race a
   * driver that settles the request from inside its own body. See the note at its assignment.
   */
  readonly failureKind: string | undefined
  /** Caller-visible outcome for each sequential request when a row exercises retained repair. */
  readonly failureKinds: readonly (string | undefined)[]
  /** Model snapshots at each waiter-delivery boundary, before a following retained repair begins. */
  readonly settledViews: readonly Model.View[]
  /** How many times §10.3's identity capability was consulted. See its construction in `drive`. */
  readonly planIdentityCalls: number
  /** The exact target list passed to each §10.8 high-water read. */
  readonly highWaterCalls: readonly (readonly string[])[]
  /** Every access to the injected Effect Clock, including unsafe/nanosecond accessors. */
  readonly clockReads: number
  /** The generation frozen before the worker's expected Gate-5 continuation gap makes it exit. */
  readonly generation: Model.GenerationView | undefined
  /** Every PairPermit-bearing write command that reached the driver, in dispatch order. */
  readonly pairWrites: readonly Extract<Model.Command, { readonly type: "pair.write" }>[]
  /** Every pair result the driver returned through its real control seam. */
  readonly pairReturns: readonly Extract<Ports.DriverEvent, { readonly type: "pair.return" }>[]
  /**
   * §8.9 step 6's constructed facts, as the operation holds them.
   *
   * WITHOUT THIS THE WHOLE SUITE IS VACUOUS ABOUT FACT CONSTRUCTION, and that is not hypothetical
   * reasoning — it is the §6.9 shape that an audit caught twice at Gate 4. `proved` is satisfied by
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
              // Deliberately ALWAYS idle. §8.2 makes status a diagnostic, not active-leaf authority,
              // and K6 is the row where the two disagree — a fixture whose status agreed with the
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
 * `discovery: false` omits the capability entirely rather than supplying an empty one — §8.5's
 * ABSENT, which must stay distinguishable from ENUMERATED-AND-EMPTY.
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
   * §10.3's identity capability, with THREE distinguishable states rather than two.
   *
   * Omitted entirely means the capability is ABSENT — the driver cannot answer `planning.return` at
   * all. `"none"` means it is present and resolved NO identity, which is §10.3's genuine
   * "no validated source exists" and I-35's `planning_failed_identity_missing`. An `Identity` means
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
  /** Test-only slice-F stand-in: return both halves verified instead of exercising E3's missing wire. */
  readonly record?: "verified"
  /** Real/custom F1 writer. Unlike `record`, this travels the production request and driver path. */
  readonly recordCapability?: Ports.RecordCapability
  /** Sequential requests in the same Instance; two drives §12.3's retained repair rather than a fresh operation. */
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
    // "§10.3 found no source" — which is the whole distinction this slice turns on.
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
      // test deadlines), which says nothing about I-17. This boundary is the exact closure path that
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
          // The E2/E3 stand-in intentionally ends before physical postflight just as it ended before
          // the writer in those slices. Real RecordCapability fixtures take both commands through
          // production; this branch keeps old freeze-only rows from pretending a database exists.
          if ((!write && !release) || input.record !== "verified") yield* real.command(traced)
          if (input.afterCommand) yield* input.afterCommand(traced)
        }).pipe(Effect.provideService(Clock.Clock, countingClock)),
      run: (run) =>
        real.run(run).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              // Read-only now. Gate 4 issued `planning.begin` here to measure the proof; Gate 5's
              // driver issues it itself, so probing would only re-attempt a transition production
              // already made and report `rejected` for a driver that had in fact proved.
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
        // lock (`coordinator.ts:832`). Reading the view here is what makes §8.4 step 8's ordering —
        // "claim/fence every newly included Session BEFORE signalling effects" — observable.
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
     * §5.1's Location gate, supplied on the request since Gate 5 slice C — it moved off
     * `RuntimePorts` with the other capabilities, for the same cycle reason.
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
     * §10.8's three-state high-water seam. Undefined is a missing wire; `[]` is a real read proving
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
     * THE THREE EVIDENCE CAPABILITIES RIDE THE REQUEST, not `RuntimePorts` — Gate 5 slice B2.
     *
     * Through Gate 4 they were supplied here as per-Instance ports, which meant every row in this
     * file exercised a shape the production graph did not have: production ran a stub with no
     * discovery, no lineage and no toolPart at all. That is §6.9's carried item at its sharpest, and
     * the reason the request is now the only seam that carries them is precisely so this fixture and
     * `closure/run-state.ts` supply capabilities the SAME way. A test path and a production path that
     * differ is this program's most productive defect source.
     */

    /**
     * ABSENT when unscripted, rather than present-and-empty. §18 Gate 4 step 4 treats those as
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
     * The CALLER-VISIBLE failure, which is what §12.2's kinds exist to communicate.
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
      // can only become §12.3's repair attempt; it cannot race the original waiter or create a twin.
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
 * One fact flattened to a comparable tuple, carrying every axis §10.1 and §10.5 put in the record.
 *
 * SORTED, DELIBERATELY. `OperationView.facts` is the merged SET (`model.ts::mergefacts`); §10.2's
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

const recordCoreLayer = () =>
  LayerNode.compile(LayerNode.group([SessionProjector.node, EventV2.node, Database.node]), [
    [Database.node, Database.layerFromPath(":memory:")],
  ])

const recordLayer = () =>
  LayerNode.compile(LayerNode.group([SessionClosureRecord.node, Database.node]), [
    [Database.node, Database.layerFromPath(":memory:")],
  ])

const recordCapability = (core: SessionProjector.ClosureRecordInterface) =>
  Effect.gen(function* () {
    return yield* SessionClosureRecord.Service
  }).pipe(
    Effect.provide(
      SessionClosureRecord.layer.pipe(Layer.provide(Layer.succeed(SessionProjector.ClosureRecordService, core))),
    ),
  )

/** A genuinely fresh production Session reader over a caller-owned durable database. */
const sessionService = (database: Database.Interface) => {
  const layer = LayerNode.compile(Session.node, [
    [Database.node, Layer.succeed(Database.Service, database)],
    [BackgroundJob.node, Layer.mock(BackgroundJob.Service)({})],
    [EventV2Bridge.node, Layer.mock(EventV2Bridge.Service)({})],
    [SessionClosure.node, Layer.mock(SessionClosure.Service)({})],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
  ])
  return Session.Service.pipe(Effect.provide(Layer.fresh(layer)))
}

const prepareRecordSessions = (directory: string, sessions: readonly string[] = [ROOT, CHILD, STRANGER]) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    for (const id of sessions) {
      yield* db
        .insert(SessionTable)
        .values({
          id: SessionID.make(id),
          project_id: Project.ID.global,
          slug: id,
          directory,
          title: id,
          version: "test",
          time_created: 10,
          time_updated: 20,
        })
        .run()
        .pipe(Effect.orDie)
    }
  })

const collisions = [
  { key: "K21", row: "message", coordinate: "foreign" },
  { key: "K21", row: "part", coordinate: "foreign" },
  { key: "K50", row: "message", coordinate: "same" },
  { key: "K50", row: "part", coordinate: "same" },
] as const

const recordFailures = [
  { boundary: "Message writer", kind: "message", after: false, message: "failed", part: "absent" },
  { boundary: "Message readback", kind: "message", after: true, message: "failed", part: "absent" },
  { boundary: "Part writer", kind: "part", after: false, message: "verified", part: "failed" },
  { boundary: "Part readback", kind: "part", after: true, message: "verified", part: "failed" },
] as const

const G3_IDENTITY: Model.Identity = {
  source: "session_identity",
  agent: "closure-g3-agent",
  model: { providerID: "anthropic", modelID: "claude-g3", variant: { present: false } },
}

const driveG3 = (
  participants: readonly Ports.Participant[],
  hooks: {
    readonly beforeRequest?: (closure: SessionClosure.Interface) => Effect.Effect<void>
    readonly beforeSweep?: (index: number, closure: SessionClosure.Interface) => Effect.Effect<void>
    readonly onSignal?: (target: string) => Effect.Effect<void>
    /** Makes A -> B a real active lifetime in sweep one rather than a detached terminal receipt. */
    readonly activeConnector?: boolean
  } = {},
) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const core = yield* SessionProjector.ClosureRecordService
    yield* prepareRecordSessions("/closure-g3-state-at-fence", [ROOT, CHILD, GRANDCHILD])
    const record = yield* recordCapability(core)
    const connector: JobSpec = {
      job: "job_g3_connector",
      owner: ROOT,
      target: CHILD,
      ...(hooks.activeConnector ? {} : { state: "terminal" as const }),
      taskMessage: "msg_g3_root",
      taskCall: "call_g3_child",
    }
    const leaf: JobSpec = {
      job: "job_g3_leaf",
      owner: CHILD,
      target: GRANDCHILD,
      taskMessage: "msg_g3_child",
      taskCall: "call_g3_grandchild",
    }
    const probe = yield* drive({
      root: ROOT,
      frames: hooks.activeConnector
        ? [{ jobs: [connector, leaf] }, { jobs: [] }]
        : [{ jobs: [connector, leaf] }, { jobs: [connector] }],
      toolPart: {
        call_g3_child: { outcome: "cancelled", part: PartID.make("prt_g3_child") },
        // Non-cancelled deliberately: §10.1 makes terminal winner and fence state independent.
        call_g3_grandchild: { outcome: "completed", part: PartID.make("prt_g3_grandchild") },
      },
      participants,
      planIdentity: G3_IDENTITY,
      highWater: [],
      clockMillis: 12_000,
      recordCapability: record,
      beforeRequest: hooks.beforeRequest,
      beforeSweep: hooks.beforeSweep,
      onSignal: hooks.onSignal,
    })
    const service = yield* sessionService(database)
    return {
      probe,
      grandchild: yield* service.messages({ sessionID: SessionID.make(GRANDCHILD) }),
      child: yield* service.messages({ sessionID: SessionID.make(CHILD) }),
      root: yield* service.messages({ sessionID: SessionID.make(ROOT) }),
    }
  }).pipe(Effect.provide(Layer.fresh(recordCoreLayer())))

const closurePart = (message: SessionV1.WithParts | undefined) => {
  const part = message?.parts[0]
  if (!part || part.type !== "text") return
  const metadata = part.metadata?.[CLOSURE_RECORD_METADATA_KEY] as Model.RecordMetadata | undefined
  if (!metadata) return
  return { part, metadata }
}

describe("closure.driver §8.4/§8.6", () => {
  it.live("§8.5/K29(a): an enumerated-and-empty world is a no-work success — proved, with nothing claimed", () =>
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
   * §10.3 / K76 / K77 — Gate 5 slice E1b.
   *
   * `beginPlanning` emits `plan.read` as a COMMAND, and through Gate 4 `driver.command` was
   * `() => Effect.void` — so the read was emitted into a no-op and planning could never be answered.
   * These rows prove the command is now handled, and that the identity-absent outcome is terminal in
   * its own right rather than a stub: `planningReturn` fails to `planning_failed_identity_missing`
   * BEFORE it looks at the seed, which is why this lands at E1b while the freeze waits for E2.
   *
   * THE WORLD HAS TO PROVE AN EDGE. An enumerated-and-empty world constructs no facts at all
   * (K29(a)), so `plantargets` would be empty, `facts.map(identityFor)` would be empty, and the
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

  it.live("K76/K77: a resolved-but-empty identity fails planning before any generation exists", () =>
    Effect.gen(function* () {
      const missing = yield* drive({ root: ROOT, frames: IDENTITY_WORLD, planIdentity: "none" })

      // Positive precondition: the capability was actually consulted, so the failure below is about
      // what §10.3 found rather than about a read that never happened.
      expect(missing.planIdentityCalls).toBeGreaterThan(0)
      /**
       * I-35: "absence of every validated identity source produces pre-freeze planning failure; no
       * synthetic Message or generation is fabricated."
       *
       * ASSERTED ON THE CALLER-VISIBLE KIND, not the phase, and not by preference: this failure
       * settles the request from inside the driver, so the Instance scope closes before the
       * in-driver view probe's continuation is scheduled — the same race slice D diagnosed for
       * `unproved`. `failureKind` is read in the test fiber and cannot race.
       *
       * §12.2 maps the `planning_failed_identity_missing` phase to the public kind `planning_failed`,
       * so that is what a requester is told. The two controls below are what make it specific: they
       * pin the only other two states this wiring can produce, so `planning_failed` here cannot be
       * some other planning failure.
       */
      expect(missing.failureKind).toBe("planning_failed")

      /**
       * CONTROL 1 — a RESOLVED identity freezes. Same world, same wiring, one field different. E2
       * supplies the seed, so the operation now crosses the former `unverified` stop and enters
       * `recording`. Without this, the row above would pass for a driver that failed planning
       * unconditionally.
       */
      const resolved = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        clockMillis: 5_000,
        // Isolate the E2 freeze assertions from E3's deliberate missing-record-wire failure.
        record: "verified",
      })
      expect(resolved.planIdentityCalls).toBeGreaterThan(0)
      expect(resolved.phase).toBe("recording")
      expect(resolved.generation?.records).toHaveLength(3)

      /**
       * E2 / K43 / K74 / K75's REAL-COORDINATE half. These are the same schemas the future writer
       * accepts, not test-only `Model.id` literals, and all four coordinates across all facts are
       * globally distinct as `planningReturn` requires.
       */
      const records = resolved.generation?.records ?? []
      const coordinateIDs = records.flatMap((record) => {
        expect(String(Schema.decodeUnknownSync(MessageID)(record.message as unknown))).toBe(String(record.message))
        expect(String(Schema.decodeUnknownSync(PartID)(record.part as unknown))).toBe(String(record.part))
        expect(String(Schema.decodeUnknownSync(EventV2.ID)(record.messageEvent as unknown))).toBe(
          String(record.messageEvent),
        )
        expect(String(Schema.decodeUnknownSync(EventV2.ID)(record.partEvent as unknown))).toBe(String(record.partEvent))
        return [record.message, record.part, record.messageEvent, record.partEvent]
      })
      expect(new Set(coordinateIDs).size).toBe(coordinateIDs.length)

      /**
       * B — I-17's sharp clock instrument. The count is read AFTER the worker finalizer has driven
       * the reachable post-freeze `worker.exited` transition, so it proves both seed construction's
       * one read and zero reads on the subsequent transition. A Clock access inside `record` would
       * make this two immediately.
       */
      expect(resolved.clockReads).toBe(1)
      expect(resolved.highWaterCalls).toEqual([])
      expect(records.map((record) => record.messageTime)).toEqual([5_000, 5_002, 5_004])

      /**
       * CONTROL 2 — ABSENT is not RESOLVED-EMPTY, and this is the distinction the slice turns on.
       * With no capability the driver returns before answering, so planning is never answered and
       * the operation stays in `planning` — the same phase as CONTROL 1 but for the opposite reason.
       * A driver that treated a missing wire as "no identity found" would fail the operation here on
       * the strength of its own unwiring, which is exactly the fail-open lie §8.5 forbids elsewhere.
       */
      const unwired = yield* drive({ root: ROOT, frames: IDENTITY_WORLD })
      expect(unwired.planIdentityCalls).toBe(0)
      expect(unwired.phase).toBe("planning")
      expect(unwired.clockReads).toBe(0)
    }),
  )

  it.live("§10.8: the seed uses the returned cross-session high-water, while present-empty stays at the clock", () =>
    Effect.gen(function* () {
      const high = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        clockMillis: 6_000,
        highWater: [
          { session: ROOT, millis: 5_500 },
          { session: CHILD, millis: 7_200 },
          // Not a plan target. The scripted adapter omits it just as the production query does.
          { session: STRANGER, millis: 99_000 },
        ],
        record: "verified",
      })
      expect(high.phase).toBe("recording")
      expect(high.highWaterCalls).toEqual([[CHILD, ROOT]])
      expect(high.generation?.records.map((record) => record.messageTime)).toEqual([7_201, 7_203, 7_205])
      expect(high.clockReads).toBe(1)

      const empty = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        clockMillis: 6_000,
        highWater: [],
        record: "verified",
      })
      // Positive precondition for the empty-result assertion: the capability was present and read.
      expect(empty.highWaterCalls).toEqual([[CHILD, ROOT]])
      expect(empty.generation?.records).toHaveLength(3)
      expect(empty.generation?.records.map((record) => record.messageTime)).toEqual([6_000, 6_002, 6_004])
    }),
  )

  it.live("§10.8/I-35: unreadable high-water rows degrade before identity-missing is classified", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        [0, 1] as const,
        (failAt) =>
          Effect.gen(function* () {
            let queries = 0
            const query: Record<string, unknown> = {}
            query.from = () => query
            query.where = () => query
            query.groupBy = () => query
            query.all = () => {
              const index = queries++
              return index === failAt
                ? Effect.fail(new Error(`unreadable high-water query ${index}`))
                : Effect.succeed([])
            }
            const database = Layer.succeed(Database.Service, { db: { select: () => query } as never })
            const observed = yield* Effect.gen(function* () {
              const source = yield* SessionClosureHighWater.Service
              const calls = yield* Ref.make(0)

              const result = yield* drive({
                root: ROOT,
                frames: IDENTITY_WORLD,
                planIdentity: "none",
                highWaterCapability: {
                  read: (targets) => Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(source.read(targets))),
                },
              })
              return { result, calls: yield* Ref.get(calls) }
            }).pipe(Effect.provide(Layer.fresh(SessionClosureHighWater.layer.pipe(Layer.provideMerge(database)))))

            // Positive preconditions: both planning inputs were reached on a fact-bearing world.
            expect(observed.result.planIdentityCalls).toBeGreaterThan(0)
            expect(observed.calls).toBe(1)
            expect(queries).toBe(2)
            expect(observed.result.failureKind).toBe("planning_failed")
          }),
        { concurrency: 1, discard: true },
      )
    }),
  )

  it.live("§9.6: PairPermits serialize the whole committed prefix and stop only at the model's fact gate", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        highWater: [],
        record: "verified",
      })
      const current = operation(probe)
      if (!current || !probe.generation) return yield* Effect.die("expected one frozen generation")
      const generation = probe.generation

      // Positive precondition: this is a multi-pair generation. A one-fact fixture could not tell a
      // committed-prefix loop from a driver that issued exactly once and returned.
      expect(generation.facts).toHaveLength(3)
      expect(probe.pairWrites).toHaveLength(generation.facts.length)
      expect(probe.pairReturns).toHaveLength(generation.facts.length)
      expect(probe.view.pairs).toHaveLength(generation.facts.length)

      for (const [index, write] of probe.pairWrites.entries()) {
        const returned = probe.pairReturns.find((item) => item.write.permit === write.permit)
        // Model normalization sorts PairViews by opaque PairID, so array position is deliberately
        // NOT the committed-prefix order. Correlate through the token the protocol actually names.
        const permit = probe.view.pairs.find((item) => item.id === write.permit)
        const fact = generation.facts[index]
        if (!returned || !permit || !fact) return yield* Effect.die(`missing pair ${index}`)

        // PairID is opaque: identity, not structural equality, is the contract. The same coordinator-
        // minted token must inhabit the command, the return, and the committed PairView.
        expect(permit.id).toBe(write.permit)
        expect(returned.write.permit).toBe(write.permit)
        expect(returned.write).toBe(write)
        expect(write.candidate.expectedPrefix).toBe(index)
        expect(write.candidate.fact).toBe(fact)
        expect(permit.fact).toBe(fact)
        expect(permit.state).toBe("returned")
        expect(returned.message).toBe("verified")
        expect(returned.part).toBe("verified")
      }

      // Every verified return advanced exactly one slot. The absence of a fourth write is decided by
      // `nextPair` finding no fact at this prefix, not by the fixture's count.
      expect(generation.committedPrefix).toBe(generation.facts.length)
      expect(generation.verified).toHaveLength(generation.facts.length)
      generation.verified.forEach((fact, index) => expect(fact).toBe(generation.facts[index] as Model.FactID))
      expect(generation.inFlight).toEqual([])
      expect(generation.failure).toBeUndefined()
      expect(probe.phase).toBe("recording")
      for (let index = 1; index < probe.pairWrites.length; index++)
        expect(probe.pairWrites[index]?.permit).not.toBe(probe.pairWrites[index - 1]?.permit)
    }),
  )

  it.live("§11.5/F1: the real record capability commits every pair and advances the production prefix", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const record = yield* SessionClosureRecord.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/closure-f1"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      for (const id of [ROOT, CHILD]) {
        yield* db
          .insert(SessionTable)
          .values({
            id: SessionID.make(id),
            project_id: Project.ID.global,
            slug: id,
            directory: "/closure-f1",
            title: `unchanged-${id}`,
            version: "test",
            time_created: 10,
            time_updated: 20,
          })
          .run()
          .pipe(Effect.orDie)
      }
      const before = yield* db
        .select()
        .from(SessionTable)
        .where(inArray(SessionTable.id, [SessionID.make(ROOT), SessionID.make(CHILD)]))
        .all()
        .pipe(Effect.orDie)

      const probe = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        highWater: [],
        clockMillis: 8_000,
        recordCapability: record,
      })
      const generation = probe.generation
      if (!generation) return yield* Effect.die("expected a frozen generation")

      expect(generation.records).toHaveLength(3)
      expect(probe.pairWrites).toHaveLength(3)
      expect(probe.pairReturns).toHaveLength(3)
      expect(generation.committedPrefix).toBe(3)
      expect(generation.verified).toEqual(generation.facts)
      expect(generation.failure).toBeUndefined()
      expect(probe.pairReturns.map((item) => [item.message, item.part])).toEqual([
        ["verified", "verified"],
        ["verified", "verified"],
        ["verified", "verified"],
      ])

      for (const frozen of generation.records) {
        const message = yield* db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, MessageID.make(String(frozen.message))))
          .get()
          .pipe(Effect.orDie)
        const part = yield* db
          .select()
          .from(PartTable)
          .where(eq(PartTable.id, PartID.make(String(frozen.part))))
          .get()
          .pipe(Effect.orDie)
        const target =
          frozen.fact.type === "self"
            ? frozen.fact.subject
            : frozen.fact.type === "edge"
              ? frozen.fact.owner
              : frozen.fact.root
        expect(message).toMatchObject({
          session_id: String(target),
          time_created: frozen.messageTime,
          time_updated: frozen.messageTime,
          data: { role: "user", agent: frozen.identity.agent },
        })
        expect(part).toMatchObject({
          message_id: String(frozen.message),
          session_id: String(target),
          time_created: frozen.partTime,
          time_updated: frozen.partTime,
          data: {
            type: "text",
            text: frozen.text,
            synthetic: true,
            metadata: { [CLOSURE_RECORD_METADATA_KEY]: frozen.metadata },
          },
        })
      }
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(3)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(3)
      expect(
        yield* db
          .select()
          .from(SessionTable)
          .where(inArray(SessionTable.id, [SessionID.make(ROOT), SessionID.make(CHILD)]))
          .all()
          .pipe(Effect.orDie),
      ).toEqual(before)
    }).pipe(Effect.provide(recordLayer())),
  )

  // K86 capability-writer clause, in addition to K19/K43/K104. Mutant
  // `gate6-capability-writer-produces-complete-pair` corrupts the reserved key; red: the restarted
  // Session consumer no longer classifies every exact readback as genuine closure evidence.
  it.live("K19/K43/K104: resumed real rows retain transcript order, exact truth, recency, and restart discovery", () =>
    Effect.gen(function* () {
      const directory = "/closure-g2-resume"
      const database = yield* Database.Service
      const db = database.db
      const core = yield* SessionProjector.ClosureRecordService
      const identity: Model.Identity = {
        source: "session_identity",
        agent: "closure-g2-agent",
        model: {
          providerID: "anthropic",
          modelID: "claude-g2",
          variant: { present: true, value: "high" },
        },
      }

      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      for (const item of [
        { id: ROOT, updated: 20 },
        { id: CHILD, updated: 20 },
        { id: GRANDCHILD, updated: 20 },
        // A sentinel one tick newer makes any forbidden closure touch visible at the list surface.
        { id: STRANGER, updated: 21 },
      ]) {
        yield* db
          .insert(SessionTable)
          .values({
            id: SessionID.make(item.id),
            project_id: Project.ID.global,
            slug: item.id,
            directory,
            title: `unchanged-${item.id}`,
            version: "test",
            time_created: 10,
            time_updated: item.updated,
          })
          .run()
          .pipe(Effect.orDie)
      }

      /**
       * The production Session service over the SAME database, rebuilt rather than substituted.
       * Its unused mutation dependencies are fail-loud mocks; `messages` and `listGlobal` touch none
       * of them. `Layer.fresh` is outside the consumer so its transitive rebuild cannot be shadowed by
       * the module-level `Session.layer` object's memo identity.
       */
      const liveSession = yield* sessionService(database)
      const list = (service: Session.Interface) =>
        service.listGlobal({ directory }).pipe(Effect.map((items) => items.map((item) => String(item.id))))
      const readSessions = () =>
        db
          .select()
          .from(SessionTable)
          .where(
            inArray(SessionTable.id, [
              SessionID.make(ROOT),
              SessionID.make(CHILD),
              SessionID.make(GRANDCHILD),
              SessionID.make(STRANGER),
            ]),
          )
          .orderBy(asc(SessionTable.id))
          .all()
          .pipe(Effect.orDie)

      const baselineOrder = [STRANGER, ROOT, GRANDCHILD, CHILD]
      const baselineRows = yield* readSessions()
      expect(yield* list(liveSession)).toEqual(baselineOrder)

      // K104's CHEAP REACHABILITY INSTRUMENT. The same production list query must visibly react to
      // the forbidden column before its later equality can count as evidence. Restore the exact row
      // before publication, then prove the entire fixture is byte-back at baseline.
      yield* db
        .update(SessionTable)
        .set({ time_updated: 22 })
        .where(eq(SessionTable.id, SessionID.make(CHILD)))
        .run()
        .pipe(Effect.orDie)
      expect(yield* list(liveSession)).toEqual([CHILD, STRANGER, ROOT, GRANDCHILD])
      yield* db
        .update(SessionTable)
        .set({ time_updated: 20 })
        .where(eq(SessionTable.id, SessionID.make(CHILD)))
        .run()
        .pipe(Effect.orDie)
      expect(yield* list(liveSession)).toEqual(baselineOrder)
      expect(yield* readSessions()).toEqual(baselineRows)

      type PublicationStatus = {
        readonly kind: "message" | "part"
        readonly status: "committed_new" | "existing_exact"
      }
      type RecencyBoundary = {
        readonly rows: readonly (typeof SessionTable.$inferSelect)[]
        readonly order: readonly string[]
      }
      const statuses = yield* Ref.make<readonly PublicationStatus[]>([])
      const firstBoundary = yield* Ref.make<RecencyBoundary | undefined>(undefined)
      const repairBoundary = yield* Ref.make<RecencyBoundary | undefined>(undefined)
      const injected = yield* Ref.make(false)
      const once = Ref.modify(injected, (current) => [!current, true] as const)
      const wrapped = SessionProjector.ClosureRecordService.of({
        message: (input) =>
          core
            .message(input)
            .pipe(
              Effect.tap((result) =>
                Ref.update(statuses, (current) => [...current, { kind: "message" as const, status: result.status }]),
              ),
            ),
        part: (input) =>
          Effect.gen(function* () {
            const result = yield* core.part(input)
            yield* Ref.update(statuses, (current) => [...current, { kind: "part" as const, status: result.status }])
            if (result.status === "existing_exact")
              yield* Ref.set(repairBoundary, { rows: yield* readSessions(), order: yield* list(liveSession) })
            if (!(yield* once)) return result
            // This is after the real Part transaction committed but before its injected readback
            // failure reaches the record adapter: exactly the first publication boundary K104 names.
            yield* Ref.set(firstBoundary, { rows: yield* readSessions(), order: yield* list(liveSession) })
            return yield* Effect.fail(new Error("injected G2 Part readback failure"))
          }),
        verify: core.verify,
      })
      const record = yield* recordCapability(wrapped)
      const connector = {
        job: "job_connector",
        owner: ROOT,
        target: CHILD,
        state: "terminal",
        taskMessage: "msg_root_g2",
        taskCall: "call_child_g2",
      } as const
      const probe = yield* drive({
        root: ROOT,
        frames: [
          {
            jobs: [
              connector,
              {
                job: "job_grandchild_g2",
                owner: CHILD,
                target: GRANDCHILD,
                taskMessage: "msg_child_g2",
                taskCall: "call_grandchild_g2",
              },
            ],
          },
          { jobs: [connector] },
        ],
        toolPart: {
          call_child_g2: { outcome: "completed", part: PartID.make("prt_child_g2") },
          call_grandchild_g2: { outcome: "cancelled", part: PartID.make("prt_grandchild_g2") },
        },
        planIdentity: identity,
        highWater: [],
        clockMillis: 8_000,
        recordCapability: record,
        attempts: 2,
      })
      const generation = probe.generation
      const boundary = yield* Ref.get(firstBoundary)
      const repaired = yield* Ref.get(repairBoundary)
      if (!generation || !boundary || !repaired)
        return yield* Effect.die("G2 did not freeze or cross both publication boundaries")

      // The injected post-commit failure made repair reachable, and the same pair took the exact
      // existing-row path before the other four pairs committed. A fresh operation could not produce
      // these two leading status pairs or the six issued PairPermits.
      expect(yield* Ref.get(injected)).toBe(true)
      expect(probe.failureKinds).toEqual(["record_failed", undefined])
      expect(probe.pairWrites).toHaveLength(6)
      expect(probe.pairReturns).toHaveLength(6)
      expect(probe.pairReturns[0]).toMatchObject({ message: "verified", part: "failed" })
      expect(probe.pairReturns.slice(1).every((item) => item.message === "verified" && item.part === "verified")).toBe(
        true,
      )
      const observedStatuses = yield* Ref.get(statuses)
      expect(observedStatuses.filter((item) => item.kind === "message").map((item) => item.status)).toEqual([
        "committed_new",
        "existing_exact",
        "committed_new",
        "committed_new",
        "committed_new",
        "committed_new",
      ])
      expect(observedStatuses.filter((item) => item.kind === "part").map((item) => item.status)).toEqual([
        "committed_new",
        "existing_exact",
        "committed_new",
        "committed_new",
        "committed_new",
        "committed_new",
      ])
      expect(generation.committedPrefix).toBe(5)
      expect(generation.verified).toEqual(generation.facts)
      expect(generation.failure).toBeUndefined()
      expect(probe.phase).toBe("released_pending_delivery")

      // K104(a), independently at first publication and after exact repair/release. The earlier
      // sensitivity probe established that either order assertion goes red for a forbidden touch.
      expect(boundary.rows).toEqual(baselineRows)
      expect(boundary.order).toEqual(baselineOrder)
      expect(repaired.rows).toEqual(baselineRows)
      expect(repaired.order).toEqual(baselineOrder)
      expect(yield* readSessions()).toEqual(baselineRows)
      expect(yield* list(liveSession)).toEqual(baselineOrder)

      const expected = [
        {
          kind: "self" as const,
          target: GRANDCHILD,
          subject: GRANDCHILD,
          outcome: "cancelled" as const,
          text: "[Branch closure] This Session's prior Task execution: Cancellation won physical closure.",
        },
        {
          kind: "edge" as const,
          target: CHILD,
          subject: GRANDCHILD,
          owner: CHILD,
          child: GRANDCHILD,
          taskPart: "prt_grandchild_g2",
          outcome: "cancelled" as const,
          text: `[Branch closure] Child Session ${GRANDCHILD}: Cancellation won physical closure. Owner Session: ${CHILD}.`,
        },
        {
          kind: "self" as const,
          target: CHILD,
          subject: CHILD,
          outcome: "completed" as const,
          text: "[Branch closure] This Session's prior Task execution: The tracked execution completed before cancellation took effect.",
        },
        {
          kind: "edge" as const,
          target: ROOT,
          subject: CHILD,
          owner: ROOT,
          child: CHILD,
          taskPart: "prt_child_g2",
          outcome: "completed" as const,
          text: `[Branch closure] Child Session ${CHILD}: The tracked execution completed before cancellation took effect. Owner Session: ${ROOT}.`,
        },
        {
          kind: "root" as const,
          target: ROOT,
          subject: ROOT,
          text: `[Branch closure] Requested Session ${ROOT}: Its in-scope Task branch reached conversational quiescence.`,
        },
      ]

      // K43's real-row preconditions: all five postorder facts exist, all four coordinates per fact
      // are globally unique, and the generation itself is a real positive generation.
      expect(generation.generation).toBeGreaterThan(0)
      expect(generation.records).toHaveLength(expected.length)
      expect(generation.records.map((item) => item.fact.type)).toEqual(expected.map((item) => item.kind))
      const coordinates = generation.records.flatMap((item) => [
        String(item.message),
        String(item.part),
        String(item.messageEvent),
        String(item.partEvent),
      ])
      expect(new Set(coordinates).size).toBe(coordinates.length)

      // K104(b): build the actual Session consumer again over the same durable database. Identity is
      // asserted, not assumed; without `Layer.fresh`, an object-identity memo hit would fail here.
      const restartedSession = yield* sessionService(database)
      expect(restartedSession).not.toBe(liveSession)
      const grandchildTranscript = yield* restartedSession.messages({ sessionID: SessionID.make(GRANDCHILD) })
      const childTranscript = yield* restartedSession.messages({ sessionID: SessionID.make(CHILD) })
      const rootTranscript = yield* restartedSession.messages({ sessionID: SessionID.make(ROOT) })

      // K19's order exists before it is asserted: the intermediate and root each have two records.
      // These are ordinary `Session.messages` results, which page through `MessageV2.page`; no writer
      // return value or direct row helper participates in this ordering assertion.
      expect(grandchildTranscript).toHaveLength(1)
      expect(childTranscript).toHaveLength(2)
      expect(rootTranscript).toHaveLength(2)
      const kind = (message: (typeof rootTranscript)[number]) => {
        const part = message.parts[0]
        if (!part || part.type !== "text") return undefined
        return (part.metadata?.[CLOSURE_RECORD_METADATA_KEY] as Model.RecordMetadata | undefined)?.record_kind
      }
      expect(grandchildTranscript.map(kind)).toEqual(["self"])
      expect(childTranscript.map(kind)).toEqual(["edge", "self"])
      expect(rootTranscript.map(kind)).toEqual(["edge", "root"])
      const resumed = [...grandchildTranscript, ...childTranscript, ...rootTranscript]
      expect(resumed).toHaveLength(5)

      const messageVersion = SessionV1.Event.MessageUpdated.durable?.version
      const partVersion = SessionV1.Event.PartUpdated.durable?.version
      if (messageVersion === undefined || partVersion === undefined)
        return yield* Effect.die("closure events unexpectedly lost durability")
      const nextSequence = new Map<string, number>()

      for (const [index, frozen] of generation.records.entries()) {
        const shape = expected[index]
        if (!shape) return yield* Effect.die(`missing expected G2 record ${index}`)
        expect(frozen.fact.type).toBe(shape.kind)
        const common = {
          version: 1 as const,
          freeze_owner_operation_id: generation.freezeOwner,
          generation: generation.generation,
          fact_key: frozen.fact.key,
          identity_source: "session_identity" as const,
        }
        const metadata: Model.RecordMetadata =
          shape.kind === "self"
            ? {
                ...common,
                record_kind: "self",
                subject_session_id: Model.id("session", shape.subject),
                terminal_outcome: shape.outcome,
              }
            : shape.kind === "edge"
              ? {
                  ...common,
                  record_kind: "edge",
                  subject_session_id: Model.id("session", shape.subject),
                  owner_session_id: Model.id("session", shape.owner),
                  child_session_id: Model.id("session", shape.child),
                  task_part_id: Model.id("part", shape.taskPart),
                  terminal_outcome: shape.outcome,
                }
              : {
                  ...common,
                  record_kind: "root",
                  requested_root_session_id: Model.id("session", ROOT),
                  subject_session_id: Model.id("session", ROOT),
                  branch_outcome: "quiesced",
                }
        expect(frozen.identity).toEqual(identity)
        expect(frozen.text).toBe(shape.text)
        expect(frozen.metadata).toEqual(metadata)

        // Both truth axes, at the real readback boundary. Self/edge positively carry terminal truth
        // before state omission is checked; root positively carries branch truth before its direct
        // terminal omission is checked. Exact object equality above also rejects undefined/null keys.
        if (metadata.record_kind === "root") {
          expect(metadata.branch_outcome).toBe("quiesced")
          expect(Object.hasOwn(metadata, "terminal_outcome")).toBe(false)
        } else {
          if (shape.kind === "root") return yield* Effect.die(`G2 metadata kind diverged at ${index}`)
          expect(metadata.terminal_outcome).toBe(shape.outcome)
          expect(Object.hasOwn(metadata, "requested_root_session_id")).toBe(false)
        }
        expect(Object.hasOwn(metadata, "state_at_fence")).toBe(false)
        expect(Object.hasOwn(metadata, "source_user_message_id")).toBe(false)

        const info: SessionV1.User = {
          id: MessageID.make(String(frozen.message)),
          sessionID: SessionID.make(shape.target),
          role: "user",
          time: { created: frozen.messageTime },
          agent: identity.agent,
          model: {
            providerID: ProviderV2.ID.make("anthropic"),
            modelID: ModelV2.ID.make("claude-g2"),
            variant: "high",
          },
        }
        const text: SessionV1.TextPart = {
          id: PartID.make(String(frozen.part)),
          sessionID: SessionID.make(shape.target),
          messageID: MessageID.make(String(frozen.message)),
          type: "text",
          text: shape.text,
          synthetic: true,
          metadata: { [CLOSURE_RECORD_METADATA_KEY]: metadata },
        }
        const resumedMessage = resumed.find((item) => String(item.info.id) === String(frozen.message))
        expect(resumedMessage).toBeDefined()
        expect(resumedMessage?.info).toEqual(info)
        expect(resumedMessage?.parts).toEqual([text])
        expect(resumedMessage ? isCompleteClosurePair(resumedMessage) : false).toBe(true)

        const messageRow = yield* db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, info.id))
          .get()
          .pipe(Effect.orDie)
        const partRow = yield* db.select().from(PartTable).where(eq(PartTable.id, text.id)).get().pipe(Effect.orDie)
        expect(messageRow).toEqual({
          id: info.id,
          session_id: info.sessionID,
          time_created: frozen.messageTime,
          time_updated: frozen.messageTime,
          data: {
            role: "user",
            time: info.time,
            agent: info.agent,
            model: info.model,
          } as typeof MessageTable.$inferSelect.data,
        })
        expect(partRow).toEqual({
          id: text.id,
          message_id: text.messageID,
          session_id: text.sessionID,
          time_created: frozen.partTime,
          time_updated: frozen.partTime,
          data: {
            type: "text",
            text: shape.text,
            synthetic: true,
            metadata: { [CLOSURE_RECORD_METADATA_KEY]: metadata },
          } as typeof PartTable.$inferSelect.data,
        })

        const sequence = nextSequence.get(shape.target) ?? 0
        const messageEvent = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.id, EventV2.ID.make(String(frozen.messageEvent))))
          .get()
          .pipe(Effect.orDie)
        const partEvent = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.id, EventV2.ID.make(String(frozen.partEvent))))
          .get()
          .pipe(Effect.orDie)
        expect(messageEvent).toEqual({
          id: EventV2.ID.make(String(frozen.messageEvent)),
          aggregate_id: shape.target,
          seq: sequence,
          type: EventV2.versionedType(SessionV1.Event.MessageUpdated.type, messageVersion),
          data: { sessionID: shape.target, info },
        })
        expect(partEvent).toEqual({
          id: EventV2.ID.make(String(frozen.partEvent)),
          aggregate_id: shape.target,
          seq: sequence + 1,
          type: EventV2.versionedType(SessionV1.Event.PartUpdated.type, partVersion),
          data: { sessionID: shape.target, part: text, time: frozen.partTime },
        })
        nextSequence.set(shape.target, sequence + 2)
      }

      expect(
        yield* db
          .select()
          .from(EventSequenceTable)
          .where(inArray(EventSequenceTable.aggregate_id, [ROOT, CHILD, GRANDCHILD]))
          .orderBy(asc(EventSequenceTable.aggregate_id))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([
        { aggregate_id: CHILD, seq: 3, owner_id: null },
        { aggregate_id: GRANDCHILD, seq: 1, owner_id: null },
        { aggregate_id: ROOT, seq: 3, owner_id: null },
      ])
    }).pipe(Effect.provide(Layer.fresh(recordCoreLayer()))),
  )

  it.live("§14.2: the discover -> claim -> cancel chain issues each exchange once, keyed by its own fact's key", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<readonly Ports.ParticipantCall[]>([])
      const answer = (input: Ports.ParticipantCall, value: unknown) =>
        Ref.update(calls, (current) => [...current, input]).pipe(
          Effect.as({ revision: input.participantRevision + 1n, result: "success" as const, value }),
        )
      const participant: Ports.Participant = {
        id: Model.id("participant", "participant_g8_chain"),
        // Coverage for the LEAF edge only. The connector edge ROOT->CHILD is handed in and
        // deliberately NOT marked, which is what makes the subset selection observable rather than
        // assumed: if `claim` named CHILD too, the participant would have widened core's scope.
        discover: (input) => answer(input, [{ type: "participant_edge", subject: GRANDCHILD, owner: CHILD }]),
        claim: (input) => answer(input, [{ type: "participant_claim", subject: GRANDCHILD, claim: "held" }]),
        cancel: (input) => answer(input, [{ type: "participant_cancel", subject: GRANDCHILD, outcome: "interrupted" }]),
        observe: (input) => answer(input, []),
      }
      const result = yield* driveG3([participant])
      if (!result.probe.generation) return yield* Effect.die("§14.2 chain fixture did not freeze a generation")

      const seen = yield* Ref.get(calls)
      const byKind = (kind: Ports.ParticipantKind) => seen.filter((item) => item.kind === kind)

      // ONE OF EACH, across every sweep. This is the dedup proof and it is a LIVENESS property:
      // undeduped, each exchange would re-issue per sweep and exhaust SWEEP_LIMIT, which presents
      // as a mysterious sweep-limit error rather than as a wrong answer.
      expect(byKind("discover")).toHaveLength(1)
      expect(byKind("claim")).toHaveLength(1)
      expect(byKind("cancel")).toHaveLength(1)
      expect(byKind("observe")).toHaveLength(1)

      // §14.2's order: coverage first; `claim` only after core has claimed, fenced and signalled,
      // so no new work can enter; `cancel` only after `claim`; `observe` only after the fixed point.
      expect(seen.map((item) => item.kind)).toEqual(["discover", "claim", "cancel", "observe"])

      // `discover` is handed core's ALREADY-PROVEN edges, so a reply can only ever be a subset.
      expect(byKind("discover")[0]?.payload).toEqual({
        edges: [
          { owner: Model.id("session", ROOT), child: Model.id("session", CHILD) },
          { owner: Model.id("session", CHILD), child: Model.id("session", GRANDCHILD) },
        ],
      })

      // `claim` names ONLY the covered subject. CHILD was proven and offered and went unmarked, so
      // claiming it would be the widening the subset selection exists to prevent. Core injects one
      // fieldless fence-generation ref; the driver supplied only the subject name.
      const claimPayload = byKind("claim")[0]?.payload as
        | { readonly fences?: readonly Ports.ParticipantFenceInput[] }
        | undefined
      expect(claimPayload?.fences?.map((item) => item.subject)).toEqual([Model.id("session", GRANDCHILD)])
      expect(Object.keys(claimPayload?.fences?.[0]?.ref ?? {})).toEqual([])
      expect(Object.isFrozen(claimPayload?.fences?.[0]?.ref)).toBe(true)

      // `cancel` remains keyed by SUBJECT and echoes core's folded outcome. Its private payload also
      // carries the exact opaque ref core supplied at claim, so the participant cannot re-locate a
      // replacement attachment generation by SessionID.
      const cancelPayload = byKind("cancel")[0]?.payload as
        | { readonly cancels?: readonly Ports.ParticipantCancelFenceInput[] }
        | undefined
      expect(cancelPayload?.cancels?.map(({ subject, outcome }) => ({ subject, outcome }))).toEqual([
        { subject: Model.id("session", GRANDCHILD), outcome: "interrupted" },
      ])
      expect(cancelPayload?.cancels?.[0]?.ref).toBe(claimPayload?.fences?.[0]?.ref)
    }),
  )

  it.live("§8.6: a subject's handles fold WEAKEST-FIRST, so a cancel receipt never over-reports interruption", () =>
    /**
     * THE ORDERING ITSELF, which no other row exercises. Every other fixture handle returns
     * `interrupted`, so `foldOutcome` would answer `interrupted` under ANY ordering and a
     * strongest-first mutation would not discriminate. This is the defect class the B1 slice
     * recorded against itself: a property asserted by a suite that could not have contradicted it.
     *
     * `signalFor` composes one handle per PHYSICAL TARGET that makes a Session an active leaf, so
     * two handles require a Session that is active for two distinct reasons at once — its own busy
     * Runner AND a continuable job speaking into it. They report DIFFERENT outcomes here, which is
     * what makes the fold observable at all.
     *
     * The direction is the assertion. `in_progress` is the weakest outcome and `interrupted` the
     * strongest, so weakest-first must answer `in_progress`: one handle reporting work still
     * running means the subject is not established as interrupted, whatever the other handle
     * achieved. Over-reporting is the dangerous direction because the receipt would assert more
     * than the signal established; under-reporting costs a sweep.
     */
    Effect.gen(function* () {
      const calls = yield* Ref.make<readonly Ports.ParticipantCall[]>([])
      const answer = (input: Ports.ParticipantCall, value: unknown) =>
        Ref.update(calls, (current) => [...current, input]).pipe(
          Effect.as({ revision: input.participantRevision + 1n, result: "success" as const, value }),
        )
      const participant: Ports.Participant = {
        id: Model.id("participant", "participant_g8_fold"),
        discover: (input) => answer(input, [{ type: "participant_edge", subject: CHILD, owner: ROOT }]),
        claim: (input) => answer(input, [{ type: "participant_claim", subject: CHILD, claim: "held" }]),
        cancel: (input) => answer(input, []),
        observe: (input) => answer(input, []),
      }
      yield* drive({
        root: ROOT,
        frames: [
          {
            runners: [{ session: CHILD, running: true, outcome: "interrupted" }],
            jobs: [{ job: "job_fold", owner: ROOT, target: CHILD, outcome: "in_progress" }],
          },
          {},
        ],
        participants: [participant],
      })

      const cancels = (yield* Ref.get(calls)).filter((item) => item.kind === "cancel")
      expect(cancels).toHaveLength(1)
      const claim = (yield* Ref.get(calls)).find((item) => item.kind === "claim")?.payload as
        | { readonly fences?: readonly Ports.ParticipantFenceInput[] }
        | undefined
      const cancel = cancels[0]?.payload as
        | { readonly cancels?: readonly Ports.ParticipantCancelFenceInput[] }
        | undefined
      expect(cancel?.cancels?.map(({ subject, outcome }) => ({ subject, outcome }))).toEqual([
        { subject: Model.id("session", CHILD), outcome: "in_progress" },
      ])
      expect(cancel?.cancels?.[0]?.ref).toBe(claim?.fences?.[0]?.ref)
    }),
  )

  it.live("K79: a participant re-entering core mid-exchange terminates, for EVERY registered participant", () =>
    /**
     * §14.2's lock discipline, stated as "neither side calls the other while holding its
     * state-authority lock", and K79's obligation that BOTH acquisition orders terminate without an
     * ABBA cycle.
     *
     * THE ORDER THIS ROW EXERCISES is the dangerous one: participant-then-core. The participant is
     * RUNNING — so core has already dispatched into it — and from inside that call it re-enters the
     * coordinator through `view`, which takes the very semaphore `issueParticipant` was reached
     * under. If core still held that permit across the exchange this read could never be granted,
     * and the row would not fail an assertion, it would DEADLOCK. `itBounded` is what converts that
     * into a bounded failure rather than a hung suite.
     *
     * WHY THE OTHER ORDER NEEDS NO ROW, and this is the stronger half. Core cannot hold its permit
     * across a participant call because it is structurally unable to: `locked` is
     * `withPermits(1)(Effect.sync(run))` over a thunk typed `() => A`, so the critical section
     * admits no Effect and therefore no suspension point at all. `issueParticipant` builds the
     * dispatch under that permit as a suspended `Effect` and runs it after release. The A-then-B
     * order is UNREPRESENTABLE rather than merely absent, which is the distinction Gate 7 paid four
     * rounds to learn.
     *
     * EVERY PARTICIPANT, NOT THE FIRST. `Effect.forEach(..., { discard: true })` dispatches
     * participants SEQUENTIALLY, so a protocol that released its permit for the first exchange and
     * retained it for a later one would still satisfy a single-participant row. Two participants
     * both re-enter here, and both observations are asserted, so half-held is not a passing state.
     */
    Effect.gen(function* () {
      const holder: { closure?: SessionClosure.Interface } = {}
      const observed = yield* Ref.make<readonly { readonly who: string; readonly operations: number }[]>([])
      const reentrant = (who: string): Ports.Participant => ({
        id: Model.id("participant", `participant_k79_${who}`),
        // The re-entrant read lives on `discover`, the first exchange core issues, so the permit
        // must already be released by the earliest dispatch rather than merely by the last.
        discover: (input) =>
          Effect.gen(function* () {
            const closure = holder.closure
            if (!closure) return yield* Effect.die("K79 fixture never captured the closure service")
            // BOUNDED DELIBERATELY, because the failure this row guards against is a DEADLOCK and an
            // unbounded one is a hung suite rather than a red test. A core holding its permit across
            // this call makes the read unsatisfiable; `-1` records that as an ordinary value the
            // assertion below can contradict, so the defect surfaces in seconds and the fixture
            // still returns, releasing everything it holds.
            // `-1` is the DEADLOCK signature and `-2` a refused read; both are ordinary values the
            // assertion below contradicts, so neither can be mistaken for a healthy observation.
            const operations = yield* closure.view.pipe(
              Effect.map((value) => value.operations.length),
              Effect.timeoutOption(2000),
              Effect.map((value) => (Option.isSome(value) ? value.value : -1)),
              Effect.catch(() => Effect.succeed(-2)),
            )
            yield* Ref.update(observed, (current) => [...current, { who, operations }])
            return { revision: input.participantRevision + 1n, result: "success" as const, value: [] }
          }),
        claim: (input) => Effect.succeed({ revision: input.participantRevision + 1n, result: "success" as const }),
        cancel: (input) => Effect.succeed({ revision: input.participantRevision + 1n, result: "success" as const }),
        observe: (input) => Effect.succeed({ revision: input.participantRevision + 1n, result: "success" as const }),
      })

      yield* drive({
        root: ROOT,
        frames: [{ jobs: [{ job: "job_k79", owner: ROOT, target: CHILD }] }, {}],
        participants: [reentrant("alpha"), reentrant("beta")],
        beforeRequest: (closure) => Effect.sync(() => void (holder.closure = closure)),
      })

      // Reaching here at all is the liveness half: neither re-entry blocked.
      // The operation count is the SOUNDNESS half — a view granted while core's own operation was
      // absent would prove the permit was free for the wrong reason.
      expect(yield* Ref.get(observed)).toEqual([
        { who: "alpha", operations: 1 },
        { who: "beta", operations: 1 },
      ])
    }),
  )

  it.live(
    "G8-09: CP-021 presentation crossing the seam changes no CP-023 outcome (a differential, not an absence check)",
    () =>
      /**
       * WHY A DIFFERENTIAL AND NOT AN ABSENCE CHECK. Asserting that a status string is missing from a
       * record proves the string is missing; it does not prove that nothing downstream READS it. The
       * two arms below run the SAME closure over the SAME fixture and differ only in whether CP-021
       * pushes presentation across the seam, so an outcome difference of any kind is a channel.
       *
       * WHY THE SEAM AND NOT THE TRANSCRIPT. Seeding the status into session messages would be
       * VACUOUS: core's closure inputs are discovery, lineage, ToolPart outcomes, high-water,
       * `validateSession`, identity, and participant facts — none carries transcript text, so that
       * test would be green by construction. The participant is the only CP-021-to-core channel there
       * is, so pushing presentation through IT is the only way this can fail.
       *
       * It genuinely can fail. A parser accepting extra top-level keys, a loose fact-type dispatch, or
       * an array read as a count would each admit one of these payloads, and `yielded` is inside the
       * compared projection — so a derived-zero fact that flipped state-at-fence would show up as a
       * difference rather than as a silently absorbed input.
       */
      Effect.gen(function* () {
        const facts = (extra: readonly unknown[]) => [
          { type: "participant_edge", subject: GRANDCHILD, owner: CHILD },
          ...extra,
        ]
        const fenceSubjectsOf = (payload: unknown) => {
          const list = (payload as { readonly fences?: unknown } | null)?.fences
          if (!Array.isArray(list)) return []
          return list.flatMap((item) => {
            if (typeof item !== "object" || item === null) return []
            const subject = (item as { readonly subject?: unknown }).subject
            return typeof subject === "string" ? [subject] : []
          })
        }
        const cancelsOf = (payload: unknown) => {
          const list = (payload as { readonly cancels?: unknown } | null)?.cancels
          return Array.isArray(list) ? (list as readonly { readonly subject: string; readonly outcome: string }[]) : []
        }
        /**
         * Records what core ASKED, which the comparison needs and records alone cannot supply.
         *
         * Core's facts and records turn out to be structurally insensitive to participant coverage:
         * `covered` and `held` are driver-local sets that drive the exchanges and never enter
         * `pass`, `classify` or `describe`. So a leak that widened coverage would move no record, and
         * a differential over records alone could not fail on that path — vacuous exactly where it
         * most needs to bite. What core asks IS core behaviour, so the asks are compared too.
         */
        const asking = (
          inner: Ports.Participant,
          asks: Ref.Ref<readonly { readonly kind: string; readonly payload: unknown }[]>,
        ): Ports.Participant => {
          const note = (input: Ports.ParticipantCall) =>
            Ref.update(asks, (current) => [...current, { kind: input.kind, payload: input.payload }])
          return {
            id: inner.id,
            discover: (input) => note(input).pipe(Effect.andThen(inner.discover(input))),
            claim: (input) => note(input).pipe(Effect.andThen(inner.claim(input))),
            cancel: (input) => note(input).pipe(Effect.andThen(inner.cancel(input))),
            observe: (input) => note(input).pipe(Effect.andThen(inner.observe(input))),
          }
        }
        const participantFor = (loud: boolean): Ports.Participant => ({
          id: Model.id("participant", "participant_g8_09"),
          discover: (input) =>
            Effect.succeed({
              revision: input.participantRevision + 1n,
              result: "success" as const,
              value: facts(
                loud
                  ? [
                      // Every shape §14.5 names, using CP-021's REAL constants so this row keeps
                      // guarding the same thing if CP-021 rewords its presentation.
                      { type: "participant_status", subject: GRANDCHILD, status: ASYNC_TASK_STATUS },
                      { type: "attached_count", subject: GRANDCHILD, count: 0 },
                      // Deliberately names the CONNECTOR edge, which the clean arm leaves UNCOVERED.
                      // An earlier draft repeated the already-covered leaf edge, and falsification
                      // showed that arm proved nothing: absorbing a duplicate into a Set is a no-op,
                      // so relaxing the edge key-set check left the differential green. Naming an
                      // uncovered edge means absorption would widen coverage and move claim/cancel.
                      { type: "participant_edge", subject: CHILD, owner: ROOT, status: ATTACHMENT_PROTOCOL_MARKER },
                      // A pair core NEVER handed in, so the driver's subset gate must drop it.
                      // Falsification showed that gate was otherwise unexercised: removing the
                      // `pending` match left this row green because every other fact here names an
                      // edge core had already proven.
                      { type: "participant_edge", subject: "ses_g8_09_unproven", owner: ROOT },
                      ATTACHMENT_PROTOCOL_TOKEN,
                    ]
                  : [],
              ),
            }),
          /**
           * DERIVED FROM CORE'S PAYLOAD, not fixed — and that is load-bearing rather than tidy.
           *
           * An earlier draft returned a constant reply naming only the leaf. Falsification exposed it:
           * relaxing the edge key-set check DID widen core's coverage set to the connector edge, but
           * the constant reply absorbed the widening before it could reach any fact, so the arm stayed
           * green while a real leak was occurring. A participant that answers what core actually asked
           * makes the widening observable, which is the whole point of the arm.
           */
          claim: (input) =>
            Effect.succeed({
              revision: input.participantRevision + 1n,
              result: "success" as const,
              value: fenceSubjectsOf(input.payload).map((subject) => ({
                type: "participant_claim",
                subject,
                claim: "held",
              })),
            }),
          cancel: (input) =>
            Effect.succeed({
              revision: input.participantRevision + 1n,
              result: "success" as const,
              value: cancelsOf(input.payload).map((item) => ({
                type: "participant_cancel",
                subject: item.subject,
                outcome: item.outcome,
              })),
            }),
          observe: (input) =>
            Effect.succeed({
              revision: input.participantRevision + 1n,
              result: "success" as const,
              value: loud
                ? [
                    // A DERIVED ZERO carrying a count, which is the one shape that would flip
                    // `yielded` if the exact key-set discipline were relaxed.
                    {
                      type: "state_at_fence",
                      subject: GRANDCHILD,
                      state: "yielded_with_outstanding_work",
                      count: 0,
                    },
                    { type: "attached_count", subject: GRANDCHILD, count: 0 },
                  ]
                : [],
            }),
        })

        /**
         * Identity is dropped and CONTENT is kept. Two independent runs mint different fact, edge and
         * operation identifiers, so comparing them raw would differ for reasons that have nothing to
         * do with presentation. Everything `FactInput` actually carries - subjects, owners, children,
         * terminal outcomes and `yielded` - is deterministic for a fixed fixture and survives.
         */
        const isIdentity = (name: string) =>
          name === "id" || name === "key" || name === "edge" || name === "operation" || name.endsWith("_operation_id")
        /**
         * Minted values are CANONICALLY RENAMED rather than deleted, which keeps more evidence than
         * dropping the fields would. `fact_key` EMBEDS a per-run operation UUID inside an otherwise
         * fully deterministic descriptor - subjects, part ids, edge ids and record kind - so deleting
         * the field would discard all of that. Renaming in order of first appearance neutralises the
         * arbitrary identity while preserving structure: a differing NUMBER or ARRANGEMENT of
         * operations or messages still shows up as a difference.
         *
         * Only genuinely minted prefixes are renamed. `ses_*`, `prt_*` and `edge_job_*` are supplied
         * by the fixture and are identical across arms by construction, so they must survive - if they
         * were renamed too, a real leak that changed a subject could hide behind the renaming.
         */
        const minted = /operation_[0-9a-f-]{36}|msg_[0-9a-zA-Z]{10,}/g
        const contentOf = (value: unknown) => {
          const seen = new Map<string, string>()
          return JSON.parse(
            JSON.stringify(value, (name, inner) => {
              if (isIdentity(name)) return undefined
              if (typeof inner === "bigint") return inner.toString()
              if (typeof inner !== "string") return inner
              return inner.replace(minted, (match) => {
                if (!seen.has(match)) seen.set(match, `<minted-${seen.size}>`)
                return seen.get(match) ?? match
              })
            }) ?? "null",
          )
        }

        const quietAsks = yield* Ref.make<readonly { readonly kind: string; readonly payload: unknown }[]>([])
        const loudAsks = yield* Ref.make<readonly { readonly kind: string; readonly payload: unknown }[]>([])
        const quiet = yield* driveG3([asking(participantFor(false), quietAsks)])
        const loud = yield* driveG3([asking(participantFor(true), loudAsks)])

        const outcomeOf = (
          result: typeof quiet,
          asks: readonly { readonly kind: string; readonly payload: unknown }[],
        ) =>
          contentOf({
            facts: result.probe.facts,
            signals: result.probe.signals,
            sweeps: result.probe.sweeps,
            toolPartCalls: result.probe.toolPartCalls,
            phase: result.probe.phase,
            proved: result.probe.proved,
            // EVERY record in every session rather than chosen indices, so the comparison cannot
            // miss one a leak happened to land in.
            records: [result.root, result.child, result.grandchild].map((messages) => messages.map(closurePart)),
            asks,
          })

        // THE INSTRUMENT'S OWN CONTROL. A projection that dropped too much would make "identical"
        // trivially true, which is this program's dominant failure mode. Assert the compared value is
        // substantive BEFORE comparing: real facts, real subjects, and the state-at-fence axis
        // present and false.
        const quietOutcome = outcomeOf(quiet, yield* Ref.get(quietAsks))
        const loudOutcome = outcomeOf(loud, yield* Ref.get(loudAsks))

        // THE INSTRUMENT'S OWN CONTROL, asserted BEFORE the comparison. A projection that dropped or
        // canonicalised too much would make "identical" trivially true, which is this program's
        // dominant failure mode. Each clause names something a gutted projection would lose.
        expect(quietOutcome.facts.length).toBeGreaterThan(0)
        expect(JSON.stringify(quietOutcome)).toContain(GRANDCHILD)
        expect(quietOutcome.facts.some((fact: { yielded?: boolean }) => fact.yielded === false)).toBe(true)
        expect(quietOutcome.proved).toBe(true)
        expect(JSON.stringify(quietOutcome)).toContain("terminal_outcome")
        expect(quietOutcome.asks.map((ask: { kind: string }) => ask.kind)).toEqual([
          "discover",
          "claim",
          "cancel",
          "observe",
        ])

        // THE DIFFERENTIAL. Nothing core constructed, recorded, signalled, proved, or ASKED may differ.
        expect(loudOutcome).toEqual(quietOutcome)

        // And state-at-fence specifically stayed false, so the derived zero was not absorbed.
        expect(JSON.stringify(loudOutcome)).not.toContain("yielded_with_outstanding_work")
        expect(JSON.stringify(loudOutcome)).not.toContain(ATTACHMENT_PROTOCOL_TOKEN)
      }),
  )

  it.live("G8-01: the REAL participant module, registered and covering nothing, changes no core outcome", () =>
    /**
     * Section 18's G8-01: "core closes a branch identically with the participant module absent."
     *
     * THE QUESTION IS PARITY, NOT ABSENCE. Every gate before this one ran with no participant at
     * all, so the flag-off half is established by every suite run and by the wiring row's flag-off
     * arm. The direction that asks something new is flag-ON: does registering a REAL participant
     * change core's behaviour on paths that do not involve it?
     *
     * IT USES THE REAL ADAPTER OVER AN INERT COORDINATOR, which is what makes it constructible at
     * all. `AttachmentCoordinator` allocates per-Instance state and the driver fixture creates and
     * provides its OWN Instance internally, while a `Ports.Participant` must be built before that
     * fixture runs and its methods carry no requirement channel - so a coordinator built out here
     * would answer from a registry the fixture never wrote to. `inertCoordinator()` needs no
     * Instance and answers `locate` with `undefined`, so the module under test is the genuine
     * production adapter while every subject is simply out of its scope. That is exactly G8-01's
     * "covers nothing" condition.
     *
     * ONLY `discover` AND `observe` ARE ISSUED, AND THAT IS THE SUBSET-SELECTION PROPERTY RATHER
     * THAN A GAP. A participant that reports no coverage leaves `covered` empty, and `claim` and
     * `cancel` are gated on it - so their absence here is core declining to ask about work nobody
     * claimed, which is the same property K2 asserts by making them lethal.
     *
     * SWEEPS ARE EXCLUDED FROM THE COMPARISON, and this is measured rather than assumed: the absent
     * arm settles in three sweeps and the registered arm in four. Every exchange invalidates the
     * proof that preceded it, so `observeStateAtFence` forces a re-proof whenever one ran - a
     * registered participant costs exactly one sweep BY DESIGN. G8-01 asserts that core's OUTCOME is
     * identical, not that its path length is; including sweeps would fail this row for the one
     * difference that is specified behaviour. Everything core constructed, signalled, read and
     * recorded is still compared.
     *
     * THE NON-VACUITY GUARD IS THE LOAD-BEARING PART. If the participant were silently unregistered
     * both arms would trivially agree. An earlier revision of this row had a malformed recorder that
     * made every exchange fail, and core then failed the operation terminally with zero facts - and
     * because the guard asserts the module was GENUINELY EXERCISED, that showed up as a red row
     * instead of a false "parity confirmed" against one healthy arm and one empty one. Keep it.
     */
    Effect.gen(function* () {
      const asked = yield* Ref.make<readonly string[]>([])
      const real = AttachmentParticipant.make(inertCoordinator())
      const watch =
        (method: (input: Ports.ParticipantCall) => Effect.Effect<Ports.ParticipantResult>) =>
        (input: Ports.ParticipantCall) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (current) => [...current, input.kind])
            return yield* method(input)
          })
      const registered: Ports.Participant = {
        id: real.id,
        discover: watch(real.discover),
        claim: watch(real.claim),
        cancel: watch(real.cancel),
        observe: watch(real.observe),
      }

      const absent = yield* driveG3([])
      const present = yield* driveG3([registered])

      // Local canonicaliser: the G8-09 row's is scoped to its own body. Identity keys are dropped
      // and minted values renamed in first-appearance order, so a differing NUMBER or ARRANGEMENT
      // still shows as a difference while a per-run UUID does not.
      const identity = new Set(["id", "key", "edge", "operation"])
      const minted = /operation_[0-9a-f-]{36}|msg_[0-9a-zA-Z]{10,}/g
      const contentOf = (value: unknown) => {
        const seen = new Map<string, string>()
        return JSON.parse(
          JSON.stringify(value, (name, inner) => {
            if (identity.has(name) || name.endsWith("operation_id")) return undefined
            if (typeof inner === "bigint") return inner.toString()
            if (typeof inner !== "string") return inner
            return inner.replace(minted, (match) => {
              if (!seen.has(match)) seen.set(match, `<minted-${seen.size}>`)
              return seen.get(match) ?? match
            })
          }) ?? "null",
        )
      }

      const outcomeOf = (result: typeof absent) =>
        contentOf({
          facts: result.probe.facts,
          signals: result.probe.signals,
          toolPartCalls: result.probe.toolPartCalls,
          phase: result.probe.phase,
          proved: result.probe.proved,
          records: [result.root, result.child, result.grandchild].map((messages) => messages.map(closurePart)),
        })

      const absentOutcome = outcomeOf(absent)
      const presentOutcome = outcomeOf(present)

      // THE PROJECTION'S OWN CONTROL, asserted BEFORE the comparison. A projection that dropped too
      // much would make "identical" trivially true, which is this program's dominant failure mode.
      expect(absentOutcome.facts.length).toBeGreaterThan(0)
      expect(absentOutcome.proved).toBe(true)
      expect(JSON.stringify(absentOutcome)).toContain(GRANDCHILD)
      expect(JSON.stringify(absentOutcome)).toContain("terminal_outcome")

      // THE NON-VACUITY GUARD. The module was genuinely exercised, under its real production id.
      expect(registered.id).toBe(AttachmentParticipant.ID)
      expect(yield* Ref.get(asked)).toEqual(["discover", "observe"])

      // The registered arm really did take a different PATH, which is what makes excluding sweeps a
      // stated exclusion rather than a silent one.
      expect(present.probe.sweeps).toBeGreaterThan(absent.probe.sweeps)

      // THE PARITY ASSERTION. Nothing core constructed, signalled, read, proved or recorded differs.
      expect(presentOutcome).toEqual(absentOutcome)
    }),
  )

  it.live("§8.3: the lifetime token cannot reach `describe` or record projection — a COMPILE-TIME guard", () =>
    Effect.sync(() => {
      /**
       * §8.3 forbids recording or exposing the lifetime token publicly, while §14.2 step 7 requires
       * the participant to return it — no conflict, but the boundary has to be PINNED because the
       * evidence it rides on flows toward records.
       *
       * WHY THIS IS A TYPE-LEVEL GUARD AND NOT A RUNTIME PROBE. Gate 7's transferable rule is that at
       * an authority boundary a fix making the bad thing DETECTABLE gets evaded by a form the
       * detector did not anticipate, while one making it UNREPRESENTABLE does not. A runtime probe
       * would also be VACUOUS here: the driver fixtures build evidence by hand and mint no lifetimes,
       * so nothing would exist to leak and the row would pass by construction — the exact shape of
       * "an A/B control that had stopped controlling" this program has already hit.
       *
       * THE NARROWEST WAIST IS THE EVIDENCE TYPE. `discovery.ts` deliberately refuses to propagate
       * `entry.lifetime` as data, capturing it ONLY inside the interrupt capability's closure, and
       * `describe` consumes nothing but this evidence, the accumulated coordinates and outcomes. So
       * if `JobEvidence`/`RunnerEvidence` cannot CARRY a lifetime, `describe` and every record
       * projection downstream cannot RECEIVE one — the property holds structurally rather than by
       * anyone remembering it. Widening either type is the necessary first step of every leak path,
       * and it is exactly what fails to compile here.
       *
       * The token is unnameable for a reason worth restating: it is an OBJECT, and
       * `physical-interrupt.ts` keys on it with `Key = SessionID | object` precisely so it cannot be
       * forged. `binder.ts` mints the only string form into a `WeakMap` because keying on the public
       * id would be ABA-unsafe. An identity designed to be unforgeable is thereby designed to be
       * non-transmissible.
       */
      type CarriesLifetime<T> = "lifetime" extends keyof T ? true : false
      const jobEvidence: CarriesLifetime<Ports.JobEvidence> = false
      const runnerEvidence: CarriesLifetime<Ports.RunnerEvidence> = false
      expect([jobEvidence, runnerEvidence]).toEqual([false, false])
    }),
  )

  it.live(
    "K2: one fake-participant proof renders exact state-at-fence truth without contaminating other subjects",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<readonly Ports.ParticipantCall[]>([])
        const unavailable = () =>
          Effect.die("K2's fake reports no coverage, so claim and cancel must never be issued for it")
        const participant: Ports.Participant = {
          id: Model.id("participant", "participant_g3_state_at_fence"),
          /**
           * §14.2's `discover` is issued for every proven edge as of Gate 8, so this can no longer
           * be lethal — but reporting NO coverage keeps `claim` and `cancel` unreachable, and their
           * unreachability stays an ASSERTION rather than an assumption because both still die.
           */
          discover: (input) =>
            Ref.update(calls, (current) => [...current, input]).pipe(
              Effect.as({ revision: input.participantRevision + 1n, result: "success" as const, value: [] }),
            ),
          claim: unavailable,
          cancel: unavailable,
          observe: (input) =>
            Ref.update(calls, (current) => [...current, input]).pipe(
              Effect.as({
                revision: input.participantRevision + 1n,
                result: "success" as const,
                // One opaque proved fact. No attached count, status, text, trace, or local state leaks.
                value: [
                  {
                    type: "state_at_fence",
                    subject: GRANDCHILD,
                    state: "yielded_with_outstanding_work",
                  },
                ],
              }),
            ),
        }
        const result = yield* driveG3([participant])
        const generation = result.probe.generation
        if (!generation) return yield* Effect.die("K2 participant fixture did not freeze a generation")

        // The cheap reachability instrument: the real driver issued exactly one observe through the
        // real coordinator, over both proven child subjects. A plumbed-but-unread participant would
        // leave this empty; a per-sweep call would exceed one and never converge.
        const observed = yield* Ref.get(calls)
        // §14.2's `discover` shares this ref as of Gate 8, so each exchange KIND is counted
        // separately. That the discover count is also exactly one is the dedup proof: the sweep loop
        // re-derives evidence every pass and re-proves after the observe, so an undeduped exchange
        // would appear once per sweep and exhaust SWEEP_LIMIT instead of converging.
        const observes = observed.filter((item) => item.kind === "observe")
        const discovers = observed.filter((item) => item.kind === "discover")
        expect(observes).toHaveLength(1)
        expect(discovers).toHaveLength(1)
        // The observe sees the revision the discover advanced, which makes the exchange SEQUENCE
        // observable rather than merely ordered: a discover that never ran would leave this 0n.
        expect(observes[0]?.participantRevision).toBe(1n)
        const observedFences = (observes[0]?.payload as { readonly fences?: readonly Ports.ParticipantFenceInput[] })
          .fences
        expect(observedFences?.map((item) => item.subject)).toEqual([
          Model.id("session", CHILD),
          Model.id("session", GRANDCHILD),
        ])
        expect(observedFences?.every((item) => Object.isFrozen(item.ref) && Object.keys(item.ref).length === 0)).toBe(
          true,
        )
        // `discover`'s payload is core's ALREADY-PROVEN edge set, which is what makes a reply a
        // subset selection rather than a widening: the participant can only mark what core handed it.
        expect(discovers[0]?.payload).toEqual({
          edges: [
            { owner: Model.id("session", ROOT), child: Model.id("session", CHILD) },
            { owner: Model.id("session", CHILD), child: Model.id("session", GRANDCHILD) },
          ],
        })
        expect(result.probe.phase).toBe("released_pending_delivery")
        expect(generation.records).toHaveLength(5)
        expect(shapes(result.probe)).toEqual(
          [
            `edge ${ROOT}->${CHILD} subject=${CHILD} outcome=cancelled yielded=false part=prt_g3_child`,
            `self ${CHILD} outcome=cancelled yielded=false`,
            `edge ${CHILD}->${GRANDCHILD} subject=${GRANDCHILD} outcome=completed yielded=true part=prt_g3_grandchild`,
            `self ${GRANDCHILD} outcome=completed yielded=true`,
            `root ${ROOT} direct=-`,
          ].toSorted(),
        )

        // Ordinary resumed transcripts, not frozen writer returns. Cardinalities make order and
        // selectivity real: the yielding leaf has one record while both non-yielding owners have two.
        expect(result.grandchild).toHaveLength(1)
        expect(result.child).toHaveLength(2)
        expect(result.root).toHaveLength(2)
        const leaf = closurePart(result.grandchild[0])
        const childEdge = closurePart(result.child[0])
        const childSelf = closurePart(result.child[1])
        const ancestorEdge = closurePart(result.root[0])
        const root = closurePart(result.root[1])
        if (!leaf || !childEdge || !childSelf || !ancestorEdge || !root)
          return yield* Effect.die("K2 ordinary transcript omitted a closure TextPart")
        const leafFrozen = generation.records.find(
          (item) => item.fact.type === "self" && item.fact.subject === Model.id("session", GRANDCHILD),
        )
        const edgeFrozen = generation.records.find(
          (item) =>
            item.fact.type === "edge" &&
            item.fact.owner === Model.id("session", CHILD) &&
            item.fact.child === Model.id("session", GRANDCHILD),
        )
        if (!leafFrozen || !edgeFrozen) return yield* Effect.die("K2 generation omitted the proved subject facts")

        // §10.1 independence on a NON-cancelled winner: completion and yielded state coexist, and the
        // mandated state sentence precedes rather than replaces the terminal sentence.
        expect(leaf.metadata).toEqual({
          version: 1,
          freeze_owner_operation_id: generation.freezeOwner,
          generation: generation.generation,
          fact_key: leafFrozen.fact.key,
          identity_source: "session_identity",
          record_kind: "self",
          subject_session_id: Model.id("session", GRANDCHILD),
          terminal_outcome: "completed",
          state_at_fence: "yielded_with_outstanding_work",
        })
        expect(childEdge.metadata).toEqual({
          version: 1,
          freeze_owner_operation_id: generation.freezeOwner,
          generation: generation.generation,
          fact_key: edgeFrozen.fact.key,
          identity_source: "session_identity",
          record_kind: "edge",
          subject_session_id: Model.id("session", GRANDCHILD),
          owner_session_id: Model.id("session", CHILD),
          child_session_id: Model.id("session", GRANDCHILD),
          task_part_id: Model.id("part", "prt_g3_grandchild"),
          terminal_outcome: "completed",
          state_at_fence: "yielded_with_outstanding_work",
        })
        expect(leaf.part.text).toBe(
          "[Branch closure] This Session's prior Task execution: The Task had yielded with attached work outstanding at the fence. The tracked execution completed before cancellation took effect.",
        )
        expect(childEdge.part.text).toBe(
          `[Branch closure] Child Session ${GRANDCHILD}: The Task had yielded with attached work outstanding at the fence. The tracked execution completed before cancellation took effect. Owner Session: ${CHILD}.`,
        )

        // Per-subject selectivity in the SAME run. The participant named only GRANDCHILD, so CHILD's
        // self/edge truth and the requested root remain exact non-yielding records.
        expect(childSelf.metadata).toMatchObject({ record_kind: "self", terminal_outcome: "cancelled" })
        expect(ancestorEdge.metadata).toMatchObject({ record_kind: "edge", terminal_outcome: "cancelled" })
        expect(root.metadata).toMatchObject({ record_kind: "root", branch_outcome: "quiesced" })
        for (const item of [childSelf, ancestorEdge, root]) {
          expect(Object.hasOwn(item.metadata, "state_at_fence")).toBe(false)
          expect(item.part.text.includes("yielded with attached work")).toBe(false)
        }
        expect(
          [leaf, childEdge, childSelf, ancestorEdge, root].filter((item) =>
            Object.hasOwn(item.metadata, "state_at_fence"),
          ),
        ).toHaveLength(2)
      }),
  )

  it.live("K2 negative: a participant with no proved contribution invents no state-at-fence field or sentence", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<readonly Ports.ParticipantCall[]>([])
      const unavailable = () =>
        Effect.die("K2's empty fake reports no coverage, so claim and cancel must never be issued for it")
      const participant: Ports.Participant = {
        id: Model.id("participant", "participant_g3_no_state_at_fence"),
        /** §14.2's `discover`, reporting NO coverage — which keeps `claim`/`cancel` unreachable. */
        discover: (input) =>
          Ref.update(calls, (current) => [...current, input]).pipe(
            Effect.as({ revision: input.participantRevision + 1n, result: "success" as const, value: [] }),
          ),
        claim: unavailable,
        cancel: unavailable,
        observe: (input) =>
          Ref.update(calls, (current) => [...current, input]).pipe(
            // A successful authoritative observation with no state fact. No count or proxy crosses.
            Effect.as({ revision: input.participantRevision + 1n, result: "success" as const }),
          ),
      }
      const result = yield* driveG3([participant])
      const generation = result.probe.generation
      if (!generation) return yield* Effect.die("K2 empty-contribution fixture did not freeze a generation")

      // Positive preconditions before every absence: the yield channel really ran and its successful
      // empty observation was accepted before a complete five-record branch published. This is not
      // the old structural no-participant case; a default at the contribution boundary can now fail.
      const observed = yield* Ref.get(calls)
      const observes = observed.filter((item) => item.kind === "observe")
      const discovers = observed.filter((item) => item.kind === "discover")
      expect(observes).toHaveLength(1)
      // Deduped: one discover across every sweep, not one per sweep. See the positive K2 case.
      expect(discovers).toHaveLength(1)
      const observedFences = (observes[0]?.payload as { readonly fences?: readonly Ports.ParticipantFenceInput[] })
        .fences
      expect(observedFences?.map((item) => item.subject)).toEqual([
        Model.id("session", CHILD),
        Model.id("session", GRANDCHILD),
      ])
      expect(result.probe.phase).toBe("released_pending_delivery")
      expect(generation.records).toHaveLength(5)
      // TWO exchanges now advance it: `discover` (0n -> 1n) then `observe` (1n -> 2n). The count is
      // the point — a revision of 1n here would mean one of the two exchanges never reached core.
      expect(operation(result.probe).participants).toEqual([{ id: participant.id, revision: 2n }])
      expect(result.grandchild).toHaveLength(1)
      expect(result.child).toHaveLength(2)
      expect(result.root).toHaveLength(2)
      const facts = result.probe.facts.filter(
        (item): item is Extract<Model.FactView, { readonly type: "self" | "edge" }> =>
          item.type === "self" || item.type === "edge",
      )
      expect(facts).toHaveLength(4)
      expect(facts.every((item) => item.yielded === false)).toBe(true)

      const records = [...result.grandchild, ...result.child, ...result.root].map(closurePart)
      expect(records).toHaveLength(5)
      expect(records.every((item) => item !== undefined)).toBe(true)
      for (const item of records) {
        if (!item) return yield* Effect.die("K2 empty-contribution transcript omitted a closure TextPart")
        if (item.metadata.record_kind === "root") expect(item.metadata.branch_outcome).toBe("quiesced")
        else expect(item.metadata.terminal_outcome).toBeDefined()
        // `hasOwn` distinguishes omission from an own key whose value is undefined/null/false.
        expect(Object.hasOwn(item.metadata, "state_at_fence")).toBe(false)
        expect(item.part.text.includes("yielded with attached work")).toBe(false)
      }
    }),
  )

  it.live("the real CP-021 participant claims and cancels its exact scope without inventing a fence fact", () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const real = AttachmentParticipant.make(coordinator)
      const calls = yield* Ref.make<readonly Ports.ParticipantCall[]>([])
      const order = yield* Ref.make<readonly string[]>([])
      const scope = yield* Ref.make<AttachmentCoordinator.Scope | undefined>(undefined)
      const interrupt = yield* Ref.make<Effect.Effect<void> | undefined>(undefined)
      const atSignal = yield* Ref.make<AttachmentContract.Current | undefined>(undefined)
      const captured = yield* Ref.make<Ports.ParticipantFenceRef | undefined>(undefined)
      const claimed = yield* Ref.make(false)
      const closed = yield* Ref.make(false)
      const waiting = yield* Deferred.make<void>()
      const track = (input: Ports.ParticipantCall, run: Effect.Effect<Ports.ParticipantResult>) =>
        Ref.update(calls, (current) => [...current, input]).pipe(Effect.andThen(run))
      const participant: Ports.Participant = {
        id: real.id,
        discover: (input) => track(input, real.discover(input)),
        claim: (input) =>
          Effect.gen(function* () {
            const fences = (input.payload as { readonly fences?: readonly { subject: string; ref: unknown }[] }).fences
            const fence = fences?.find((item) => item.subject === CHILD)
            if (fence && typeof fence.ref === "object" && fence.ref !== null) {
              yield* Ref.set(captured, fence.ref as Ports.ParticipantFenceRef)
            }
            const result = yield* track(input, real.claim(input))
            yield* Ref.update(order, (current) => [...current, "participant-claim-complete"])
            return result
          }),
        cancel: (input) => track(input, real.cancel(input)),
        observe: (input) => track(input, real.observe(input)),
      }

      const result = yield* driveG3([participant], {
        beforeRequest: () =>
          Effect.gen(function* () {
            // B is the attachment scope; C is still active in its accepted job when B ends a clean
            // turn. The response is a real retained candidate, but cannot return while C remains.
            const current = yield* coordinator.open(SessionID.make(CHILD)).pipe(Effect.orDie)
            const reservation = yield* current.reserve(SessionID.make(GRANDCHILD))
            expect((yield* current.claimObserver(reservation)).type).toBe("owner")
            const messageID = MessageID.ascending()
            const response: SessionV1.WithParts = {
              info: {
                id: messageID,
                role: "assistant",
                parentID: MessageID.ascending(),
                sessionID: current.sessionID,
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
                  sessionID: current.sessionID,
                  type: "text",
                  text: "withheld B response",
                },
              ],
            }
            yield* current.observeTurn({ assistant: response, clean: true })
            expect(current.current()).toMatchObject({ everAttached: true, candidate: true, cancelled: false })
            yield* Ref.set(scope, current)
            // A real caller is now blocked in the same `Scope.result()` wait used by TaskTool. The
            // shared production finalizer makes drift between this topology proof and Task teardown
            // impossible without changing both call sites.
            const task = yield* Effect.forkChild(
              Effect.acquireUseRelease(
                Effect.succeed(current),
                (invocation) => Deferred.succeed(waiting, undefined).pipe(Effect.andThen(invocation.result(response))),
                (invocation, exit) => AttachmentCoordinator.finalizeScope(invocation, exit),
              ),
            )
            yield* Ref.set(interrupt, Fiber.interrupt(task).pipe(Effect.asVoid))
            yield* Deferred.await(waiting)
            // The fiber reached the real result gate while C is still attached. The positive state
            // assertion above proves that gate has no success or failure resolution available.
            expect(yield* Ref.get(interrupt)).toBeDefined()
          }),
        onSignal: (target) => {
          if (target !== "job:job_g3_connector") return Effect.void
          return Effect.gen(function* () {
            const current = yield* Ref.get(scope)
            if (!current) return
            // Positive precondition at the physical boundary: the REAL participant captured the
            // exact local lifetime but left B live for core-owned physical signalling.
            yield* Ref.set(atSignal, current.current())
            const ref = yield* Ref.get(captured)
            yield* Ref.set(claimed, ref !== undefined && !current.current().cancelled && current.current().candidate)
            yield* Ref.update(order, (events) => [...events, "physical-signal"])
            const stop = yield* Ref.get(interrupt)
            if (!stop) return
            yield* stop
            yield* Ref.set(closed, (yield* coordinator.locate(SessionID.make(CHILD))) === undefined)
          })
        },
        activeConnector: true,
      })

      const generation = result.probe.generation
      if (!generation)
        return yield* Effect.die(
          `K3 real participant did not freeze a generation: ${JSON.stringify({
            phase: result.probe.phase,
            failure: result.probe.failureKind,
            signals: result.probe.signals,
            sweeps: result.probe.sweeps,
          })}`,
        )
      const observed = yield* Ref.get(calls)
      expect(yield* Ref.get(claimed)).toBe(true)
      expect(yield* Ref.get(closed)).toBe(true)
      expect(yield* Ref.get(atSignal)).toMatchObject({
        everAttached: true,
        candidate: true,
        cancelled: false,
      })
      expect(observed.map((item) => item.kind)).toContain("claim")
      expect(observed.map((item) => item.kind)).toContain("observe")
      expect(yield* Ref.get(order)).toEqual(["participant-claim-complete", "physical-signal"])
      expect(result.probe.signals).toContain("job:job_g3_connector")
      expect(result.probe.signals).toContain("job:job_g3_leaf")

      const records = [...result.grandchild, ...result.child, ...result.root]
        .map(closurePart)
        .filter((item) => item !== undefined)
      const child = records.filter((item) => item.metadata.subject_session_id === Model.id("session", CHILD))
      expect(child).toHaveLength(2)
      expect(child.every((item) => item.metadata.terminal_outcome === "cancelled")).toBe(true)
      expect(child.every((item) => !Object.hasOwn(item.metadata, "state_at_fence"))).toBe(true)
      expect(child.every((item) => !item.part.text.includes("yielded with attached work outstanding"))).toBe(true)

      // Per-subject negative in the same real run: C was the active physical leaf. Core records C's
      // independent completed winner without inventing the retired attachment fence observation.
      const leaf = records.find(
        (item) => item.metadata.record_kind === "self" && item.metadata.subject_session_id === GRANDCHILD,
      )
      expect(leaf?.metadata.terminal_outcome).toBe("completed")
      expect(leaf && Object.hasOwn(leaf.metadata, "state_at_fence")).toBe(false)
      expect(leaf?.part.text.includes("yielded with attached work")).toBe(false)
    }),
  )

  // K53's Gate-5 clause composes here rather than in a fixture of its own, and the composition is
  // recorded so a later reader does not mistake it for an unevidenced row. Destructive admission
  // rejects on fence PRESENCE, never on operation phase — that is K52's seam, discharged at Gate 3
  // across the seven mutation classes at the authoritative lower/wrapper service. So "the same
  // destructive calls during `record_failed` reject until exact repair/release" follows once the
  // fence provably survives record failure, which is exactly what this row asserts physically and
  // I-20's model row asserts byte-exactly. K53's second clause — a post-epoch retry acquiring a
  // fresh lease — was credited to K108 at Gate 3. No fixture restates the rejection against a
  // `record_failed` operation, and none needs to.
  it.live("§8.9 step 8: a failed physical postflight retains record_failed and every fence", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const core = yield* SessionProjector.ClosureRecordService
      const verifications = yield* Ref.make(0)
      yield* prepareRecordSessions("/closure-g-postflight-failure")
      const wrapped = SessionProjector.ClosureRecordService.of({
        message: core.message,
        part: core.part,
        verify: () =>
          Ref.update(verifications, (count) => count + 1).pipe(
            Effect.andThen(Effect.fail(new Error("injected whole-generation postflight failure"))),
          ),
      })
      const record = yield* recordCapability(wrapped)
      const probe = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        highWater: [],
        recordCapability: record,
      })
      const current = operation(probe)
      const generation = probe.generation
      if (!current || !generation) return yield* Effect.die("postflight fixture never froze its generation")

      // Positive preconditions: all physical writes reached verified returns and the whole-generation
      // verifier was invoked exactly once. A failure reached before either boundary would not test
      // release postflight.
      expect(probe.pairWrites).toHaveLength(3)
      expect(probe.pairReturns.map((item) => [item.message, item.part])).toEqual([
        ["verified", "verified"],
        ["verified", "verified"],
        ["verified", "verified"],
      ])
      expect(generation.committedPrefix).toBe(generation.facts.length)
      expect(generation.verified).toEqual(generation.facts)
      expect(yield* Ref.get(verifications)).toBe(1)
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(3)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(3)

      // A failed readback/order/root-coverage check is a retained post-freeze record failure. It may
      // neither release a fence nor advance an epoch merely because every PairPermit returned.
      expect(probe.failureKind).toBe("record_failed")
      expect(probe.phase).toBe("record_failed")
      expect(current.failure?.kind).toBe("record_failed")
      expect(fenced(probe)).toEqual(claims(probe))
      expect(probe.view.fences.length).toBeGreaterThan(0)
      expect(probe.view.epochs.every((item) => item.epoch === 0n)).toBe(true)
    }).pipe(Effect.provide(Layer.fresh(recordCoreLayer()))),
  )

  it.live("K36/K37/K55/K70/K83/K85: release atomically drops a standing fence and wakes one parked retry", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const real = yield* SessionClosureRecord.Service
      const liveClock = yield* Clock.Clock
      const scope = yield* Effect.scope
      const closure = yield* Ref.make<SessionClosure.Interface | undefined>(undefined)
      const precommit = yield* Ref.make<Model.View | undefined>(undefined)
      const parked = yield* Ref.make<Model.View | undefined>(undefined)
      const actor = yield* Ref.make<Fiber.Fiber<void, unknown> | undefined>(undefined)
      const installed = yield* Ref.make(false)
      const ran = yield* Ref.make(0)
      const completed = yield* Deferred.make<void>()
      const directory = "/closure-g-release"
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      for (const id of [ROOT, CHILD]) {
        yield* db
          .insert(SessionTable)
          .values({
            id: SessionID.make(id),
            project_id: Project.ID.global,
            slug: `release-${id}`,
            directory,
            title: `release-${id}`,
            version: "test",
            time_created: 10,
            time_updated: 20,
          })
          .run()
          .pipe(Effect.orDie)
      }

      const record: Ports.RecordCapability = {
        write: real.write,
        verify: (input) =>
          Ref.get(closure).pipe(
            Effect.flatMap((service) =>
              service
                ? service.view.pipe(
                    Effect.orDie,
                    Effect.flatMap((view) => Ref.set(precommit, view)),
                  )
                : Effect.die("release fixture lost its coordinator"),
            ),
            Effect.andThen(real.verify(input)),
          ),
      }
      const probe = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        highWater: [],
        clockMillis: 12_000,
        recordCapability: record,
        beforeRequest: (service) => Ref.set(closure, service),
        afterCommand: (command) => {
          if (command.command.type !== "pair.write") return Effect.void
          return Effect.gen(function* () {
            const first = yield* Ref.modify(installed, (current) => [!current, true] as const)
            if (!first) return
            const service = yield* Ref.get(closure)
            if (!service) return yield* Effect.die("release fixture has no coordinator")

            // Positive precondition: publication has begun under a fence that still stands for the
            // exact target. The retry below cannot be credited to release if this state never existed.
            const standing = yield* service.view.pipe(Effect.orDie)
            expect(standing.fences.length).toBeGreaterThan(0)
            expect(standing.fences.some((fence) => String(fence.session) === ROOT)).toBe(true)
            expect(standing.operations[0]?.phase.type).toBe("recording")

            const waiting = yield* SessionAdmission.admitted(
              service,
              { session: SessionID.make(ROOT), origin: "external", source: "test.g.release" },
              () =>
                Ref.update(ran, (count) => count + 1).pipe(
                  Effect.andThen(Deferred.succeed(completed, undefined)),
                  Effect.asVoid,
                ),
            ).pipe(Effect.orDie, Effect.forkIn(scope, { startImmediately: true }))
            yield* Ref.set(actor, waiting)

            const adopted = yield* pollWithTimeout(
              service.view.pipe(
                Effect.map((view) =>
                  view.leases.find(
                    (lease) => lease.source === "test.g.release" && lease.state === "reserved" && lease.operation,
                  ),
                ),
              ),
              "release fixture never joined the standing fence",
            ).pipe(Effect.provideService(Clock.Clock, liveClock), Effect.orDie)
            yield* Ref.set(parked, yield* service.view.pipe(Effect.orDie))
            expect(adopted.acquisition).toBe("post_fence")
            expect(adopted.operation).toBeDefined()

            // Positive precondition for the wake: the model records this exact external attempt as
            // post-fence, reserved, and owned by the operation. `SessionAdmission.admitted` can reach
            // that state only through its `joined` branch, whose next instruction is `await release`;
            // both body observables remain incomplete at that boundary. This proves the wait without
            // racing a timed `Fiber.join`, whose losing timeout can interrupt the very actor it is
            // meant only to observe.
            expect(yield* Deferred.isDone(completed)).toBe(false)
            expect(yield* Ref.get(ran)).toBe(0)
          })
        },
      })

      const observedPrecommit = yield* Ref.get(precommit)
      const observedParked = yield* Ref.get(parked)
      yield* Deferred.await(completed).pipe(
        Effect.timeoutOrElse({
          duration: "500 millis",
          orElse: () =>
            Effect.die(
              new Error(
                `release waiter did not complete: phase=${probe.phase} failure=${probe.failureKind} pairs=${probe.pairWrites.length}/${probe.pairReturns.length} prefix=${probe.generation?.committedPrefix}/${probe.generation?.facts.length} generationFailure=${probe.generation?.failure} fences=${probe.view.fences.length} epochs=${probe.view.epochs.map((item) => `${item.session}:${item.epoch}`).join(",")} precommit=${observedPrecommit?.operations[0]?.phase.type} acquisition=${observedParked?.leases.find((item) => item.source === "test.g.release")?.acquisition}`,
              ),
            ),
        }),
      )
      const waiting = yield* Ref.get(actor)
      if (!waiting) return yield* Effect.die("release fixture never installed its waiter")
      yield* Fiber.join(waiting)

      const before = yield* Ref.get(precommit)
      const joined = yield* Ref.get(parked)
      const operation = probe.view.operations[0]
      if (!before || !joined || !operation) return yield* Effect.die("release fixture missed a boundary view")

      // The read-only postflight sees the whole negative state together: all root views pending,
      // original epochs, and every relevant fence still installed.
      expect(before.operations[0]?.phase.type).toBe("recording")
      expect(before.operations[0]?.views.every((view) => view.result === "pending")).toBe(true)
      expect(before.fences.length).toBeGreaterThan(0)
      expect(before.epochs.every((epoch) => epoch.epoch === 0n)).toBe(true)
      expect(joined.leases.some((lease) => lease.source === "test.g.release" && lease.state === "reserved")).toBe(true)

      // One subsequent observable state carries every completion field. `Control.transition` reduces
      // `release.commit` and stores this model under one semaphore acquisition; no hook or driver call
      // can observe a partial view between these assertions.
      expect(probe.phase).toBe("released_pending_delivery")
      expect(operation.views.every((view) => view.result === "success")).toBe(true)
      expect(probe.view.fences).toEqual([])
      expect(names(operation.claims)).toEqual([CHILD, ROOT].toSorted())
      expect(
        operation.claims.map((session) => probe.view.epochs.find((epoch) => epoch.session === session)?.epoch),
      ).toEqual([1n, 1n])

      // The release flush ran after the lock: the same joined admission retried, ran once, and did
      // not create a second closure operation or execute before the fence disappeared.
      expect(yield* Ref.get(ran)).toBe(1)
      expect(probe.failureKind).toBeUndefined()
    }).pipe(Effect.provide(recordLayer())),
  )

  for (const collision of collisions) {
    it.live(
      `${collision.key}: a ${collision.coordinate}-coordinate ${collision.row} row raced after clean preflight is preserved as record_failed`,
      () =>
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const core = yield* SessionProjector.ClosureRecordService
          const preflights = yield* Ref.make(0)
          const injected = yield* Ref.make(false)
          const competitor = yield* Ref.make<
            typeof MessageTable.$inferSelect | typeof PartTable.$inferSelect | undefined
          >(undefined)
          yield* prepareRecordSessions(
            `/closure-${collision.key.toLowerCase()}-${collision.row}-${collision.coordinate}`,
          )

          const first = Ref.modify(injected, (current) => [!current, true] as const)
          const wrapped = SessionProjector.ClosureRecordService.of({
            message: (input) => {
              if (collision.row !== "message") return core.message(input)
              return Effect.gen(function* () {
                if (!(yield* first)) return yield* core.message(input)
                const before = yield* db
                  .select()
                  .from(MessageTable)
                  .where(eq(MessageTable.id, input.info.id))
                  .get()
                  .pipe(Effect.orDie)
                expect(before).toBeUndefined()
                yield* Ref.update(preflights, (count) => count + 1)
                const { id: _, sessionID: __, ...data } = input.info
                yield* db
                  .insert(MessageTable)
                  .values({
                    id: input.info.id,
                    session_id: collision.coordinate === "foreign" ? SessionID.make(STRANGER) : input.info.sessionID,
                    time_created: input.info.time.created + 500,
                    time_updated: input.info.time.created + 501,
                    data: { ...data, agent: `competitor-${collision.coordinate}` },
                  })
                  .run()
                  .pipe(Effect.orDie)
                yield* Ref.set(
                  competitor,
                  yield* db
                    .select()
                    .from(MessageTable)
                    .where(eq(MessageTable.id, input.info.id))
                    .get()
                    .pipe(Effect.orDie),
                )
                return yield* core.message(input)
              })
            },
            part: (input) => {
              if (collision.row !== "part") return core.part(input)
              return Effect.gen(function* () {
                if (!(yield* first)) return yield* core.part(input)
                const before = yield* db
                  .select()
                  .from(PartTable)
                  .where(eq(PartTable.id, input.part.id))
                  .get()
                  .pipe(Effect.orDie)
                expect(before).toBeUndefined()
                yield* Ref.update(preflights, (count) => count + 1)
                const foreignMessage = MessageID.make(`msg_${collision.key.toLowerCase()}_foreign_owner`)
                if (collision.coordinate === "foreign") {
                  const owner = yield* db
                    .select()
                    .from(MessageTable)
                    .where(eq(MessageTable.id, input.part.messageID))
                    .get()
                    .pipe(Effect.orDie)
                  if (!owner) return yield* Effect.die("expected the committed Message before Part collision")
                  yield* db
                    .insert(MessageTable)
                    .values({
                      ...owner,
                      id: foreignMessage,
                      session_id: SessionID.make(STRANGER),
                      data: { ...owner.data, agent: "foreign-owner" },
                    })
                    .run()
                    .pipe(Effect.orDie)
                }
                const { id: _, messageID: __, sessionID: ___, ...data } = input.part
                yield* db
                  .insert(PartTable)
                  .values({
                    id: input.part.id,
                    message_id: collision.coordinate === "foreign" ? foreignMessage : input.part.messageID,
                    session_id: collision.coordinate === "foreign" ? SessionID.make(STRANGER) : input.part.sessionID,
                    time_created: input.time + 500,
                    time_updated: input.time + 501,
                    data: { ...data, text: `competitor-${collision.coordinate}` } as typeof PartTable.$inferInsert.data,
                  })
                  .run()
                  .pipe(Effect.orDie)
                yield* Ref.set(
                  competitor,
                  yield* db.select().from(PartTable).where(eq(PartTable.id, input.part.id)).get().pipe(Effect.orDie),
                )
                return yield* core.part(input)
              })
            },
            verify: core.verify,
          })
          const record = yield* recordCapability(wrapped)
          const probe = yield* drive({
            root: ROOT,
            frames: IDENTITY_WORLD,
            planIdentity: IDENTITY,
            highWater: [],
            clockMillis: 9_000,
            recordCapability: record,
          })
          const current = operation(probe)
          const generation = probe.generation
          const frozen = generation?.records[0]
          const returned = probe.pairReturns[0]
          if (!current || !generation || !frozen || !returned)
            return yield* Effect.die("expected one retained collision pair")

          // The diagnostic read was genuinely clean, then the test inserted a competitor before the
          // exact capability transaction. A clean preflight therefore cannot stand in for reservation.
          expect(yield* Ref.get(preflights)).toBe(1)
          expect(yield* Ref.get(injected)).toBe(true)
          expect(probe.pairWrites).toHaveLength(1)
          expect(probe.pairReturns).toHaveLength(1)
          expect(returned.message).toBe(collision.row === "message" ? "failed" : "verified")
          expect(returned.part).toBe(collision.row === "message" ? "absent" : "failed")

          // The failed immediate transaction inserted neither the contested event nor a replacement
          // row. For Part collision only, the earlier Message half remains the legitimate prefix.
          const contestedID = collision.row === "message" ? frozen.message : frozen.part
          const retained = yield* Ref.get(competitor)
          const stored =
            collision.row === "message"
              ? yield* db
                  .select()
                  .from(MessageTable)
                  .where(eq(MessageTable.id, MessageID.make(String(contestedID))))
                  .get()
                  .pipe(Effect.orDie)
              : yield* db
                  .select()
                  .from(PartTable)
                  .where(eq(PartTable.id, PartID.make(String(contestedID))))
                  .get()
                  .pipe(Effect.orDie)
          expect(stored).toEqual(retained)
          expect(stored?.time_created).toBe(
            collision.row === "message" ? frozen.messageTime + 500 : frozen.partTime + 500,
          )
          expect(stored?.time_updated).toBe(
            collision.row === "message" ? frozen.messageTime + 501 : frozen.partTime + 501,
          )
          expect(stored?.session_id).toBe(
            SessionID.make(
              collision.coordinate === "foreign"
                ? STRANGER
                : String(
                    frozen.fact.type === "self"
                      ? frozen.fact.subject
                      : frozen.fact.type === "edge"
                        ? frozen.fact.owner
                        : frozen.fact.root,
                  ),
            ),
          )

          const events = yield* db
            .select()
            .from(EventTable)
            .where(
              inArray(EventTable.id, [
                EventV2.ID.make(String(frozen.messageEvent)),
                EventV2.ID.make(String(frozen.partEvent)),
              ]),
            )
            .all()
            .pipe(Effect.orDie)
          expect(events.map((event) => String(event.id))).toEqual(
            collision.row === "message" ? [] : [String(frozen.messageEvent)],
          )
          const target = String(
            frozen.fact.type === "self"
              ? frozen.fact.subject
              : frozen.fact.type === "edge"
                ? frozen.fact.owner
                : frozen.fact.root,
          )
          const sequence = yield* db
            .select()
            .from(EventSequenceTable)
            .where(eq(EventSequenceTable.aggregate_id, target))
            .get()
            .pipe(Effect.orDie)
          expect(sequence?.seq).toBe(collision.row === "message" ? undefined : 0)

          // §12.2 retention: no replacement ID/time/wording and no fence release on collision.
          expect(probe.failureKind).toBe("record_failed")
          expect(probe.phase).toBe("record_failed")
          expect(current.failure?.kind).toBe("record_failed")
          expect(generation.records).toHaveLength(3)
          expect(generation.records[0]).toBe(frozen)
          expect(generation.committedPrefix).toBe(0)
          expect(generation.verified).toEqual([])
          expect(generation.failure).toBe("record_failed")
          expect(probe.view.fences.length).toBeGreaterThan(0)
          expect(fenced(probe)).toEqual(claims(probe))
        }).pipe(Effect.provide(Layer.fresh(recordCoreLayer()))),
    )
  }

  for (const failure of recordFailures) {
    it.live(`K22: ${failure.boundary} failure retains the frozen plan and repeat abort exact-repairs it`, () =>
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const core = yield* SessionProjector.ClosureRecordService
        const injected = yield* Ref.make(false)
        const statuses = yield* Ref.make<
          readonly { readonly kind: "message" | "part"; readonly status: "committed_new" | "existing_exact" }[]
        >([])
        const plans = yield* Ref.make<readonly Model.FrozenPair[]>([])
        yield* prepareRecordSessions(`/closure-k22-${failure.kind}-${failure.after ? "readback" : "writer"}`)

        const once = Ref.modify(injected, (current) => [!current, true] as const)
        const wrapped = SessionProjector.ClosureRecordService.of({
          message: (input) => {
            if (failure.kind !== "message")
              return core
                .message(input)
                .pipe(
                  Effect.tap((result) =>
                    Ref.update(statuses, (current) => [
                      ...current,
                      { kind: "message" as const, status: result.status },
                    ]),
                  ),
                )
            return Effect.gen(function* () {
              if (!failure.after && (yield* once))
                return yield* Effect.fail(new Error("injected Message writer failure"))
              const result = yield* core.message(input)
              yield* Ref.update(statuses, (current) => [
                ...current,
                { kind: "message" as const, status: result.status },
              ])
              if (failure.after && (yield* once))
                return yield* Effect.fail(new Error("injected Message readback failure"))
              return result
            })
          },
          part: (input) => {
            if (failure.kind !== "part")
              return core
                .part(input)
                .pipe(
                  Effect.tap((result) =>
                    Ref.update(statuses, (current) => [...current, { kind: "part" as const, status: result.status }]),
                  ),
                )
            return Effect.gen(function* () {
              if (!failure.after && (yield* once)) return yield* Effect.fail(new Error("injected Part writer failure"))
              const result = yield* core.part(input)
              yield* Ref.update(statuses, (current) => [...current, { kind: "part" as const, status: result.status }])
              if (failure.after && (yield* once)) return yield* Effect.fail(new Error("injected Part readback failure"))
              return result
            })
          },
          verify: core.verify,
        })
        const realRecord = yield* recordCapability(wrapped)
        const record: Ports.RecordCapability = {
          write: (input) =>
            Ref.update(plans, (current) => [...current, input.record]).pipe(Effect.andThen(realRecord.write(input))),
          verify: realRecord.verify,
        }
        const probe = yield* drive({
          root: ROOT,
          frames: IDENTITY_WORLD,
          planIdentity: IDENTITY,
          highWater: [],
          clockMillis: 10_000,
          recordCapability: record,
          attempts: 2,
        })
        const first = probe.settledViews[0]?.operations[0]
        const retained = first?.generations.at(-1)
        const generation = probe.generation
        const written = yield* Ref.get(plans)
        if (!first || !retained || !generation || !written[0] || !written[1])
          return yield* Effect.die(
            `expected retained and repaired K22 generations: failures=${probe.failureKinds.join(",")} settled=${probe.settledViews.length} plans=${written.length} phase=${probe.phase} generation=${generation?.committedPrefix}`,
          )

        // The first waiter sees the exact post-freeze failure while its plan and fences are still live.
        expect(probe.failureKinds[0]).toBe("record_failed")
        expect(first.phase.type).toBe("record_failed")
        expect(first.failure?.kind).toBe("record_failed")
        expect(retained.failure).toBe("record_failed")
        expect(retained.committedPrefix).toBe(0)
        expect(retained.verified).toEqual([])
        expect(probe.settledViews[0]?.fences.length).toBeGreaterThan(0)
        expect(names(probe.settledViews[0]?.fences.map((fence) => fence.session) ?? [])).toEqual(names(first.claims))
        expect(probe.pairReturns[0]).toMatchObject({ message: failure.message, part: failure.part })

        // Repeat abort uses the same frozen tuple; only its PairPermit is new. No fresh time, ID,
        // source, text, metadata, or generation is selected for the failed prefix.
        expect(written[1]).toEqual(written[0])
        expect(written[1].message).toBe(written[0].message)
        expect(written[1].part).toBe(written[0].part)
        expect(written[1].messageEvent).toBe(written[0].messageEvent)
        expect(written[1].partEvent).toBe(written[0].partEvent)
        expect(written[1].messageTime).toBe(written[0].messageTime)
        expect(written[1].partTime).toBe(written[0].partTime)
        expect(written[1].identity).toEqual(written[0].identity)
        expect(probe.pairWrites[1]?.candidate.fact).toBe(probe.pairWrites[0]?.candidate.fact)
        expect(probe.pairWrites[1]?.permit).not.toBe(probe.pairWrites[0]?.permit)

        // Gate 5 slice G continues the exact repair through physical postflight and the successful
        // release boundary. The first failure remains observable above; the repaired generation is
        // byte-identical, complete, and the successful transition removes every retained fence.
        expect(yield* Ref.get(injected)).toBe(true)
        expect(probe.pairWrites).toHaveLength(4)
        expect(probe.pairReturns).toHaveLength(4)
        expect(probe.pairReturns.slice(1).map((item) => [item.message, item.part])).toEqual([
          ["verified", "verified"],
          ["verified", "verified"],
          ["verified", "verified"],
        ])
        expect(generation.generation).toBe(retained.generation)
        expect(generation.records).toEqual(retained.records)
        expect(generation.committedPrefix).toBe(3)
        expect(generation.verified).toEqual(generation.facts)
        expect(generation.failure).toBeUndefined()
        expect(probe.failureKinds[1]).toBeUndefined()
        expect(probe.phase).toBe("released_pending_delivery")
        expect(probe.view.fences).toEqual([])
        expect(operation(probe).views.every((view) => view.result === "success")).toBe(true)

        const records = generation.records
        expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(3)
        expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(3)
        for (const frozen of records) {
          const message = yield* db
            .select()
            .from(MessageTable)
            .where(eq(MessageTable.id, MessageID.make(String(frozen.message))))
            .get()
            .pipe(Effect.orDie)
          const part = yield* db
            .select()
            .from(PartTable)
            .where(eq(PartTable.id, PartID.make(String(frozen.part))))
            .get()
            .pipe(Effect.orDie)
          expect(message).toMatchObject({
            time_created: frozen.messageTime,
            time_updated: frozen.messageTime,
            data: { agent: frozen.identity.agent },
          })
          expect(part).toMatchObject({
            message_id: String(frozen.message),
            time_created: frozen.partTime,
            time_updated: frozen.partTime,
            data: { text: frozen.text, metadata: { [CLOSURE_RECORD_METADATA_KEY]: frozen.metadata } },
          })
        }

        const observed = yield* Ref.get(statuses)
        const firstMessage = observed.filter((item) => item.kind === "message").map((item) => item.status)
        const firstPart = observed.filter((item) => item.kind === "part").map((item) => item.status)
        const messagePrefix: ("committed_new" | "existing_exact")[] =
          failure.kind === "message" && !failure.after ? ["committed_new"] : ["committed_new", "existing_exact"]
        const partPrefix: ("committed_new" | "existing_exact")[] =
          failure.kind === "part" && failure.after ? ["committed_new", "existing_exact"] : ["committed_new"]
        expect(firstMessage.slice(0, messagePrefix.length)).toEqual(messagePrefix)
        expect(firstPart.slice(0, partPrefix.length)).toEqual(partPrefix)
      }).pipe(Effect.provide(Layer.fresh(recordCoreLayer()))),
    )
  }

  it.live("§12.2: an absent record capability returns the issued pair as a retained record_failed plan", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: IDENTITY_WORLD,
        planIdentity: IDENTITY,
        highWater: [],
      })
      const current = operation(probe)
      const generation = probe.generation
      const write = probe.pairWrites[0]
      const returned = probe.pairReturns[0]
      const permit = probe.view.pairs[0]
      if (!current || !generation || !write || !returned || !permit)
        return yield* Effect.die("expected one failed PairPermit")

      // Positive preconditions: planning froze real rows and the coordinator really issued a permit.
      // Without both, `record_failed` could be an unrelated failure reached before the missing wire.
      expect(generation.records).toHaveLength(3)
      expect(probe.pairWrites).toHaveLength(1)
      expect(probe.pairReturns).toHaveLength(1)
      expect(probe.view.pairs).toHaveLength(1)
      expect(permit.id).toBe(write.permit)
      expect(returned.write).toBe(write)
      expect(returned.write.permit).toBe(permit.id)

      // No Message capability exists in E3. The driver reports the attempted first component as
      // failed and the never-attempted Part as absent; silence would leave `inFlight` occupied.
      expect(returned.message).toBe("failed")
      expect(returned.part).toBe("absent")
      expect(permit.state).toBe("failed")
      expect(generation.inFlight).toEqual([])
      expect(generation.committedPrefix).toBe(0)
      expect(generation.verified).toEqual([])
      expect(generation.failure).toBe("record_failed")

      // The kind points repair at the post-freeze write seam rather than falsely blaming the worker.
      // The exact frozen plan, permit coordinates, repair token, and fences remain retained.
      expect(probe.failureKind).toBe("record_failed")
      expect(probe.phase).toBe("record_failed")
      expect(current.failure?.kind).toBe("record_failed")
      expect(current.failure?.repair).toBe(write.candidate.repair)
      expect(generation.records[0]?.fact.id).toBe(write.candidate.fact)
      expect(probe.view.fences.length).toBeGreaterThan(0)
      expect(fenced(probe)).toEqual(claims(probe))
      probe.view.fences.forEach((fence) => expect(fence.operation).toBe(current.id))
    }),
  )

  it.live("K72: a late external planning lease discards the stale plan and remains exempt while re-proving", () =>
    Effect.gen(function* () {
      const exercise = (late: boolean) =>
        Effect.gen(function* () {
          const identityStarted = yield* Deferred.make<void>()
          const identityResume = yield* Deferred.make<void>()
          const highWaterStarted = yield* Deferred.make<void>()
          const highWaterResume = yield* Deferred.make<void>()
          const actor = yield* Ref.make<Fiber.Fiber<void, unknown> | undefined>(undefined)
          const planningView = yield* Ref.make<Model.View | undefined>(undefined)
          const joined = yield* Ref.make<SessionClosure.Admission | undefined>(undefined)
          const joinedView = yield* Ref.make<Model.View | undefined>(undefined)
          const afterRead = yield* Ref.make<Model.View | undefined>(undefined)
          const afterProof = yield* Ref.make<Model.View | undefined>(undefined)
          const noProof = yield* Ref.make<Model.Decision | undefined>(undefined)
          const reproved = yield* Ref.make<Model.Decision | undefined>(undefined)

          const probe = yield* drive({
            root: ROOT,
            frames: IDENTITY_WORLD,
            planIdentityCapability: {
              resolve: (targets) =>
                Deferred.succeed(identityStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(identityResume)),
                  Effect.as(targets.map((session) => ({ session, identity: IDENTITY }))),
                ),
            },
            highWaterCapability: {
              read: () =>
                Deferred.succeed(highWaterStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(highWaterResume)),
                  Effect.as([]),
                ),
            },
            // Lets the no-mutation twin retain its successful freeze for inspection. The stale case
            // never reaches a pair, so this cannot influence its result.
            record: "verified",
            beforeRequest: (closure) =>
              Effect.gen(function* () {
                const task = yield* Effect.gen(function* () {
                  yield* Deferred.await(identityStarted)
                  yield* Ref.set(planningView, yield* closure.view.pipe(Effect.orDie))
                  yield* Deferred.succeed(identityResume, undefined)

                  yield* Deferred.await(highWaterStarted)
                  if (late) {
                    const signal = yield* Deferred.make<void>()
                    const decision = yield* closure
                      .acquire({
                        session: SessionID.make(ROOT),
                        origin: "external",
                        retry: "initial",
                        source: "test.k72.late-planning",
                        owner: { id: Model.id("scope", "k72:late"), signal },
                      })
                      .pipe(Effect.orDie)
                    yield* Ref.set(joined, decision)
                    yield* Ref.set(joinedView, yield* closure.view.pipe(Effect.orDie))
                  }
                  yield* Deferred.succeed(highWaterResume, undefined)
                }).pipe(
                  // A red actor must still release both reads so the bounded test can report the
                  // failure instead of proving it by deadlocking.
                  Effect.ensuring(
                    Effect.all(
                      [Deferred.succeed(identityResume, undefined), Deferred.succeed(highWaterResume, undefined)],
                      { discard: true },
                    ),
                  ),
                  Effect.forkChild,
                )
                yield* Ref.set(actor, task)
              }),
            afterCommand: (command) => {
              if (command.command.type !== "plan.read") return Effect.void
              const read = command.command
              return Effect.gen(function* () {
                const observed = yield* command.control.view.pipe(Effect.orDie)
                yield* Ref.set(afterRead, observed)
                if (!late) return

                // `planningReturn`'s stale branch cleared the proof. Attempting to consume one before
                // re-proving must therefore reject at the model boundary.
                const rejected = yield* command.control
                  .transition({ type: "planning.begin", operation: read.operation })
                  .pipe(Effect.orDie)
                yield* Ref.set(noProof, rejected.decision)

                const prior = yield* command.control.scan(read.operation).pipe(Effect.orDie)
                const current = yield* command.control.scan(read.operation).pipe(Effect.orDie)
                const proof = yield* command.control
                  .transition({
                    type: "quiescence.prove",
                    operation: read.operation,
                    prior,
                    current,
                  })
                  .pipe(Effect.orDie)
                yield* Ref.set(reproved, proof.decision)
                yield* Ref.set(afterProof, yield* command.control.view.pipe(Effect.orDie))
              })
            },
          })

          const fiber = yield* Ref.get(actor)
          if (!fiber) return yield* Effect.die("planning actor was never installed")
          yield* Fiber.join(fiber)
          return {
            probe,
            planning: yield* Ref.get(planningView),
            joined: yield* Ref.get(joined),
            joinedView: yield* Ref.get(joinedView),
            afterRead: yield* Ref.get(afterRead),
            afterProof: yield* Ref.get(afterProof),
            noProof: yield* Ref.get(noProof),
            reproved: yield* Ref.get(reproved),
          }
        })

      // Positive twin: the same two paused reads, same facts, and no late revision change MUST freeze.
      // Without this, the negative could pass for a planning path that never freezes at all.
      const stable = yield* exercise(false)
      expect(stable.planning?.operations[0]?.phase.type).toBe("planning")
      expect(stable.probe.planIdentityCalls).toBe(1)
      expect(stable.probe.highWaterCalls).toEqual([[CHILD, ROOT]])
      expect(stable.afterRead?.operations[0]?.phase.type).toBe("recording")
      expect(stable.afterRead?.sequences.freeze).toBe(1n)
      expect(stable.afterRead?.operations[0]?.generations).toHaveLength(1)
      expect(stable.afterRead?.operations[0]?.generations[0]?.records).toHaveLength(3)

      const stale = yield* exercise(true)
      const planning = stale.planning?.operations[0]
      const joinedOperation = stale.joinedView?.operations[0]
      const discarded = stale.afterRead?.operations[0]
      const proved = stale.afterProof?.operations[0]
      if (!planning || !joinedOperation || !discarded || !proved)
        return yield* Effect.die("missing a K72 stage observation")
      expect(planning.phase.type).toBe("planning")
      expect(planning.planning).toBeDefined()
      expect(stale.joined?.type).toBe("joined")
      if (stale.joined?.type !== "joined") return yield* Effect.die("late external lease did not join")
      const admission = stale.joined

      const lease = stale.joinedView?.leases.find((item) => item.id === admission.lease)
      expect(lease?.id).toBe(admission.lease)
      expect(lease?.origin).toBe("external")
      expect(lease?.acquisition).toBe("post_fence")
      expect(lease?.state).toBe("reserved")
      expect(lease?.operation).toBe(joinedOperation.id)
      expect(joinedOperation.executionLeases).toContain(admission.lease)
      expect(joinedOperation.revision).toBeGreaterThan(planning.revision)

      // The paused read returns stale: no generation, pair, freeze sequence, coordinates, events, or
      // timestamp tuple entered model state. The operation is reset to quiescing with planning gone.
      expect(discarded.phase.type).toBe("quiescing")
      expect(discarded.planning).toBeUndefined()
      expect(discarded.generations).toEqual([])
      expect(stale.afterRead?.pairs).toEqual([])
      expect(stale.afterRead?.sequences.freeze).toBe(0n)
      expect(stale.probe.pairWrites).toEqual([])
      expect(stale.noProof).toEqual({ type: "rejected", reason: "invalid_transition" })

      // The tripwire: the exact reserved post-fence lease remains a member while fresh proof runs.
      // Dropping `blockers`' acquisition exemption makes this reject and this assertion go red.
      const afterLease = stale.afterProof?.leases.find((item) => item.id === admission.lease)
      expect(afterLease?.id).toBe(admission.lease)
      expect(afterLease?.state).toBe("reserved")
      expect(proved.executionLeases).toContain(admission.lease)
      expect(stale.reproved).toEqual({ type: "applied" })
    }),
  )

  it.live("K51: an adopted pre-fence lease blocks one fixed point, then post-mutation identity freezes", () =>
    Effect.gen(function* () {
      const leaseID = yield* Ref.make<Model.LeaseID | undefined>(undefined)
      const adopted = yield* Ref.make<Model.View["leases"][number] | undefined>(undefined)
      const retiredAt = yield* Ref.make<number | undefined>(undefined)
      const signal = yield* Deferred.make<void>()
      const before: Model.Identity = {
        ...IDENTITY,
        source: "prior_user_message",
        sourceMessage: Model.id("message", "k51:before"),
      }
      const after: Model.Identity = {
        ...IDENTITY,
        source: "prior_user_message",
        sourceMessage: Model.id("message", "k51:after"),
      }
      const identity = { current: before }

      const result = yield* drive({
        root: ROOT,
        frames: [{ jobs: [{ job: "job_k51", owner: ROOT, target: CHILD }] }, {}, {}, {}],
        planIdentity: () => identity.current,
        highWater: [],
        clockMillis: 8_000,
        record: "verified",
        beforeRequest: (closure) =>
          Effect.gen(function* () {
            const decision = yield* closure
              .acquire({
                session: SessionID.make(ROOT),
                origin: "external",
                retry: "initial",
                source: "test.k51.freeze",
                owner: { id: Model.id("scope", "k51:owner"), signal },
              })
              .pipe(Effect.orDie)
            expect(decision.type).toBe("admitted")
            if (decision.type !== "admitted") return yield* Effect.die("K51 pre-fence lease was not admitted")
            yield* Ref.set(leaseID, decision.lease)
          }),
        beforeSweep: (index, closure) => {
          if (index !== 2) return Effect.void
          return Effect.gen(function* () {
            const id = yield* Ref.get(leaseID)
            const view = yield* closure.view.pipe(Effect.orDie)
            yield* Ref.set(
              adopted,
              view.leases.find((item) => item.id === id),
            )
            identity.current = after
            if (id) yield* closure.retire(id).pipe(Effect.orDie)
            yield* Ref.set(retiredAt, index)
          })
        },
      })

      const observed = yield* Ref.get(adopted)
      expect(observed?.state).toBe("reserved")
      expect(observed?.operation).toBeDefined()
      expect(yield* Ref.get(retiredAt)).toBe(2)
      expect(result.sweeps).toBeGreaterThanOrEqual(4)
      expect(result.phase).toBe("recording")
      expect(result.generation?.records).toHaveLength(3)
      expect(result.generation?.records.map((record) => record.fact.type)).toEqual(["self", "edge", "root"])
      expect(result.generation?.records.map((record) => record.identity.sourceMessage)).toEqual([
        after.sourceMessage,
        after.sourceMessage,
        after.sourceMessage,
      ])
      expect(result.generation?.records.map((record) => record.messageTime)).toEqual([8_000, 8_002, 8_004])
    }),
  )

  it.live("§8.5: an ABSENT discovery capability cannot prove quiescence, where an empty one can", () =>
    Effect.gen(function* () {
      const blind = yield* drive({ root: ROOT, frames: [{}], discovery: false })
      expect(blind.proved).toBe(false)
      expect(blind.sweeps).toBe(0)

      // AND THE FAILURE IS THE RIGHT ONE — Gate 5 slice D, and a separate claim from its being a
      // failure. Through Gate 4 this return was bare: the fiber ended, `workerExited` fired, and the
      // model recorded `closure_unavailable`, §12.2's "current worker defects". Correct for a defect
      // and a lie about this — nothing defected. A ticket was issued and a worker opened; the driver
      // then declined to guess at quiescence it had no evidence for, which is §12.2's "stable scan
      // cannot be proved". §6.9's known-open item 5 named this as the same misattribution Gate 4 had
      // already fixed for the exhausted bound, reached by a different trigger.
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

  it.live(
    "§8.4 steps 6/8/9 + K5: a grandchild below an IDLE intermediate is claimed and signalled; the connector is fenced but never signalled",
    () =>
      Effect.gen(function* () {
        // The intermediate has no Runner and its own job has TERMINALIZED — exactly §8.4 step 6's
        // terminal/yielded connector. Its edge is still current evidence, which is what lets the walk
        // reach the root; the only thing still capable of continuation is the grandchild's job.
        const connector = { job: "job_connector", owner: ROOT, target: CHILD, state: "terminal" } as const
        const probe = yield* drive({
          root: ROOT,
          frames: [
            { jobs: [connector, { job: "job_grandchild", owner: CHILD, target: GRANDCHILD }] },
            { jobs: [connector] },
          ],
        })
        expect(probe.proved).toBe(true)
        expect(claims(probe)).toEqual([CHILD, GRANDCHILD, ROOT].toSorted())
        // I-07 / §8.4 step 9. The connector is on the proven path and IS fenced, which is the positive
        // half; what it never receives is a signal. Asserting only the absence would also pass for a
        // driver that never reached the connector at all.
        expect(fenced(probe)).toEqual([CHILD, GRANDCHILD, ROOT].toSorted())
        expect(probe.signals).toEqual(["job:job_grandchild"])
        expect(probe.signals.some((target) => target.includes(CHILD))).toBe(false)
      }),
  )

  it.live(
    "§8.9 step 6 / §10.1-§10.2: each proven edge contributes an owner-edge and a child-self fact carrying the same frozen winner, plus one per-view root fact",
    () =>
      Effect.gen(function* () {
        // K5's world, because it is the smallest one with TWO levels: a terminal connector edge
        // ROOT->CHILD and a live edge CHILD->GRANDCHILD. One level could not show that an
        // intermediate receives both an inbound edge fact and its own self fact.
        const connector = {
          job: "job_connector",
          owner: ROOT,
          target: CHILD,
          state: "terminal",
          taskMessage: "msg_root",
          taskCall: "call_child",
        } as const
        const probe = yield* drive({
          root: ROOT,
          frames: [
            {
              jobs: [
                connector,
                {
                  job: "job_grandchild",
                  owner: CHILD,
                  target: GRANDCHILD,
                  taskMessage: "msg_child",
                  taskCall: "call_grandchild",
                },
              ],
            },
            { jobs: [connector] },
          ],
          // Two DIFFERENT winners, deliberately. A single scripted outcome would pass for a driver
          // that hard-coded one, and §10.1's whole point is that the axis is read rather than
          // inferred from the cancellation.
          toolPart: {
            call_child: { outcome: "completed", part: PartID.make("prt_child") },
            call_grandchild: { outcome: "cancelled", part: PartID.make("prt_grandchild") },
          },
        })

        // Positive preconditions: the branch really converged and really proved, so the facts below
        // were built against a fixed point rather than by a driver that gave up early.
        expect(probe.proved).toBe(true)
        expect(claims(probe)).toEqual([CHILD, GRANDCHILD, ROOT].toSorted())

        /**
         * THE ANTI-VACUITY ASSERTION FOR THIS ENTIRE MECHANISM.
         *
         * Before this row, every assertion in this file was satisfied by a driver that constructed
         * NO facts: `planning` is reached whether or not any `view.require` applies. §6.9 records
         * two Gate-4 defects of exactly that shape — a field added to a conflict set with only one
         * producer, and a row list asserted with no test naming it — both plausible, both
         * unverified, both settled by an instrument that was available and cheap. This is that
         * instrument.
         *
         * It is exact rather than a count, so it also pins the four things a count would miss: the
         * edge fact's subject is the CHILD whose execution the outcome describes (placement in the
         * owner transcript is a separate axis), the child's self fact carries the SAME winner as its
         * inbound edge (one execution, one winner), the winner is the scripted ToolPart row's rather
         * than an inference, and `taskPart` is threaded from that same capability return.
         */
        expect(shapes(probe)).toEqual(
          [
            `edge ${ROOT}->${CHILD} subject=${CHILD} outcome=completed yielded=false part=prt_child`,
            `self ${CHILD} outcome=completed yielded=false`,
            `edge ${CHILD}->${GRANDCHILD} subject=${GRANDCHILD} outcome=cancelled yielded=false part=prt_grandchild`,
            `self ${GRANDCHILD} outcome=cancelled yielded=false`,
            // §10.1: a root that was idle while only descendants executed records branch quiescence
            // and NO fictional direct outcome. `direct=-` is that omission, asserted rather than
            // assumed.
            `root ${ROOT} direct=-`,
          ].toSorted(),
        )

        // §10.2 places the root record once per requested-root view, not once per proven Session.
        expect(probe.facts.filter((item) => item.type === "root")).toHaveLength(1)
      }),
  )

  it.live("K29(a)/§10.2: a no-work root constructs no facts at all — not even its own root fact", () =>
    Effect.gen(function* () {
      const probe = yield* drive({ root: ROOT, frames: [{}] })
      // The positive precondition, again: the driver looked, and proved. Without it a driver that
      // returned immediately would satisfy the emptiness below for the wrong reason.
      expect(probe.sweeps).toBeGreaterThan(0)
      expect(probe.proved).toBe(true)
      /**
       * §10.2's "the no-work idle case writes nothing", and K29(a)'s "no operation/generation/
       * records". §10.2's third clause reads "one selected-root record for each requested-root
       * view", which taken alone would emit a root fact here — a record asserting that a branch
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

  it.live("§8.4 step 8: the fence is installed before the signal is dispatched, not after", () =>
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

  it.live("K23 runtime half: an unrelated branch in the same Instance is never claimed, fenced, or signalled", () =>
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
      // §8.3 `unanchored_unknown` — no authority, no failure, no contamination.
      expect(claims(probe)).not.toContain(STRANGER)
      expect(fenced(probe)).not.toContain(STRANGER)
      expect(probe.signals.some((target) => target.includes(STRANGER))).toBe(false)
      // The unrelated branch stays active throughout and does NOT prevent this root proving.
      expect(probe.proved).toBe(true)
      expect(operation(probe)?.views[0]?.result).not.toBe("failure")
    }),
  )

  it.live("K10(b)/I-09: with no new work the final scan is stable and the proof holds", () =>
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
      // THE POSITIVE CONTROL for the I-20 row's `quiescence_failed` assertion below, and a guard in
      // its own right. `exhausted` may fire ONLY on fall-through from the sweep loop; a converging
      // run must never declare a quiescence failure. If the declaration were moved inside the loop,
      // or the `applied` early return were dropped, this run would fail while the I-20 row stayed
      // green — so without this assertion that defect has no witness.
      expect(operation(probe).phase).not.toEqual({ type: "quiescence_failed" })
      expect(operation(probe).failure).toBeUndefined()
    }),
  )

  it.live("K10(a)/§8.4 step 10: work that appears AFTER the first sweep is widened in, signalled, and closed", () =>
    Effect.gen(function* () {
      // Sweep 1 sees only the child. The grandchild's job appears in sweep 2 — the adversary — and
      // must still be discovered, claimed, signalled and converged on.
      //
      // THIS IS THE CARRIED OBLIGATION FROM STEP 2. Sync-Task teardown no longer transitively
      // cancels grandchild jobs; §2.6 requires that narrowing, and the fixed-point rescan is where
      // the work it stopped doing is picked up. A driver that scanned once would leave `job_late`
      // running.
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

  it.live(
    "§8.7 clauses 1-2: signalled work that is STILL enumerated blocks the proof, and new work beside it is still claimed",
    () =>
      Effect.gen(function* () {
        // Cancellation is not instantaneous, and every other fixture in this file lets work vanish on
        // the sweep after it is signalled. Here the child is still enumerated while its interrupt is
        // in flight, and a grandchild appears beside it in the same sweep.
        //
        // Two independent defences meet here, which is why they share a fixture. The lingering child
        // must not be re-claimed — the model counts one signal per NEWLY active Session, so a driver
        // that resubmitted the whole active set would send two signals where the model expects one,
        // have the entire claim rejected as unverified, and never claim the GRANDCHILD at all. And
        // the lingering child must block the proof, because the model's accounting alone cannot see a
        // Runner that is still running.
        const probe = yield* drive({
          root: ROOT,
          frames: [
            { runners: [{ session: CHILD }], jobs: [{ job: "job_child", owner: ROOT, target: CHILD }] },
            {
              runners: [{ session: CHILD }],
              jobs: [
                { job: "job_child", owner: ROOT, target: CHILD },
                { job: "job_late", owner: CHILD, target: GRANDCHILD },
              ],
            },
            { jobs: [] },
          ],
        })
        expect(probe.proved).toBe(true)
        // The new work beside the lingering child was claimed and signalled.
        expect(claims(probe)).toEqual([CHILD, GRANDCHILD, ROOT].toSorted())
        expect(probe.signals).toContain("job:job_late")
        // The child was signalled exactly once despite being enumerated on two consecutive sweeps.
        expect(probe.signals.filter((target) => target === "runner:" + CHILD)).toHaveLength(1)
        // The proof could not have been reached on the sweep where the child was still enumerated.
        expect(probe.sweeps).toBeGreaterThanOrEqual(3)
      }),
  )

  it.live("§8.7 clause 1 / I-20: a claimed Session that never stops running is never proved quiescent", () =>
    Effect.gen(function* () {
      // The last frame repeats forever, so the claimed child's Runner never goes away. The model's
      // own accounting is perfectly stable throughout — the claim set stops moving after the first
      // sweep, no lease or effect is outstanding, and any two scans agree — so a driver that proved
      // on the model's evidence alone would report success here.
      //
      // I-20's direction matters as much as the outcome: the sweep bound ENDS the attempt but never
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
      // `closure_unavailable` — §12.2's "current worker defects" and the §6.5 matrix's "unexpected
      // worker exit". Correct for a defect, and a lie about this: nothing defected here. The
      // machinery issued a ticket, opened a worker, ran the bound to its end and signalled, and what
      // failed is the quiescence — §12.2's "stable scan cannot be proved". The two kinds send a
      // reader to different places, so asserting only "it failed" would let the wrong one through.
      //
      // Observed from the captured view, which is taken after `run` returns and therefore after the
      // driver has declared. That the exit path does NOT then overwrite it is the ordering property
      // `unproved` depends on: `fail` leaves the driver `failed`, and `workerExited` no-ops stale.
      expect(operation(probe).phase).toEqual({ type: "quiescence_failed" })
      expect(operation(probe).failure?.kind).toBe("quiescence_failed")
    }),
  )

  it.live("§18 step 4: the Task coordinate reaches the capability after the proof, and the proof survives it", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: [
          {
            runners: [{ session: CHILD }],
            jobs: [{ job: "job_child", owner: ROOT, target: CHILD, taskMessage: "msg_task", taskCall: "call_task" }],
          },
          {},
        ],
        toolPart: { call_task: { outcome: "cancelled" } },
      })

      // Positive precondition: the branch actually converged, so the call below happened against a
      // real fixed point rather than against a driver that gave up.
      expect(claims(probe)).toEqual([CHILD, ROOT].toSorted())

      /**
       * THE ORDERING ASSERTION, and it is the sharpest one in this row.
       *
       * `proved` is the operation resting in `planning`, which the model enters only when a
       * quiescence proof exists AND its revision still equals the operation's. Every transition
       * bumps that revision, so this stays `true` only if the driver RE-PROVED after emitting facts
       * rather than carrying a stale proof past them.
       *
       * GATE 5 CHANGED WHAT THIS ROW MEANS, and the previous wording is worth recording because it
       * would now be read as a prohibition. Through Gate 4 this assertion read "if `capture` issued
       * ANY transition — a `view.require` carrying facts, say — this would be `false`", because the
       * driver ended at the proof and §8.9 step 6's fact construction did not exist yet. Gate 5's
       * driver DOES emit facts here, deliberately; what keeps this `true` is the convergence loop —
       * facts invalidate the proof, the loop re-derives and re-proves, and `planning.begin` is the
       * immediate next transition. The property under test is unchanged: no stale proof may reach
       * `planning`. Only the mechanism that satisfies it is new.
       */
      expect(probe.proved).toBe(true)
      expect(probe.phase).toBe("planning")

      /**
       * THE END-TO-END PATH. These exact strings were written into the scripted job's metadata and
       * reached the capability only by surviving `discovery.ts`'s shape check, `driver.ts::observe`,
       * the per-sweep coordinate retention, and `capture`. Asserting the VALUES rather than a call
       * count is what makes that path load-bearing — a count would pass on invented coordinates.
       *
       * `session` is the OWNER, not the child, and that is the substantive claim: the Task ToolPart
       * lives in the CALLER's transcript, because the Task tool runs in the caller's Session. A
       * driver that looked it up in the child would find nothing and silently report `unknown`.
       */
      expect(probe.toolPartCalls).toEqual([{ session: ROOT, message: "msg_task", call: "call_task" }])
    }),
  )

  it.live("no capability and no coordinate are different absences, and neither invents a call", () =>
    Effect.gen(function* () {
      const frames = [
        {
          runners: [{ session: CHILD }],
          jobs: [{ job: "job_child", owner: ROOT, target: CHILD, taskMessage: "msg_task", taskCall: "call_task" }],
        },
        {},
      ]

      // ABSENT CAPABILITY. The coordinate is present and complete; there is simply nothing to ask.
      const without = yield* drive({ root: ROOT, frames })
      expect(without.proved).toBe(true)
      expect(without.toolPartCalls).toEqual([])

      /**
       * ABSENT COORDINATE, capability present — the other polarity, and the one §8.5 is about.
       * "Malformed or mismatched metadata must never widen cancellation": a job carrying no Task
       * coordinate must produce no resolution attempt at all, rather than a call against a
       * fabricated or partial one. The control is the case above plus the row before it, which
       * together show the call DOES happen when both halves are present.
       */
      const uncoordinated = yield* drive({
        root: ROOT,
        frames: [{ runners: [{ session: CHILD }], jobs: [{ job: "job_child", owner: ROOT, target: CHILD }] }, {}],
        toolPart: { call_task: { outcome: "cancelled" } },
      })
      expect(uncoordinated.proved).toBe(true)
      expect(uncoordinated.toolPartCalls).toEqual([])
    }),
  )

  /**
   * §8.3's Task axis, and this pair is what makes it non-inert.
   *
   * AN AUDIT PROVED THE PREVIOUS ATTEMPT VACUOUS. Adding `taskMessage`/`taskCall` to `IDENTITY` and
   * populating them from job metadata left the suite at 350 pass / 0 fail when both were deleted
   * again. The cause is structural: `validateEdges` reports a conflict only on two distinct values
   * for one edge id, `driver.ts::observe` is the sole production producer, and
   * `BackgroundJob.listExact` yields at most one entry per public job ID — so one producer cannot
   * contradict itself, however many keys it quotes. That is exactly why `taskPart` was inert for
   * two gates, and adding fields reproduced it rather than fixing it.
   *
   * The RETAINED observation is the second producer, replaying each edge's FIRST-observed
   * coordinate, which is the same mechanism by which `owner` and `child` can already conflict.
   *
   * WHY THE GRANDCHILD IS THE INSTRUMENT. A mismatch marks the edge's child `contradicted`
   * (`proof.ts`), and a contradicted node cannot anchor a walk — so the consequence is only visible
   * where something must be anchored THROUGH it. A late-arriving grandchild is that something. The
   * two halves run the identical world on the identical schedule and differ in exactly one string,
   * so the different outcome is attributable to the coordinate and to nothing else.
   */
  /**
   * K25 — "CP-021 flag off: root async and otherwise unattached descendants still close through core
   * evidence; ordinary cancelled notifier remains silent; no CP-021 vocabulary required."
   *
   * THE FLAG-OFF CONDITION IS STRUCTURAL HERE, NOT SIMULATED, and that is why this row is
   * dischargeable at Gate 4 rather than waiting for a participant. Core carries no CP-021 import,
   * no flag read, and no attachment lifecycle anywhere in `src/session/closure` — so "flag off" is
   * not a mode core can be put into, it is core's ONLY state until Gate 8 registers the real
   * module. A fixture that registered a participant to switch it off would be modelling the
   * opposite of the row.
   *
   * NO RUNNERS AT ALL, deliberately. Every other row in this suite leans on a busy Runner somewhere,
   * which leaves "closes through CORE EVIDENCE" ambiguous between Runner evidence and job evidence.
   * Here every leaf is a non-terminal job token, so the branch is discovered, claimed, signalled and
   * proved with no Runner to lean on — which is the row's actual claim.
   *
   * "ROOT ASYNC" is the job whose target is the root and whose OWNER IS UNNAMED — literally the
   * row's "otherwise unattached". It emits a `PartialEdge` (§8.4 step 4's metadata gap), and the
   * root still anchors because `route` returns at the requested root before consulting any edge. So
   * the root's own async work is closed without lineage, without an owner, and without anything
   * naming the attachment that produced it.
   */
  it.live("K25: with no participant registered, root-async and unattached descendants close on core evidence", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: [
          {
            jobs: [
              { job: "job_root_async", target: ROOT },
              { job: "job_child", owner: ROOT, target: CHILD },
            ],
          },
          {},
        ],
      })

      // THE FLAG-OFF PRECONDITION, observed rather than assumed: no participant is registered, so
      // nothing CP-021-shaped contributed evidence, took a cancellation latch, or was consulted.
      // The "ordinary cancelled notifier" the row requires to stay silent is a participant wake
      // path, and there is no participant to wake.
      expect(operation(probe)?.participants ?? []).toEqual([])

      // Both the async root and its unattached descendant close, on job evidence alone.
      expect(claims(probe)).toEqual([CHILD, ROOT].toSorted())
      expect(probe.signals).toContain("job:job_root_async")
      expect(probe.signals).toContain("job:job_child")

      // AND THE PROOF HOLDS. Without this the row would be satisfied by a driver that claimed
      // everything and never established quiescence.
      expect(probe.proved).toBe(true)
    }),
  )

  it.live("§8.3: a Task coordinate that changes under the proof contradicts its edge and refuses to widen", () =>
    Effect.gen(function* () {
      const world = (secondSweepCall: string) => [
        {
          runners: [{ session: CHILD }],
          jobs: [{ job: "job_child", owner: ROOT, target: CHILD, taskMessage: "msg_task", taskCall: "call_a" }],
        },
        {
          runners: [{ session: CHILD }, { session: GRANDCHILD }],
          jobs: [
            { job: "job_child", owner: ROOT, target: CHILD, taskMessage: "msg_task", taskCall: secondSweepCall },
            { job: "job_grand", owner: CHILD, target: GRANDCHILD },
          ],
        },
        {},
      ]

      // CONTROL: the coordinate holds still. The grandchild anchors through the child exactly as
      // the ordinary grandchild row proves, and is claimed.
      const stable = yield* drive({ root: ROOT, frames: world("call_a") })
      expect(stable.proved).toBe(true)
      expect(claims(stable)).toContain(GRANDCHILD)

      // VARIANT: one string differs. The retained observation still carries `call_a`, the fresh one
      // now says `call_b`, and `validateEdges` has two distinct values for one edge id.
      const contradicted = yield* drive({ root: ROOT, frames: world("call_b") })

      // §8.5: "malformed or mismatched metadata must never widen cancellation". The child was
      // already claimed from the sweep where its evidence was still coherent, and stays claimed —
      // but the grandchild reachable ONLY through the contradicted edge is refused.
      expect(claims(contradicted)).toContain(CHILD)
      expect(claims(contradicted)).not.toContain(GRANDCHILD)

      // AND THE DISCRIMINATOR IS THE COORDINATE, not the schedule: both halves ran the same frames
      // in the same order with the same runners and jobs.
      expect(claims(stable)).not.toEqual(claims(contradicted))
    }),
  )

  it.live("§8.4 step 4: a metadata gap is bridged by lineage, and is NOT bridged without it", () =>
    Effect.gen(function* () {
      // The job names its target but no owner — §8.4 step 4's metadata gap, where current evidence
      // proved the edge and only one endpoint's identity is missing.
      const frames: readonly Frame[] = [{ jobs: [{ job: "job_gap", target: CHILD }] }, { jobs: [] }]
      const bridged = yield* drive({ root: ROOT, frames, lineage: [{ session: CHILD, parent: ROOT }] })
      expect(claims(bridged)).toEqual([CHILD, ROOT].toSorted())
      expect(bridged.signals).toContain("job:job_gap")

      // I-06's control. Identical evidence, no lineage capability: the gap stays a gap, and durable
      // lineage is the ONLY thing that differed. Without this, the test above would equally pass for
      // a driver that connected the leaf on current evidence alone.
      const unbridged = yield* drive({ root: ROOT, frames })
      expect(claims(unbridged)).toEqual([])
      expect(unbridged.signals).toEqual([])
      expect(unbridged.proved).toBe(true)
    }),
  )

  it.live("I-06: lineage naming a parent OUTSIDE this root's validated reach never bridges", () =>
    Effect.gen(function* () {
      const probe = yield* drive({
        root: ROOT,
        frames: [{ jobs: [{ job: "job_foreign", target: CHILD }] }, { jobs: [] }],
        // A real durable parent, but one this root cannot reach over validated edges. Bridging here
        // would let lineage INTRODUCE a node, which is exactly the branch expansion I-06 forbids.
        lineage: [{ session: CHILD, parent: "ses_driver_elsewhere" }],
      })
      expect(claims(probe)).toEqual([])
      expect(probe.signals).toEqual([])
    }),
  )
})
