export * as SubagentReport from "./subagent-report.js"

import { Clock, DateTime, Effect, Fiber, Scope } from "effect"
import type { Job } from "../../job.js"
import { SessionInbox } from "../inbox.js"
import { SessionMessage } from "../message.js"
import type { SessionSchema } from "../schema.js"
import type { SessionStore } from "../store.js"
import { SubagentCompletion } from "../subagent-completion.js"
import { SubagentMetadata } from "../subagent-metadata.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

type Bound = {
  readonly generation: number
  settled: Job.Info | undefined
  fiber: Fiber.Fiber<void> | undefined
}

/** The terminal outcome of one busy period, the same mapping execution publishes. */
export type Outcome =
  | { readonly type: "succeeded" }
  | { readonly type: "failed"; readonly error: { readonly message: string } }
  | { readonly type: "interrupted"; readonly reason: "user" | "shutdown" }

/**
 * Job state read at settlement. Cancellation, backgrounding and job completion all clear it, so
 * the snapshot must be taken before any of those happen in the same busy period.
 */
export type Snapshot = {
  readonly blocked: boolean
  readonly job: Job.Info | undefined
  readonly recovery: Job.Recovery | undefined
  /**
   * The job generation running when this period began was cancelled during it, so its observer or
   * its cancelled caller already owns the result.
   */
  readonly owned: boolean
  /** The running job's notification ID already admitted before this period began, if any. */
  readonly spent: SessionMessage.ID | undefined
  /** Where this period began; undefined when `started` never recorded it. */
  readonly start: Start | undefined
}

/**
 * Where a busy period began: the clock reading when it started and the child's newest answer at
 * that moment. Both are needed. The reading alone misses an answer that completes in the same
 * millisecond the next period starts, and the answer alone fails once a committed revert deletes
 * that row.
 */
export type Start = {
  /** Clock reading on the same clock that stamps event and assistant completion times. */
  readonly at: number
  /** The child's newest answer when the period began, if it had one. */
  readonly answer: SessionMessage.ID | undefined
}

export type Deps = {
  readonly store: SessionStore.Interface
  readonly jobs: Job.Interface
  readonly inbox: SessionInbox.Interface
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** True while the child still has background work or undelivered input that will wake it again. */
  readonly pending: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  /** Long-lived scope for per-period job watchers. */
  readonly scope: Scope.Scope
}

/**
 * Reports a settled subagent busy period to its parent, once per busy period, through a local
 * inbox adapter. The first report shares the job's notification ID with its observer and restart
 * recovery, so their later deliveries dedupe. A later period of that still-running job gets a fresh
 * ID when the original was already admitted before it began. Holds are durable on the Session and
 * released only after admission or an explicit no-report decision.
 */
