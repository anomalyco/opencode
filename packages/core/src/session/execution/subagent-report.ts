export * as SubagentReport from "./subagent-report.js"

import { Effect, Result } from "effect"
import type { Job } from "../../job.js"
import { SessionBackground } from "../background.js"
import { SessionInbox } from "../inbox.js"
import { SessionMessage } from "../message.js"
import type { SessionSchema } from "../schema.js"
import type { SessionStore } from "../store.js"
import { SubagentCompletion } from "../subagent-completion.js"
import { SubagentMetadata } from "../subagent-metadata.js"

export type Outcome =
  | { readonly type: "succeeded" }
  | { readonly type: "failed"; readonly error: { readonly message: string } }
  | { readonly type: "interrupted"; readonly reason: "user" | "shutdown" }

export type Period = {
  readonly startedSeq: number
  readonly boundGeneration?: number
}

export type Deps = {
  readonly store: Pick<SessionStore.Interface, "get" | "lastAssistantAfter" | "release">
  readonly jobs: Job.Interface
  readonly inbox: Inbox
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly draining: Effect.Effect<ReadonlySet<SessionSchema.ID>>
}

/** Narrow inbox admission so delivery does not depend on the full lifecycle service shape. */
export type Inbox = {
  readonly admit: (request: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly item: SessionInbox.Item
  }) => Effect.Effect<unknown, SessionInbox.LifecycleConflict>
}

type PostCommit =
  | { readonly type: "none" }
  | { readonly type: "cleanup"; readonly notificationID: SessionMessage.ID }
  | { readonly type: "deliver"; readonly report: Job.SubagentOutboxReport }

