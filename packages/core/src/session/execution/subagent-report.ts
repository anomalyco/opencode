export * as SubagentReport from "./subagent-report.js"

import { Effect } from "effect"
import type { Job } from "../../job.js"
import { SessionInbox } from "../inbox.js"
import { SessionMessage } from "../message.js"
import type { SessionSchema } from "../schema.js"
import type { SessionStore } from "../store.js"
import { SubagentCompletion } from "../subagent-completion.js"
import { SubagentMetadata } from "../subagent-metadata.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

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
  readonly remembered: boolean
  /** The child's newest answer when the period began; undefined when that was never read. */
  readonly baseline: { readonly id: SessionMessage.ID | undefined } | undefined
}

export type Deps = {
  readonly store: SessionStore.Interface
  readonly jobs: Job.Interface
  readonly inbox: SessionInbox.Interface
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** True while the child still has background work or undelivered input that will wake it again. */
  readonly pending: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
}

/**
 * Reports a settled subagent busy period to its parent, once per busy period, through a local
 * inbox adapter. Observers and restart recovery keep their own delivery: every path admits the
 * same notification ID, so first admission wins and the parent sees one message.
 */
export const make = (deps: Deps) => {
  // Busy periods that began with a running job. That job owns its report whenever it finishes or
  // is cancelled before settlement, so settlement must not send a second one.
  const jobPeriods = new Set<SessionSchema.ID>()
  // Children whose last succeeded period held its report for background work. Process-local: after
  // a restart, recovery and background notices wake the child instead.
  const held = new Set<SessionSchema.ID>()
  // A child's newest answer when its busy period began, so settlement can tell a period that
  // produced no new answer. Process-local, like held.
  const baselines = new Map<SessionSchema.ID, SessionMessage.ID | undefined>()

  // The same assistant message the SubagentJob run and restart recovery read: the newest
  // completed assistant answer, whose text becomes the report body.
  const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
    const messages = yield* deps.store.messages({ sessionID, order: "desc", limit: 20 })
    return messages.find(
      (message) => message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
    )
  })

  const started = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
    const job = yield* deps.jobs.get(sessionID)
    if (job?.status === "running") jobPeriods.add(sessionID)
    // A finished entry from an earlier generation must not make a re-prompt silently reconcile.
    else jobPeriods.delete(sessionID)
    baselines.delete(sessionID)
    if (!(yield* deps.store.get(sessionID))?.parentID) return
    baselines.set(sessionID, (yield* lastAssistant(sessionID))?.id)
  })

  const snapshot = Effect.fnUntraced(function* (sessionID: SessionSchema.ID): Effect.fn.Return<Snapshot> {
    const remembered = jobPeriods.delete(sessionID)
    const baseline = baselines.has(sessionID) ? { id: baselines.get(sessionID) } : undefined
    baselines.delete(sessionID)
    return {
      blocked: yield* deps.jobs.isBlocked(sessionID),
      job: yield* deps.jobs.get(sessionID),
      recovery: yield* deps.jobs.recovery(sessionID),
      remembered,
      baseline,
    }
  })

  const report = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, outcome: Outcome, snap: Snapshot) {
    // Shutdown keeps the claim, and restart owns the report that resumes it.
    if (outcome.type === "interrupted" && outcome.reason === "shutdown") return
    // Every settlement decides afresh; a period that holds again re-adds the child below.
    const owed = held.delete(sessionID)
    const child = yield* deps.store.get(sessionID)
    if (!child?.parentID) return
    const parentID = child.parentID
    if (!SubagentMetadata.notify(child.metadata)) {
      // A silent descendant sends no notice, so wake a held parent to report its final state. The
      // wake runs no model step when the parent has no input.
      if (held.has(parentID) && (yield* deps.store.get(parentID))) yield* deps.wake(parentID)
      return
    }
    if (!(yield* deps.store.get(parentID))) return
    // A foreground caller receives this result inline through its own blocking registration.
    if (snap.blocked) return
    const live = snap.job?.status === "running" ? snap.job : undefined
    // A running job without a notification is a foreground spawn whose block has not registered,
    // or one whose block already returned. Either way that job owns the result.
    if (live && !live.notificationID) return
    // A job that finished or was cancelled mid-period already reported through its observer.
    if (!live && snap.remembered) return
    // The child's own background work will wake it again, and that later settlement reports the
    // final state. Failures and user interrupts report now.
    if (outcome.type === "succeeded" && (yield* deps.pending(child.id))) {
      held.add(child.id)
      return
    }

    const recovery = subagentRecovery(live?.notificationID ? snap.recovery : undefined, child, parentID)
    const status = outcome.type === "succeeded" ? "completed" : outcome.type === "interrupted" ? "cancelled" : "error"
    const assistant = status === "completed" ? yield* lastAssistant(child.id) : undefined
    // A period that succeeded without finishing an assistant message was not a turn: a move, a
    // compaction or a recovered notice settles that way, and a spawn that never ran reports
    // through the tool's inline error instead.
    if (status === "completed" && assistant === undefined) return
    // A no-input wake (a silent descendant's release, or a resume) runs no model step and must not
    // re-send an answer the parent already has.
    if (status === "completed" && !owed && snap.baseline !== undefined && snap.baseline.id === assistant?.id) return
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