export const make = (deps: Deps) => {
  // The job generation running when a busy period began, and where that period began. Its watcher
  // records that generation's terminal when it settles within the period, because only a
  // cancellation there owns the period's report: completion or failure is settling an earlier
  // period. Dropped at settlement.
  const periods = new Map<
    SessionSchema.ID,
    { readonly job: Bound | undefined; readonly start: Start; readonly spent: SessionMessage.ID | undefined }
  >()

  /**
   * The newest answer that completed at or after the busy period began. `since` comes from the
   * period's start, so an answer the parent already has, or one that finished before this period,
   * never reports again. A period with no recorded start falls back to unbounded.
   */
  const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, since: Start | undefined) {
    const messages = yield* deps.store.messages({ sessionID, order: "desc", limit: 20, type: "assistant" })
    // The answer a period starts with can complete in the same millisecond the next period starts,
    // so it is excluded by ID as well as by time. A committed revert can delete that row mid-period:
    // a missing anchor then bounds by time alone, never as a store cursor, which would read [].
    const end = messages.findIndex((message) => message.id === since?.answer)
    return messages
      .slice(0, end === -1 ? undefined : end)
      .find(
        (message) =>
          message.type === "assistant" &&
          message.time.completed !== undefined &&
          message.error === undefined &&
          (since === undefined || DateTime.toEpochMillis(message.time.completed) >= since.at),
      )
  })

  const started = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
    // A record left behind means the previous period never settled; drop its watcher so it cannot
    // write into this one.
    const leftover = periods.get(sessionID)
    if (leftover) {
      periods.delete(sessionID)
      if (leftover.job?.fiber) yield* Fiber.interrupt(leftover.job.fiber)
    }
    // Read the clock before any step runs: the start must be on the clock that stamps every event
    // and assistant completion.
    const at = yield* Clock.currentTimeMillis
    const child = yield* deps.store.get(sessionID)
    // Only children report, so a top-level period costs no message read.
    const answer = child?.parentID ? (yield* lastAssistant(sessionID, undefined))?.id : undefined
    const start: Start = { at, answer }
    const job = yield* deps.jobs.get(sessionID)
    // Decide reuse at start, not settlement: on failure the observer can admit this same period's
    // notification before report runs. A hold alone is not admission; reconcile also finds messages
    // already delivered to the parent. Conflicting IDs are unusable but must not lose the boundary.
    const spent =
      child?.parentID && job?.status === "running" && job.notificationID !== undefined
        ? yield* deps.inbox
            .reconcile({ id: job.notificationID, sessionID: child.parentID, type: "synthetic", delivery: "steer" })
            .pipe(
              Effect.map((existing) => (existing === undefined ? undefined : job.notificationID)),
              Effect.catchTag("SessionInbox.LifecycleConflict", () => Effect.succeed(job.notificationID)),
            )
        : undefined
    // A finished entry from an earlier generation must not make a re-prompt silently reconcile.
    if (job?.status !== "running") periods.set(sessionID, { job: undefined, start, spent })
    else {
      const bound: Bound = { generation: job.started_at, settled: undefined, fiber: undefined }
      // Record before forking: startImmediately can run the watcher inline when this generation
      // already settled. Every write is guarded by the record, so an old watcher cannot mark a
      // later period.
      periods.set(sessionID, { job: bound, start, spent })
      bound.fiber = yield* deps.jobs.wait({ id: sessionID }).pipe(
        Effect.flatMap((result) =>
          Effect.sync(() => {
            if (periods.get(sessionID)?.job !== bound) return
            const info = result.info
            if (info === undefined || info.status === "running" || info.started_at !== bound.generation) return
            bound.settled = info
          }),
        ),
        Effect.forkIn(deps.scope, { startImmediately: true }),
      )
    }
  })

  const snapshot = Effect.fnUntraced(function* (sessionID: SessionSchema.ID): Effect.fn.Return<Snapshot> {
    const period = periods.get(sessionID)
    periods.delete(sessionID)
    const job = yield* deps.jobs.get(sessionID)
    const bound = period?.job
    // A cancellation whose watcher continuation has not been scheduled yet: the entry still names
    // the generation that began this period.
    const settled =
      bound?.settled ??
      (bound !== undefined && job !== undefined && job.status !== "running" && job.started_at === bound.generation
        ? job
        : undefined)
    // Read the watcher's write before interrupting it, or a resumed continuation loses it.
    if (bound?.fiber) yield* Fiber.interrupt(bound.fiber)
    return {
      blocked: yield* deps.jobs.isBlocked(sessionID),
      job,
      recovery: yield* deps.jobs.recovery(sessionID),
      owned: settled?.status === "cancelled",
      spent: period?.spent,
      start: period?.start,
    }
  })

  const report = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, outcome: Outcome, snap: Snapshot) {
    // Shutdown keeps the claim, and restart owns the report that resumes it.
    if (outcome.type === "interrupted" && outcome.reason === "shutdown") return
    const child = yield* deps.store.get(sessionID)
    if (!child?.parentID) return
    const parentID = child.parentID
    const held = yield* deps.store.heldReport(child.id)
    const drop = held === undefined ? Effect.void : deps.store.releaseReport(child.id)
    if (!SubagentMetadata.notify(child.metadata)) {
      yield* drop
      // A silent descendant sends no notice, so wake the nearest held ancestor to report its final
      // state; silent sessions between them never hold. The wake runs no model step without input.
      const seen = new Set([child.id])
      let ancestor = yield* deps.store.get(parentID)
      while (ancestor && !seen.has(ancestor.id)) {
        if (ancestor.parentID && (yield* deps.store.heldReport(ancestor.id)) !== undefined)
          return yield* deps.wake(ancestor.id)
        seen.add(ancestor.id)
        ancestor = ancestor.parentID ? yield* deps.store.get(ancestor.parentID) : undefined
      }
      return
    }
    if (!(yield* deps.store.get(parentID))) return yield* drop
    // A foreground caller receives this result inline through its own blocking registration.
    if (snap.blocked) return yield* drop
    const live = snap.job?.status === "running" ? snap.job : undefined
    const reusable = live?.notificationID !== snap.spent ? live?.notificationID : undefined
    // A running job without a notification is a foreground spawn whose block has not registered,
    // or one whose block already returned. Either way that job owns the result.
    if (live && !live.notificationID) return yield* drop
    // A generation that began this period and was cancelled during it already reported through its
    // observer or its cancelled caller. One that completed or failed during the period was settling
    // an earlier period, so this period still reports its own answer with a fresh message ID.
    if (!live && snap.owned) return yield* drop
    // The child's own background work will wake it again, and that later settlement reports the
    // final state. Failures and user interrupts report now. Persist the hold before asking, so a
    // silent descendant settling meanwhile sees it and wakes this child. Keep the first ID and
    // boundary, including an unbounded start, across every period until admission succeeds. Only
    // a notification already admitted before this period needs a fresh identity.
    const owed =
      outcome.type === "succeeded"
        ? yield* deps.store.holdReport(child.id, {
            notificationID: reusable ?? SessionMessage.ID.create(),
            since: snap.start,
          })
        : held
    if (outcome.type === "succeeded") {
      if (owed === undefined) return
      if (yield* deps.pending(child.id)) return
    }

    const since = owed === undefined ? snap.start : owed.since
    const release = owed === undefined ? Effect.void : deps.store.releaseReport(child.id)
    const recovery = subagentRecovery(live?.notificationID ? snap.recovery : undefined, child, parentID)
    const status = outcome.type === "succeeded" ? "completed" : outcome.type === "interrupted" ? "cancelled" : "error"
    const assistant = status === "completed" ? yield* lastAssistant(child.id, since) : undefined
    // A period that succeeded without finishing an answer of its own was not a turn: a move, a
    // compaction, a recovered notice or a no-input wake settles that way, and a spawn that never ran
    // reports through the tool's inline error instead.
    if (status === "completed" && assistant === undefined) return yield* release
    const output = status === "completed" ? SubagentCompletion.text(assistant) : undefined
    const error = outcome.type === "failed" ? outcome.error.message : undefined
    const notificationID = reusable ?? owed?.notificationID

    yield* SubagentCompletion.deliver(
      // Mirrors Session.synthetic without Session.Service: admit one steer synthetic, then wake
      // only a live parent that is not staging a revert.
      {
        synthetic: (input) =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              const admitted = yield* deps.inbox.admit({
                id: input.id ?? SessionMessage.ID.create(),
                sessionID: input.sessionID,
                item: {
                  type: "synthetic",
                  payload: SessionInbox.SyntheticPayload.make({
                    text: input.text,
                    description: input.description,
                    metadata: input.metadata,
                  }),
                  delivery: "steer",
                },
              })
              if (input.resume !== false && !(yield* deps.store.get(input.sessionID))?.revert)
                yield* deps.wake(input.sessionID)
              return admitted
            }),
          ),
      },
      // The durable marker outlives admission: the job's observer or restart clears it with the
      // same ID later. Clearing it here would erase a row those paths still reconcile against.
      { completeBackground: () => Effect.void },
      {
        status,
        ...(output === undefined ? {} : { output }),
        ...(error === undefined ? {} : { error }),
        ...(notificationID === undefined ? {} : { notificationID }),
        recovery,
      },
    ).pipe(Effect.andThen(release), Effect.uninterruptible)
  })

  return { started, snapshot, report }
}

/** A live job's recovery already carries the spawn's agent name and description. */
function subagentRecovery(
  recovery: Job.Recovery | undefined,
  child: SessionSchema.Info,
  parentID: SessionSchema.ID,
): Recovery {
  if (recovery?.kind === "subagent") return recovery
  return {
    kind: "subagent",
    parentSessionID: parentID,
    childSessionID: child.id,
    agent: child.agent ?? "subagent",
    description: child.title ?? "Subagent",
  }
}
