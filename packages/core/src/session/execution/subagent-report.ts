export * as SubagentReport from "./subagent-report.js"

import { Automation } from "@opencode/schema/automation"
import { Duration, Effect, Fiber, Result, type Scope } from "effect"
import { CodeModeAgents } from "../../codemode/agents.js"
import type { Job } from "../../job.js"
import { SessionBackground } from "../background.js"
import { SessionInbox } from "../inbox.js"
import { SessionMessage } from "../message.js"
import type { SessionSchema } from "../schema.js"
import type { SessionStore } from "../store.js"
import { SubagentCompletion } from "../subagent-completion.js"

/** Maximum time a nested parent's completed-child wake is held waiting for running siblings. */
export const DEFAULT_MAX_COALESCE_DELAY = Duration.seconds(60)

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
  readonly scope?: Scope.Scope
  readonly maxCoalesceDelay?: Duration.Input
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

type PendingWake = {
  timer?: Fiber.Fiber<void>
}

export const make = (deps: Deps) => {
  const periods = new Map<SessionSchema.ID, Period>()
  const pendingWakes = new Map<SessionSchema.ID, PendingWake>()
  const maxCoalesceDelay = deps.maxCoalesceDelay ?? DEFAULT_MAX_COALESCE_DELAY

  const started = (sessionID: SessionSchema.ID, period: Period) => {
    periods.set(sessionID, period)
  }

  const clear = (sessionID: SessionSchema.ID) => {
    periods.delete(sessionID)
  }

  const clearPendingWake = (parentID: SessionSchema.ID) =>
    Effect.suspend(() => {
      const entry = pendingWakes.get(parentID)
      if (!entry) return Effect.succeed(false)
      pendingWakes.delete(parentID)
      return (entry.timer ? Fiber.interrupt(entry.timer) : Effect.void).pipe(Effect.as(true))
    })

  // Checks whether `parentID` still has another direct subagent child actively running.
  // Only direct children are considered because deeper descendants report to their own parent.
  // Code Mode `agent()` children are excluded: their parent awaits them directly inside `execute`.
  const hasRunningSibling = Effect.fnUntraced(function* (parentID: SessionSchema.ID, excludeChildID: SessionSchema.ID) {
    const running = yield* deps.jobs.runningBackground
    for (const recovery of running) {
      if (
        recovery.kind === "subagent" &&
        recovery.parentSessionID === parentID &&
        recovery.childSessionID !== excludeChildID
      ) {
        return true
      }
    }
    const draining = yield* deps.draining
    for (const activeID of draining) {
      if (activeID === excludeChildID || activeID === parentID || Automation.isRunSession(activeID)) continue
      const tracked = yield* deps.jobs.get(activeID)
      if (tracked?.status === "cancelled") continue
      const info = yield* deps.store.get(activeID)
      if (info?.parentID === parentID && CodeModeAgents.sessionMarker(activeID, info.metadata) === undefined) {
        return true
      }
    }
    return false
  })

  const armCoalesceTimer = Effect.fnUntraced(function* (parentID: SessionSchema.ID, entry: PendingWake) {
    if (!deps.scope || pendingWakes.get(parentID) !== entry || entry.timer !== undefined) return
    const fiber = yield* Effect.sleep(maxCoalesceDelay).pipe(
      Effect.andThen(
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (pendingWakes.get(parentID) !== entry) return
            pendingWakes.delete(parentID)
            const currentParent = yield* deps.store.get(parentID)
            if (!currentParent || currentParent.revert) return
            yield* Effect.logDebug("Subagent report coalesce hold expired; waking parent", { parentID })
            yield* deps.wake(parentID)
          }),
        ),
      ),
      Effect.forkIn(deps.scope),
    )
    if (pendingWakes.get(parentID) === entry && entry.timer === undefined) {
      entry.timer = fiber
      return
    }
    yield* Fiber.interrupt(fiber)
  })

  // Flushes a previously deferred parent wake when a sibling settles without delivering a report
  // (e.g. an empty/control-only period, deleted child, or inbox conflict) so admitted reports
  // are never stranded in the parent's inbox.
  const flushPendingWake = Effect.fnUntraced(function* (parentID: SessionSchema.ID, excludeChildID: SessionSchema.ID) {
    if (!pendingWakes.has(parentID)) return
    if (yield* hasRunningSibling(parentID, excludeChildID)) return
    const parent = yield* deps.store.get(parentID)
    if (!(yield* clearPendingWake(parentID))) return
    if (!parent || parent.revert) return
    yield* Effect.logDebug("Flushing deferred nested parent wake", { parentID, childSessionID: excludeChildID })
    yield* deps.wake(parentID)
  })

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
      yield* clearPendingWake(parentID)
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
      // Retain the outbox row: the conflict proves the notification ID is already
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
    if (!delivered) {
      yield* flushPendingWake(parentID, report.recovery.childSessionID)
      return
    }
    const parent = yield* deps.store.get(parentID)
    if (!parent || parent.revert) {
      yield* clearPendingWake(parentID)
      return
    }
    // Coalesce completed wakes for nested subagent parents while sibling subagents are still
    // running, avoiding one parent turn (and cascading grandparent report) per finishing sibling.
    // Top-level parents face the user directly, so every completion still wakes them immediately;
    // errors and cancellations always wake immediately at every depth.
    if (report.status === "completed" && parent.parentID !== undefined) {
      // Mark before checking siblings so a sibling settling concurrently with no report
      // still sees the deferred wake and flushes it once no siblings remain.
      const entry = pendingWakes.get(parentID) ?? {}
      pendingWakes.set(parentID, entry)
      if (yield* hasRunningSibling(parentID, report.recovery.childSessionID)) {
        yield* Effect.logDebug("Deferring nested parent wake while sibling subagents are still running", {
          parentID,
          childSessionID: report.recovery.childSessionID,
        })
        yield* armCoalesceTimer(parentID, entry)
        return
      }
    }
    yield* clearPendingWake(parentID)
    yield* deps.wake(parentID)
  })

  const prepare = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
    outcome: Exclude<Outcome, { readonly type: "interrupted"; readonly reason: "shutdown" }>,
  ) {
    const period = periods.get(sessionID)
    periods.delete(sessionID)
    const jobState = yield* deps.jobs.prepareSubagentReport(sessionID, period?.boundGeneration)
    const initial = yield* deps.store.get(sessionID)
    // An automation run's child finishes quietly; only a follow-up the parent sent through a Job reports back.
    if ((!initial?.parentID || Automation.isRunSession(sessionID)) && jobState.mode === "none") {
      return {
        commit: () => deps.store.release(sessionID),
        deliver: initial?.parentID
          ? Effect.uninterruptible(flushPendingWake(initial.parentID, sessionID))
          : Effect.void,
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
        if (!child?.parentID || !parent) {
          if (jobState.mode === "background") {
            yield* deps.jobs.deleteBackgroundRow(jobState.notificationID)
            box.postCommit = { type: "cleanup", notificationID: jobState.notificationID }
          }
          return
        }
        const resolved = yield* resolveBody(sessionID, outcome, period?.startedSeq, jobState.mode)
        if (!resolved) return
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
          recovery: { ...recovery, outstanding: running },
          status: resolved.status,
          ...(resolved.status === "completed" ? { output: resolved.body } : { error: resolved.body }),
          ...(jobState.mode === "background" ? { startedAt: jobState.startedAt } : {}),
        }
        yield* deps.jobs.recordSubagentReport(report)
        box.postCommit = { type: "deliver", report }
      })

    const fallbackParentID = jobState.mode === "background" ? jobState.recovery.parentSessionID : initial?.parentID

    const deliver = Effect.uninterruptible(
      Effect.suspend(() => {
        const current = box.postCommit
        if (current.type === "none") {
          return fallbackParentID ? flushPendingWake(fallbackParentID, sessionID) : Effect.void
        }
        if (current.type === "cleanup") {
          return deps.jobs
            .completeBackground(current.notificationID)
            .pipe(Effect.andThen(fallbackParentID ? flushPendingWake(fallbackParentID, sessionID) : Effect.void))
        }
        return deliverReport(current.report)
      }),
    )

    return { commit, deliver }
  })

  return { started, clear, prepare }
}