export const make = (deps: Deps) => {
  const periods = new Map<SessionSchema.ID, Period>()

  const started = (sessionID: SessionSchema.ID, period: Period) => {
    periods.set(sessionID, period)
  }

  const clear = (sessionID: SessionSchema.ID) => {
    periods.delete(sessionID)
  }

  const periodStartSeq = (sessionID: SessionSchema.ID) => Effect.succeed(periods.get(sessionID)?.startedSeq)

  const resolveBody = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
    outcome: Exclude<Outcome, { readonly type: "interrupted"; readonly reason: "shutdown" }>,
    startedSeq: number | undefined,
    mode: "background" | "none",
  ): Effect.fn.Return<{ readonly status: Exclude<Job.Status, "running">; readonly body: string } | undefined> {
    if (outcome.type === "failed") return { status: "error", body: outcome.error.message }
    if (outcome.type === "interrupted") return { status: "cancelled", body: "Subagent cancelled" }
    // A corrupt message row must not abort the release or skip the outbox row.
    const assistant = yield* deps.store.lastAssistantAfter({ sessionID, afterSeq: startedSeq }).pipe(Effect.result)
    if (Result.isFailure(assistant)) return { status: "error", body: assistant.failure.message }
    if (assistant.success !== undefined) {
      return { status: "completed", body: SubagentCompletion.text(assistant.success) }
    }
    // An empty wake or control-only period has no result to report unless a Job promised one.
    if (mode === "background") return { status: "completed", body: SubagentCompletion.NO_TEXT }
    return undefined
  })

  const deliverReport = Effect.fnUntraced(function* (report: Job.SubagentOutboxReport) {
    const parentID = report.recovery.parentSessionID
    if (!(yield* deps.store.get(parentID))) {
      yield* deps.jobs.completeBackground(report.notificationID)
      return
    }
    const delivered = yield* SubagentCompletion.deliver(
      {
        synthetic: (notice) =>
          deps.inbox.admit({
            id: notice.id ?? report.notificationID,
            sessionID: notice.sessionID,
            item: {
              type: "synthetic",
              payload: SessionInbox.SyntheticPayload.make({
                text: notice.text,
                description: notice.description,
                metadata: notice.metadata,
              }),
              delivery: "steer",
            },
          }),
      },
      deps.jobs,
      report,
    ).pipe(
      Effect.as(true),
      // Retain the formatted outbox row: the conflict proves the notification ID is already
      // owned elsewhere, so deleting it would lose the report without admitting anything.
      Effect.catchTag("SessionInbox.LifecycleConflict", (conflict) =>
        Effect.logWarning("Subagent report notification ID conflicted in parent inbox", {
          childSessionID: report.recovery.childSessionID,
          parentSessionID: parentID,
          notificationID: report.notificationID,
          conflict,
        }).pipe(Effect.as(false)),
      ),
      // The parent may be deleted in the microsecond after the read above, which surfaces as a
      // foreign-key defect from admission. Treat a missing parent as acknowledged work.
      Effect.catchDefect((defect) =>
        deps.store
          .get(parentID)
          .pipe(
            Effect.flatMap((parent) =>
              parent === undefined
                ? deps.jobs.completeBackground(report.notificationID).pipe(Effect.as(false))
                : Effect.die(defect),
            ),
          ),
      ),
    )
    if (!delivered) return
    const parent = yield* deps.store.get(parentID)
    if (parent && !parent.revert) yield* deps.wake(parentID)
  })

  const prepare = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
    outcome: Exclude<Outcome, { readonly type: "interrupted"; readonly reason: "shutdown" }>,
  ) {
    const period = periods.get(sessionID)
    periods.delete(sessionID)
    const jobState = yield* deps.jobs.prepareSubagentReport(sessionID, period?.boundGeneration)
    if (jobState.mode === "foreground") {
      return {
        commit: () => deps.store.release(sessionID),
        deliver: Effect.void,
      }
    }
    const initial = yield* deps.store.get(sessionID)
    if (!initial?.parentID && jobState.mode === "none") {
      return {
        commit: () => deps.store.release(sessionID),
        deliver: Effect.void,
      }
    }
    const running = initial?.parentID
      ? yield* SessionBackground.outstanding(deps.jobs, deps.store, sessionID, yield* deps.draining)
      : []

    const box: { postCommit: PostCommit } = { postCommit: { type: "none" } }

    // Runs inside Bus.publish's BEGIN IMMEDIATE transaction: pure flat db.* + Clock only.
    // Never touch Job's SynchronizedRef or open a nested transaction here.
    const commit = () =>
      Effect.gen(function* () {
        box.postCommit = { type: "none" }
        yield* deps.store.release(sessionID)
        const child = yield* deps.store.get(sessionID)
        const parent = child?.parentID ? yield* deps.store.get(child.parentID) : undefined
        if (!child?.parentID || !SubagentMetadata.notify(child.metadata) || !parent) {
          if (jobState.mode === "background") {
            yield* deps.jobs.deleteBackgroundRow(jobState.notificationID)
            box.postCommit = { type: "cleanup", notificationID: jobState.notificationID }
          }
          return
        }
        const resolved = yield* resolveBody(sessionID, outcome, period?.startedSeq, jobState.mode)
        if (!resolved) return
        const formatted = SubagentCompletion.formatBody(resolved.body, child.id, running)
        const recovery =
          jobState.mode === "background"
            ? jobState.recovery
            : {
                kind: "subagent" as const,
                parentSessionID: child.parentID,
                childSessionID: child.id,
                agent: child.agent ?? "subagent",
                description: child.title ?? "Subagent",
              }
        const report: Job.SubagentOutboxReport = {
          notificationID: jobState.mode === "background" ? jobState.notificationID : SessionMessage.ID.create(),
          recovery,
          status: resolved.status,
          ...(resolved.status === "completed" ? { output: formatted } : { error: formatted }),
          ...(jobState.mode === "background" ? { startedAt: jobState.startedAt } : {}),
        }
        yield* deps.jobs.recordSubagentReport(report)
        box.postCommit = { type: "deliver", report }
      })

    const deliver = Effect.uninterruptible(
      Effect.suspend(() => {
        const current = box.postCommit
        if (current.type === "none") return Effect.void
        if (current.type === "cleanup") return deps.jobs.completeBackground(current.notificationID)
        return deliverReport(current.report)
      }),
    )

    return { commit, deliver }
  })

  return { started, clear, periodStartSeq, prepare }
}
