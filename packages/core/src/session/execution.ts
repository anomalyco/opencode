export * as SessionExecution from "./execution.js"

import { Cause, Context, Effect, Exit, Layer } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Job } from "../job.js"
import { Instance } from "../instance/service.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionEvent } from "./event.js"
import { SessionInbox } from "./inbox.js"
import { SubagentReport } from "./execution/subagent-report.js"
import { SessionRunCoordinator } from "./run-coordinator.js"
import { SessionRunner } from "./runner/index.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { toSessionError } from "./to-session-error.js"

export interface Interface {
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Checks process-local ownership, including interruption cleanup and terminal settlement. */
  readonly isActive: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /**
   * The durable sequence where the Session's current busy period started, if one is bound.
   * Sequence-bounded lookups use it to find only work created by this period.
   */
  readonly periodStartSeq: (sessionID: SessionSchema.ID) => Effect.Effect<number | undefined>
  /**
   * Interrupt active work owned by this process. Idle interruption is a no-op. Resolves once
   * the interruption is accepted; cleanup settles asynchronously in the execution fiber.
   * Returns whether an active execution was interrupted. Compose with `awaitIdle` when
   * settlement matters.
   */
  readonly interrupt: (
    sessionID: SessionSchema.ID,
    options?: {
      readonly resume?: boolean
    },
  ) => Effect.Effect<boolean>
  /** Resolves once this process owns no active execution for the Session. Returns immediately when idle and never starts work. */
  readonly awaitIdle: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/** Routes execution from a Session ID to its selected instance's runner. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionExecution") {}

type InterruptReason = "user" | "shutdown"

export function terminal(exit: Exit.Exit<void, SessionRunner.RunError>, reason?: InterruptReason) {
  if (Exit.isSuccess(exit)) return { type: "succeeded" as const }
  if (Cause.hasInterrupts(exit.cause)) return { type: "interrupted" as const, reason: reason ?? "shutdown" }
  return { type: "failed" as const, error: toSessionError(Cause.squash(exit.cause)) }
}

/** Process-local execution: drains run in this process using the selected instance. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const instances = yield* Instance.Service
    const bus = yield* Bus.Service
    const jobs = yield* Job.Service
    const inbox = yield* SessionInbox.Service
    const db = (yield* Database.Service).db
    const reportLifecycle = <A>(sessionID: SessionSchema.ID, effect: Effect.Effect<A>) =>
      effect.pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError("Failed to publish Session execution lifecycle", cause).pipe(
                Effect.annotateLogs({ sessionID }),
              ),
        ),
        Effect.asVoid,
      )
    // Write-ahead claim: starting records the durable intent that a turn is in flight, in the same
    // transaction as the started event. Terminals release it — except shutdown interruption, which
    // preserves the claim so the next server start resumes the turn. A claim that survives with no
    // terminal is the signature of a process that died without teardown (crash, SIGKILL, eviction);
    // recovery is a property of the database, never of a shutdown hook that may not run.
    const claimOnCommit = (sessionID: SessionSchema.ID) => ({
      commit: () => store.claim(sessionID),
    })
    // The report coordinator is built first so the run coordinator's hooks can use it, while its
    // wake and draining dependencies bind late to the coordinator the hooks belong to.
    const holder: {
      coordinator?: SessionRunCoordinator.Coordinator<SessionSchema.ID, SessionRunner.RunError, InterruptReason>
    } = {}
    const subagentReport = SubagentReport.make({
      store,
      jobs,
      inbox,
      wake: (sessionID) =>
        Effect.suspend(() => (holder.coordinator ? holder.coordinator.wake(sessionID) : Effect.void)),
      draining: Effect.suspend<ReadonlySet<SessionSchema.ID>, never, never>(() =>
        holder.coordinator ? holder.coordinator.draining : Effect.succeed(new Set<SessionSchema.ID>()),
      ),
    })
    // Why a Session's execution is being interrupted, read from the coordinator once it exists.
    let interruption: (sessionID: SessionSchema.ID) => InterruptReason | undefined = () => undefined
    const drain = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      force: boolean,
      continuation?: SessionRunner.Continuation,
      promotable: SessionInbox.Promotable = "input",
      stepped = false,
    ): Effect.fn.Return<void, SessionRunner.RunError> {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      const result = yield* SessionRunner.Service.use((runner) =>
        runner.drain({
          sessionID,
          force,
          continuation,
          promotable,
          stepped,
          interruption: () => interruption(sessionID),
        }),
      ).pipe(
        instances.provide(session),
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
        ),
      )
      return yield* SessionRunner.DrainResult.$match(result, {
        Complete: () => Effect.void,
        Moved: (result) => drain(sessionID, false, result.continuation, promotable, result.stepped),
        Reloaded: (result) => drain(sessionID, result.force, result.continuation, promotable, result.stepped),
      })
    })
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError, InterruptReason>({
      started: (sessionID) =>
        reportLifecycle(
          sessionID,
          Effect.gen(function* () {
            // Bind before the started publication yields to SQLite so a cancel arriving during
            // that window still matches this generation.
            const before = yield* jobs.currentGeneration(sessionID)
            const event = yield* bus.publish(SessionEvent.Execution.Started, { sessionID }, claimOnCommit(sessionID))
            const bound = before?.running ? before : yield* jobs.currentGeneration(sessionID)
            subagentReport.started(sessionID, {
              startedSeq: event.durable.seq,
              boundGeneration: bound?.running ? bound.generation : undefined,
            })
          }),
        ),
      drain: (sessionID, force, promotable) => drain(sessionID, force, undefined, promotable),
      // One terminal observation per busy period, covering every coalesced drain.
      settled: (sessionID, exit, reason) =>
        reportLifecycle(
          sessionID,
          Effect.gen(function* () {
            const outcome = terminal(exit, reason)
            if (outcome.type === "interrupted" && outcome.reason === "shutdown") {
              subagentReport.clear(sessionID)
              // Shutdown keeps the claim and the running Job row for restart continuity.
              yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown" })
              return
            }
            // Classify and claim the Job generation before cancelling it: the settlement commit
            // owns the outbox row, and a cancel must not race a foreground classification.
            const settlement = yield* subagentReport.prepare(sessionID, outcome)
            if (outcome.type === "interrupted") yield* jobs.cancel(sessionID)
            yield* publishTerminal(bus, sessionID, outcome, settlement.commit)
            // Post-commit delivery is best effort: a retained outbox marker is recovered on the
            // next restart, and a delivery defect must not fail the settled hook.
            yield* settlement.deliver.pipe(
              Effect.ignoreCause({ log: "Error", message: "Subagent report delivery failed" }),
            )
          }),
        ),
    })
    holder.coordinator = coordinator

    interruption = coordinator.interruption
    return Service.of({
      active: coordinator.active,
      isActive: coordinator.isActive,
      periodStartSeq: subagentReport.periodStartSeq,
      interrupt: (sessionID, options) =>
        Effect.gen(function* () {
          const interrupted = yield* coordinator.interrupt(sessionID, "user")
          if (!options?.resume) return interrupted
          // Resume steering input and between-turn control work from the interrupted
          // intent. Queued next-turn prompts stay parked: a steer-scoped drain never
          // promotes them, and a control item behind a queued prompt waits its turn.
          // Interruption acknowledges before cleanup settles, so this wake usually lands
          // on the stopping execution's doorbell and starts the successor at settle.
          // Reading the inbox concurrently with the dying drain is safe: delivery consumes
          // rows inside uninterruptible publications, so a steer row is either still
          // promotable here or was fully delivered and needs no resumption.
          const next = yield* SessionInbox.nextPromotable(db, sessionID, "input")
          if (next === undefined) return interrupted
          if (next.delivery === "steer" || next.type === "compaction" || next.type === "move")
            yield* coordinator.wake(sessionID, "steer")
          return interrupted
        }),
      resume: coordinator.run,
      wake: coordinator.wake,
      awaitIdle: coordinator.awaitIdle,
    })
  }),
)

/** Publishes the terminal event with the settlement's atomic commit. */
function publishTerminal(
  bus: Bus.Interface,
  sessionID: SessionSchema.ID,
  outcome: ReturnType<typeof terminal>,
  commit: (seq: number) => Effect.Effect<void>,
) {
  if (outcome.type === "succeeded") return bus.publish(SessionEvent.Execution.Succeeded, { sessionID }, { commit })
  if (outcome.type === "interrupted") {
    return bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: outcome.reason }, { commit })
  }
  return bus.publish(SessionEvent.Execution.Failed, { sessionID, error: outcome.error }, { commit })
}

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionStore.node, Instance.node, Bus.node, Database.node, Job.node, SessionInbox.node],
})

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    isActive: () => Effect.succeed(false),
    resume: () => Effect.void,
    wake: () => Effect.void,
    periodStartSeq: () => Effect.succeed(undefined),
    interrupt: () => Effect.succeed(false),
    awaitIdle: () => Effect.void,
  }),
)
