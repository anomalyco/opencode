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
 * inbox adapter. Observers and restart recovery keep their own delivery: every path admits the
 * same notification ID, so first admission wins and the parent sees one message.
 */
export const make = (deps: Deps) => {
  // The job generation running when a busy period began, and where that period began. Its watcher
  // records that generation's terminal when it settles within the period, because only a
  // cancellation there owns the period's report: completion or failure is settling an earlier
  // period. Dropped at settlement.
  const periods = new Map<SessionSchema.ID, { readonly job: Bound | undefined; readonly start: Start }>()
  // Children whose last succeeded period held its report for background work, with the start of the
  // earliest period still owed. Process-local: after a restart, recovery and background notices wake
  // the child instead.
  const held = new Map<SessionSchema.ID, Start | undefined>()

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
    // A finished entry from an earlier generation must not make a re-prompt silently reconcile.
    if (job?.status !== "running") periods.set(sessionID, { job: undefined, start })
    else {
      const bound: Bound = { generation: job.started_at, settled: undefined, fiber: undefined }
      // Record before forking: startImmediately can run the watcher inline when this generation
      // already settled. Every write is guarded by the record, so an old watcher cannot mark a
      // later period.
      periods.set(sessionID, { job: bound, start })
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
      start: period?.start,
    }
  })

  const report = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, outcome: Outcome, snap: Snapshot) {
    // Shutdown keeps the claim, and restart owns the report that resumes it.
    if (outcome.type === "interrupted" && outcome.reason === "shutdown") return
    // Every settlement decides afresh; a period that holds again re-adds the child below, keeping
    // the start it first owed.
    const owed = held.has(sessionID)
    const since = owed ? held.get(sessionID) : snap.start
    held.delete(sessionID)
    const child = yield* deps.store.get(sessionID)
    if (!child?.parentID) return
    const parentID = child.parentID
    if (!SubagentMetadata.notify(child.metadata)) {
      // A silent descendant sends no notice, so wake the nearest held ancestor to report its final
      // state; silent sessions between them never hold. The wake runs no model step without input.
      const seen = new Set([child.id])
      let ancestor = yield* deps.store.get(parentID)
      while (ancestor && !held.has(ancestor.id) && !seen.has(ancestor.id)) {
        seen.add(ancestor.id)
        ancestor = ancestor.parentID ? yield* deps.store.get(ancestor.parentID) : undefined
      }
      if (ancestor && held.has(ancestor.id)) yield* deps.wake(ancestor.id)
      return
    }
    if (!(yield* deps.store.get(parentID))) return
    // A foreground caller receives this result inline through its own blocking registration.
    if (snap.blocked) return
    const live = snap.job?.status === "running" ? snap.job : undefined
    // A running job without a notification is a foreground spawn whose block has not registered,
    // or one whose block already returned. Either way that job owns the result.
    if (live && !live.notificationID) return
    // A generation that began this period and was cancelled during it already reported through its
    // observer or its cancelled caller. One that completed or failed during the period was settling
    // an earlier period, so this period still reports its own answer with a fresh message ID.
    if (!live && snap.owned) return
    // The child's own background work will wake it again, and that later settlement reports the
    // final state. Failures and user interrupts report now. Mark held before asking, so a silent
    // descendant settling meanwhile still wakes this child; a spurious wake sends nothing.
    if (outcome.type === "succeeded") {
      // Keep the start this child first owed, so a later hold still reports that answer or a newer
      // one rather than losing it to a period that produced nothing.
      if (!held.has(child.id)) held.set(child.id, since)
      if (yield* deps.pending(child.id)) return
      held.delete(child.id)
    }

    const recovery = subagentRecovery(live?.notificationID ? snap.recovery : undefined, child, parentID)
    const status = outcome.type === "succeeded" ? "completed" : outcome.type === "interrupted" ? "cancelled" : "error"
    const assistant = status === "completed" ? yield* lastAssistant(child.id, since) : undefined
    // A period that succeeded without finishing an answer of its own was not a turn: a move, a
    // compaction, a recovered notice or a no-input wake settles that way, and a spawn that never ran
    // reports through the tool's inline error instead.
    if (status === "completed" && assistant === undefined) return
    const output = status === "completed" ? SubagentCompletion.text(assistant) : undefined
    const error = outcome.type === "failed" ? outcome.error.message : undefined
    const notificationID = live?.notificationID

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
    )
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
