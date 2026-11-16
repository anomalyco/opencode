export * as SessionRestart from "./restart.js"

import { Cause, Context, DateTime, Deferred, Effect, Layer, Option, Schema } from "effect"
import { isReadonlyArrayNonEmpty } from "effect/Array"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Shell as ShellSchema } from "@opencode/schema/shell"
import { Bus } from "../../bus.js"
import { Database } from "../../database/database.js"
import { Instance } from "../../instance/service.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"
import { Shell } from "../../shell.js"
import { ShellTool } from "../../tool/plugin/shell.js"
import { SessionEvent } from "../event.js"
import { SessionExecution } from "../execution.js"
import { SessionHistory } from "../history.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { ImageNotice } from "../../image/notice.js"
import { ShellResult } from "../../shell/result.js"
import { SubagentCompletion } from "../subagent-completion.js"
import { SubagentJob } from "../subagent-job.js"
import { SubagentRecovery } from "../subagent-recovery.js"
import { SubagentTool } from "../../tool/plugin/subagent.js"
import { SessionMessage } from "../message.js"
import { StepFailedError } from "../error.js"

const CONTINUE_AFTER_SERVER_RESTART =
  "The server restarted while you were working. Continue from where you left off without repeating completed work."

const RESUME_EXHAUSTED = {
  type: "aborted",
  message: "Execution was interrupted repeatedly and will not be resumed automatically.",
} as const

export interface Options {
  /**
   * Times a single turn may be resumed before it is terminalized instead.
   * The counter is durable and only a terminal event resets it, so a turn
   * that keeps dying cannot crash-loop across restarts. Turns that complete
   * never accumulate: the budget is per-turn, not per-session.
   */
  readonly maxAttempts?: number
}

const DEFAULT_MAX_ATTEMPTS = 10

type Notices = Pick<Session.Interface, "synthetic">

export interface Interface {
  /**
   * Resumes Sessions whose execution claim was never released — turns orphaned
   * by a process that died without teardown, or interrupted by a graceful
   * shutdown (which preserves the claim on purpose). The claim is never
   * cleared here: only a terminal event releases it, so a death anywhere in
   * the resume path leaves the same orphaned claim for the next boot.
   */
  readonly resumeSuspendedSessions: Effect.Effect<void>
}

/**
 * Recovery for orphaned executions. Claims are written at turn start by
 * SessionExecution, so this sweep needs no cooperation from the previous
 * process: crash, SIGKILL, isolate eviction, and graceful restart all leave
 * the same durable signature.
 *
 * Recovery is at-least-once: local coordination prevents concurrent drains,
 * not repeated external side effects after a crash.
 *
 * The sweep assumes every orphaned claim's owner is dead. The managed-server
 * protocol guarantees this: a successor is only spawned after the previous
 * process is confirmed dead (client service `kill`/`evict` poll the PID), the
 * registration lock admits one managed server at a time, and unregistered
 * servers sharing the database never sweep. The service is inert until called
 * — the managed server invokes it at boot; embedders may call it from their
 * own start-up.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRestart") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const execution = yield* SessionExecution.Service
      const bus = yield* Bus.Service
      const jobs = yield* Job.Service
      const sessions = yield* Session.Service
      const instances = yield* Instance.Service
      const db = (yield* Database.Service).db
      const scope = yield* Effect.scope
      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      const preparedInFlight = new Set<SessionSchema.ID>()

      const wake = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        const owner = yield* store.get(sessionID)
        if (owner && !owner.revert) yield* execution.wake(sessionID)
      })

      const prepareResume = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, withinExecution = false) {
        // Durable before the resume runs, so a crash inside the resumed turn is
        // counted by the next sweep and the budget cannot be dodged.
        const attempts = yield* store.countResume(sessionID)
        if (attempts === undefined) return false
        if (attempts > maxAttempts) {
          // A prepared execution settles its own failure; other recovery paths
          // still terminalize here because they have not registered ownership.
          if (!withinExecution)
            yield* bus.publish(
              SessionEvent.Execution.Failed,
              { sessionID, error: RESUME_EXHAUSTED },
              { commit: () => store.release(sessionID) },
            )
          return false
        }
        yield* bus.publish(SessionEvent.Synthetic, {
          sessionID,
          text: CONTINUE_AFTER_SERVER_RESTART,
          description: "Continuing after restart",
          metadata: { notice: "restart" },
        })
        return true
      })

      const restartMessage = (background: Job.Background, recovery: Exclude<Job.Recovery, { kind: "subagent" }>) => {
        const state = background.status === "running" ? "cancelled" : background.status
        if (recovery.kind === "shell") {
          const text =
            background.status === "running"
              ? "Command cancelled because the server restarted"
              : state === "completed"
                ? (background.output ?? "Command completed")
                : state === "error"
                  ? (background.error ?? "Command failed")
                  : "Command cancelled"
          return {
            description: recovery.command,
            ...ShellResult.notification({
              jobID: background.id,
              shellID: recovery.shellID,
              command: recovery.command,
              state,
              text,
            }),
          }
        }
        const body =
          background.status === "running"
            ? `Image request for ${recovery.path} was cancelled because the server restarted.`
            : state === "completed"
              ? (background.output ?? `Image request finished. Saved image: ${recovery.path} (${recovery.model}).`)
              : state === "error"
                ? (background.error ?? `Image request failed for ${recovery.path}.`)
                : `Image request for ${recovery.path} was cancelled.`
        return {
          description: "Image generation",
          text: ImageNotice.text({ id: background.id, state, body }),
          metadata: {
            source: "experimental_image_generate",
            jobID: background.id,
            state,
            path: recovery.path,
          },
        }
      }

      const recoverToolJob = Effect.fnUntraced(function* (
        background: Job.Background,
        recovery: Exclude<Job.Recovery, { kind: "subagent" }>,
      ) {
        const delivered = yield* sessions
          .synthetic({
            id: background.notificationID,
            sessionID: recovery.sessionID,
            ...restartMessage(background, recovery),
            // Restart notices must not revive idle owners of long-lived background tools.
            // Interrupted executions resume separately after their notices are admitted.
            resume: false,
          })
          .pipe(
            Effect.as(true),
            // The owner may be deleted after the pending row was read; the notice is owed
            // to nobody, so acknowledge the row instead of failing the whole sweep.
            Effect.catchTag("Session.NotFoundError", () => Effect.succeed(true)),
            // Retain the owner's row: the conflict proves another item already owns the ID,
            // so deleting it would lose the notice without admitting anything.
            Effect.catchTag("Session.SyntheticConflictError", (error) =>
              Effect.logWarning("Failed to admit recovered tool notification due to ID conflict", {
                notificationID: background.notificationID,
                sessionID: recovery.sessionID,
                error,
              }).pipe(Effect.as(false)),
            ),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logWarning("Unexpected failure delivering recovered tool notification", {
                    notificationID: background.notificationID,
                    sessionID: recovery.sessionID,
                    cause,
                  }).pipe(Effect.as(false)),
            ),
          )
        if (!delivered) return
        yield* jobs.completeBackground(background.notificationID)
      })

      // The Shell of a session's Location, booted so it takes back the commands the daemon still runs for it.
      const shellOf = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        const session = yield* store.get(sessionID)
        if (!session) return undefined
        return yield* Effect.serviceOption(Shell.Service).pipe(
          instances.provide(session),
          Effect.map(Option.getOrUndefined),
          // The session's directory is gone: its commands are reported like any lost background work.
          Effect.catchTag("FileSystem.DirectoryNotFoundError", () => Effect.succeed(undefined)),
        )
      })

      // A shell job the previous server left running is watched again if its command is still known (running or
      // finished during the restart); otherwise it is reported as lost.
      const recoverShellJob = Effect.fnUntraced(function* (
        background: Job.Background,
        recovery: Extract<Job.Recovery, { kind: "shell" }>,
        notices: Notices,
        reattached: Set<string>,
      ) {
        const shell = background.status === "running" ? yield* shellOf(recovery.sessionID) : undefined
        const info =
          shell && Schema.is(ShellSchema.ID)(recovery.shellID)
            ? yield* shell.get(recovery.shellID).pipe(Effect.option)
            : Option.none()
        if (!shell || Option.isNone(info)) return yield* recoverToolJob(background, recovery)
        reattached.add(info.value.id)
        yield* ShellTool.reattach({
          shell,
          jobs,
          sessions: notices,
          sessionID: recovery.sessionID,
          info: info.value,
          notificationID: background.notificationID,
        })
      })

      // A server that stopped (shut down or killed) during a foreground shell call leaves the call unsettled, its
      // command still running in the daemon. Settle the call as moved to the background and watch the command.
      const settleBackgroundedCalls = Effect.fnUntraced(function* (
        sessionID: SessionSchema.ID,
        notices: Notices,
        reattached: ReadonlySet<string>,
      ) {
        const calls = (yield* SessionHistory.incompleteAssistants(db, sessionID)).flatMap((message) =>
          message.type === "assistant"
            ? message.content.flatMap((part) =>
                part.type === "tool" && part.name === ShellTool.name && part.state.status === "running"
                  ? [{ assistantMessageID: message.id, part }]
                  : [],
              )
            : [],
        )
        if (calls.length === 0) return
        const shell = yield* shellOf(sessionID)
        if (!shell) return
        yield* Effect.forEach(
          calls,
          Effect.fnUntraced(function* (call) {
            const info = yield* shell.byToolCall({
              sessionID,
              assistantMessageID: call.assistantMessageID,
              callID: call.part.id,
            })
            if (!info) return
            const result = ShellTool.backgroundToolResult(info)
            if (!isReadonlyArrayNonEmpty(result.content)) return
            yield* bus.publish(SessionEvent.Tool.Success, {
              sessionID,
              assistantMessageID: call.assistantMessageID,
              id: call.part.id,
              content: result.content,
              metadata: result.metadata,
              executed: call.part.executed === true,
            })
            // Backgrounded but stopped before the call was settled: its job row was already reattached (and, for a
            // command that already finished, may even be done).
            if (reattached.has(info.id)) return
            yield* ShellTool.reattach({ shell, jobs, sessions: notices, sessionID, info })
          }),
          { discard: true },
        )
      })

      const deliverSubagentSafe = Effect.fnUntraced(function* (
        notices: Notices,
        notificationID: Job.Background["notificationID"],
        recovery: Extract<Job.Recovery, { kind: "subagent" }>,
        result: Pick<Job.Background, "status" | "output" | "error">,
      ) {
        yield* SubagentCompletion.deliver(notices, jobs, {
          ...result,
          recovery,
          notificationID,
        }).pipe(
          // A deleted parent owes nothing to the report; clear its row.
          Effect.catchTag("Session.NotFoundError", () => jobs.completeBackground(notificationID)),
          // Retain the outbox row for the next boot: the notification ID is
          // already owned by another item, so deleting it would lose the report.
          Effect.catchTag("Session.SyntheticConflictError", (error) =>
            Effect.logWarning("Failed to admit recovered subagent notification due to ID conflict", {
              notificationID,
              parentSessionID: recovery.parentSessionID,
              childSessionID: recovery.childSessionID,
              error,
            }),
          ),
          // One bad row must never abort the sweep for other Sessions. A deleted parent
          // is acknowledged; any other failure keeps the row for the next boot.
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : store.get(recovery.parentSessionID).pipe(
                  Effect.flatMap((parent) =>
                    parent === undefined
                      ? jobs.completeBackground(notificationID)
                      : Effect.logWarning("Unexpected failure delivering recovered subagent notification", {
                          notificationID,
                          parentSessionID: recovery.parentSessionID,
                          childSessionID: recovery.childSessionID,
                          cause,
                        }),
                  ),
                ),
          ),
        )
      })

      const recoverSubagent = Effect.fnUntraced(function* (
        background: Job.Background,
        recovery: Extract<Job.Recovery, { kind: "subagent" }>,
        notices: Notices,
        ambiguous: ReadonlySet<SessionSchema.ID>,
      ): Effect.fn.Return<boolean> {
        const child = yield* store.get(recovery.childSessionID)
        if (!child || child.parentID !== recovery.parentSessionID || !(yield* store.get(recovery.parentSessionID))) {
          yield* jobs.completeBackground(background.notificationID)
          return false
        }

        if (background.status !== "running") {
          // Replay the settled report using the work captured with it.
          yield* deliverSubagentSafe(notices, background.notificationID, recovery, background)
          return false
        }

        if (ambiguous.has(recovery.childSessionID)) {
          yield* deliverSubagentSafe(notices, background.notificationID, recovery, {
            status: "error",
            error: "Child tool outcome is ambiguous after restart",
          })
          return false
        }
        if (yield* execution.isActive(recovery.childSessionID)) return false
        // prepareResume publishes Execution.Failed directly on the bus outside the
        // coordinator, so the settle hook never reports an exhausted child.
        if (!(yield* prepareResume(recovery.childSessionID))) {
          yield* deliverSubagentSafe(notices, background.notificationID, recovery, {
            status: "error",
            error: RESUME_EXHAUSTED.message,
          })
          return false
        }
        // Defer the start until every suspended session has counted its attempt; a fast
        // resumed child settling in Phase 1 would wake its parent past that budget.
        return true
      })

      // Until nested prepared calls can be coordinated before their own drain, stop the
      // entire in-flight subtree rather than let settleStaleToolCalls turn a
      // possibly executed effect into a retryable model-visible tool error.
      const stopStaleChild = Effect.fnUntraced(function* (sessionID: SessionSchema.ID): Effect.fn.Return<boolean> {
        const calls = (yield* store.context(sessionID).pipe(Effect.orDie)).flatMap((message) =>
          message.type === "assistant"
            ? message.content.flatMap((tool) =>
                tool.type === "tool" && tool.state.status === "running" && tool.executed !== true
                  ? [{ messageID: message.id, tool }]
                  : [],
              )
            : [],
        )
        if (calls.length === 0) return false
        for (const call of calls) {
          const operation = SubagentRecovery.prepared(call.tool)
          const child = operation && (yield* store.get(operation.childSessionID))
          if (child?.parentID === sessionID) yield* stopStaleChild(child.id)
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID: call.messageID,
            id: call.tool.id,
            error: {
              type: "aborted",
              message: operation
                ? `Nested subagent recovery stopped (sessionID: ${operation.childSessionID})`
                : `Tool outcome is ambiguous after restart: ${call.tool.name}`,
            },
            metadata: operation
              ? { sessionID: operation.childSessionID }
              : call.tool.state.status === "running"
                ? call.tool.state.metadata
                : {},
            executed: false,
          })
        }
        yield* bus.publish(
          SessionEvent.Execution.Failed,
          {
            sessionID,
            error: { type: "aborted", message: "Execution stopped: a child tool outcome is ambiguous after restart." },
          },
          { commit: () => store.release(sessionID) },
        )
        return true
      })

      const recoverPreparedCall = Effect.fn("SessionRestart.recoverPreparedCall")(function* (
        sessionID: SessionSchema.ID,
        assistantMessageID: SessionMessage.ID,
        tool: SessionMessage.AssistantTool,
        ambiguous: ReadonlySet<SessionSchema.ID>,
      ) {
        const operation = SubagentRecovery.prepared(tool)
        if (!operation) return
        const decoded = Schema.decodeUnknownOption(SubagentTool.Input)(tool.state.input)
        if (Option.isNone(decoded)) return yield* Effect.die(new Error(`Invalid prepared subagent input: ${tool.id}`))
        const input = decoded.value
        const previous = yield* store.get(operation.childSessionID)
        if (previous && previous.parentID !== sessionID)
          return yield* Effect.die(new Error(`Subagent child ownership mismatch: ${operation.childSessionID}`))
        if (!previous && input.sessionID)
          return yield* Effect.die(new Error(`Continued subagent child disappeared: ${input.sessionID}`))
        const child =
          previous ??
          (yield* sessions.create({
            id: operation.childSessionID,
            parentID: sessionID,
            title: input.description,
            agent: operation.agent,
            model: operation.model,
          }))
        const pending = previous && (yield* sessions.inbox(child.id)).find((item) => item.id === operation.inboxID)
        if (
          pending &&
          previous.outcome === "interrupted" &&
          (input.sessionID === undefined ||
            (previous.time.idle &&
              DateTime.toEpochMillis(previous.time.idle) >= DateTime.toEpochMillis(pending.time.created)))
        ) {
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID,
            id: tool.id,
            error: { type: "aborted", message: `Subagent cancelled before admission (sessionID: ${child.id})` },
            metadata: { sessionID: child.id },
            executed: false,
          })
          return false
        }
        yield* sessions.prompt({
          id: operation.inboxID,
          sessionID: child.id,
          text: input.sessionID
            ? input.prompt
            : ["You are a subagent spawned by another session.", input.prompt].join("\n"),
          resume: false,
        })
        const settled = yield* SubagentRecovery.settled(sessions, child.id, operation.inboxID)
        // The direct-claim sweep may already have failed this child's ambiguous tool.
        // That failure must stop the prepared parent too, not look like an ordinary result.
        if (ambiguous.has(child.id) || (!settled && (yield* stopStaleChild(child.id)))) {
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID,
            id: tool.id,
            error: { type: "aborted", message: `Subagent recovery stopped (sessionID: ${child.id})` },
            metadata: { sessionID: child.id },
            executed: false,
          })
          return false
        }
        const recovery = {
          kind: "subagent" as const,
          parentSessionID: sessionID,
          childSessionID: child.id,
          agent: String(operation.agent),
          description: input.description,
        }
        if (!settled && (yield* jobs.get(child.id))?.status !== "completed")
          yield* SubagentJob.start(jobs, execution, recovery, SubagentRecovery.notificationID(operation))
        // New launches are always backgrounded upstream. Old prepared foreground calls
        // are also settled as backgrounded, retaining the same child and inbox identity.
        if (settled)
          yield* SubagentCompletion.deliver(sessions, jobs, {
            status:
              settled.status === "succeeded" ? "completed" : settled.status === "interrupted" ? "cancelled" : "error",
            output: settled.output,
            error: settled.status,
            notificationID: SubagentRecovery.notificationID(operation),
            recovery,
            resume: false,
          })
        const output = SubagentTool.backgroundResult(child.id)
        yield* bus.publish(SessionEvent.Tool.Success, {
          sessionID,
          assistantMessageID,
          id: tool.id,
          content: [{ type: "text", text: output.output }],
          metadata: { sessionID: child.id, status: output.status },
          executed: false,
        })
        return true
      })

      const failPrepared = (
        sessionID: SessionSchema.ID,
        call: {
          messageID: SessionMessage.ID
          tool: SessionMessage.AssistantTool
          operation: { childSessionID: SessionSchema.ID }
        },
        message: string,
      ) =>
        bus.publish(SessionEvent.Tool.Failed, {
          sessionID,
          assistantMessageID: call.messageID,
          id: call.tool.id,
          error: { type: "aborted", message },
          metadata: { sessionID: call.operation.childSessionID },
          executed: false,
        })

      type ResumableSubagent = {
        readonly background: Job.Background
        readonly recovery: Extract<Job.Recovery, { kind: "subagent" }>
      }

      return Service.of({
        resumeSuspendedSessions: Effect.gen(function* () {
          const active = yield* execution.active
          const pending = yield* jobs.pendingBackground
          const children = new Set(
            pending.flatMap((background) =>
              background.status === "running" && background.recovery.kind === "subagent"
                ? [background.recovery.childSessionID]
                : [],
            ),
          )
          yield* store.releaseOrphanedChildClaims()
          // Job.cancel persists the cancellation before interrupting the execution. A crash
          // in between leaves its claim behind. Settlement writes an error to the
          // outbox atomically with release; such an older report can coexist with a new claim.
          for (const { status, recovery, error } of pending) {
            if (status !== "cancelled" || recovery.kind !== "subagent" || error !== undefined) continue
            if (!active.has(recovery.childSessionID) && !children.has(recovery.childSessionID)) {
              yield* store.release(recovery.childSessionID)
            }
          }
          // Early notices wait for recovery's accounting, including Sessions that exhaust their budget.
          const suspended = new Set(
            [...(yield* store.listSuspended()), ...children].filter((sessionID) => !active.has(sessionID)),
          )
          const state = { defer: true }
          const wakes = new Set<SessionSchema.ID>()
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              state.defer = false
              yield* Effect.forEach(wakes, (sessionID) => Effect.ignoreCause(wake(sessionID)), { discard: true })
              suspended.clear()
            }),
          )
          // Hold notice wakes until every suspended session has counted its attempt, so a woken
          // child cannot settle mid-sweep and wake its parent past that budget.
          const notices: Notices = {
            synthetic: (input) =>
              sessions.synthetic({ ...input, resume: false }).pipe(
                Effect.tap(() => {
                  if (suspended.has(input.sessionID)) return Effect.void
                  if (!state.defer) return wake(input.sessionID)
                  wakes.add(input.sessionID)
                  return Effect.void
                }),
                Effect.uninterruptible,
              ),
          }
          const recoverable = Effect.fnUntraced(function* (background: Job.Background) {
            return (yield* jobs.get(background.id))?.status !== "running"
          })
          // Shell and tool outcomes first, then calls a killed server left unsettled, and only then recovered children,
          // whose first resume would otherwise fail their own unsettled shell calls.
          const reattached = new Set<string>()
          yield* Effect.forEach(
            pending,
            Effect.fnUntraced(function* (background) {
              const recovery = background.recovery
              if (recovery.kind === "subagent" || !(yield* recoverable(background))) return
              if (recovery.kind === "shell") return yield* recoverShellJob(background, recovery, notices, reattached)
              yield* recoverToolJob(background, recovery)
            }),
            { discard: true },
          )
          yield* Effect.forEach(
            suspended,
            (sessionID) =>
              settleBackgroundedCalls(sessionID, notices, reattached).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to settle backgrounded shell calls", { sessionID, error }),
                ),
              ),
            { discard: true },
          )
          const ambiguous = new Set<SessionSchema.ID>()
          const preparedChildren = new Set<SessionSchema.ID>()
          for (const sessionID of suspended) {
            const calls = (yield* store.context(sessionID).pipe(Effect.orDie)).flatMap((message) =>
              message.type === "assistant"
                ? message.content.flatMap((tool) =>
                    tool.type === "tool" && tool.state.status === "running" && tool.executed !== true
                      ? [{ messageID: message.id, tool }]
                      : [],
                  )
                : [],
            )
            const nested = children.has(sessionID)
              ? yield* Effect.forEach(calls, (call) => {
                  const operation = SubagentRecovery.prepared(call.tool)
                  return operation
                    ? store
                        .get(operation.childSessionID)
                        .pipe(
                          Effect.flatMap((child) =>
                            child?.parentID === sessionID ? stopStaleChild(child.id) : Effect.succeed(false),
                          ),
                        )
                    : Effect.succeed(false)
                })
              : []
            const stopped = nested.some(Boolean)
            if (!stopped && !calls.some((call) => !SubagentRecovery.prepared(call.tool))) {
              for (const call of calls) {
                const operation = SubagentRecovery.prepared(call.tool)
                if (operation) preparedChildren.add(operation.childSessionID)
              }
              continue
            }
            ambiguous.add(sessionID)
            for (const call of calls) {
              const operation = SubagentRecovery.prepared(call.tool)
              yield* bus.publish(SessionEvent.Tool.Failed, {
                sessionID,
                assistantMessageID: call.messageID,
                id: call.tool.id,
                error: {
                  type: "aborted",
                  message: operation
                    ? stopped
                      ? `Nested subagent recovery stopped (sessionID: ${operation.childSessionID})`
                      : `Subagent recovery stopped with an ambiguous sibling (sessionID: ${operation.childSessionID})`
                    : `Tool outcome is ambiguous after restart: ${call.tool.name}`,
                },
                metadata: operation
                  ? { sessionID: operation.childSessionID }
                  : call.tool.state.status === "running"
                    ? call.tool.state.metadata
                    : {},
                executed: call.tool.executed === true,
              })
            }
            yield* bus.publish(
              SessionEvent.Execution.Failed,
              {
                sessionID,
                error: { type: "aborted", message: "Execution stopped: a tool outcome is ambiguous after restart." },
              },
              { commit: () => store.release(sessionID) },
            )
          }
          const resumable: ResumableSubagent[] = []
          yield* Effect.forEach(
            pending,
            Effect.fnUntraced(function* (background) {
              const recovery = background.recovery
              if (recovery.kind !== "subagent" || !(yield* recoverable(background))) return
              if (yield* recoverSubagent(background, recovery, notices, ambiguous))
                resumable.push({ background, recovery })
            }),
            { discard: true },
          )

          // Prepared recoveries own their parent before admission, but must not launch
          // children until the other suspended roots have charged their restart budgets.
          const recoveryReady = yield* Deferred.make<void>()
          // A failed sweep must also release the parent owners waiting at this barrier.
          yield* Effect.addFinalizer(() => Deferred.succeed(recoveryReady, undefined))
          const recovering = new Set<SessionSchema.ID>()
          for (const sessionID of yield* store.listSuspended()) {
            // The prepared parent owns this subtree, regardless of claim iteration order.
            if (preparedChildren.has(sessionID)) continue
            const calls = (yield* store.context(sessionID).pipe(Effect.orDie)).flatMap((message) =>
              message.type === "assistant"
                ? message.content.flatMap((tool) => {
                    const operation = tool.type === "tool" ? SubagentRecovery.prepared(tool) : undefined
                    return tool.type === "tool" && operation ? [{ messageID: message.id, tool, operation }] : []
                  })
                : [],
            )
            if (calls.length === 0) continue
            if (preparedInFlight.has(sessionID)) continue
            preparedInFlight.add(sessionID)
            recovering.add(sessionID)
            for (const call of calls) recovering.add(call.operation.childSessionID)
            const counted = yield* Deferred.make<void>()
            yield* Effect.gen(function* () {
              yield* execution.resume(
                sessionID,
                Effect.gen(function* () {
                  // Register execution before the first durable recovery step, so
                  // any prompt wake joins this owner instead of dropping prepare.
                  if (
                    !(yield* prepareResume(sessionID, true).pipe(Effect.ensuring(Deferred.succeed(counted, undefined))))
                  ) {
                    yield* Effect.forEach(calls, (call) => failPrepared(sessionID, call, RESUME_EXHAUSTED.message), {
                      discard: true,
                    })
                    return yield* new StepFailedError({ error: RESUME_EXHAUSTED })
                  }
                  yield* Deferred.await(recoveryReady)
                  for (const [index, call] of calls.entries()) {
                    const recovered = yield* recoverPreparedCall(sessionID, call.messageID, call.tool, ambiguous).pipe(
                      Effect.catchCause((cause) =>
                        Cause.hasInterruptsOnly(cause)
                          ? Effect.interrupt
                          : Effect.logError("Prepared subagent recovery stopped", { sessionID, cause }).pipe(
                              Effect.andThen(failPrepared(sessionID, call, "Subagent recovery stopped")),
                              Effect.as(false),
                            ),
                      ),
                    )
                    if (recovered) continue
                    yield* Effect.forEach(
                      calls.slice(index + 1),
                      (rest) => failPrepared(sessionID, rest, "Subagent recovery stopped"),
                      { discard: true },
                    )
                    return yield* new StepFailedError({
                      error: {
                        type: "aborted",
                        message: "Subagent recovery stopped; inspect the child before continuing.",
                      },
                    })
                  }
                }),
              )
            }).pipe(
              Effect.catchCause((cause) => Effect.logError("Prepared subagent recovery stopped", { sessionID, cause })),
              Effect.ensuring(Effect.sync(() => preparedInFlight.delete(sessionID))),
              Effect.ensuring(Deferred.succeed(counted, undefined)),
              Effect.forkIn(scope, { startImmediately: true }),
            )
            yield* Deferred.await(counted)
          }

          // A directly driven child can also settle and wake its parent. Account for every
          // claimed execution before starting any of them, leaving running jobs to SubagentJob.
          const resumed = yield* execution.active
          const direct = yield* Effect.filter(
            (yield* store.listSuspended()).filter(
              (sessionID) =>
                !resumed.has(sessionID) &&
                !children.has(sessionID) &&
                !preparedChildren.has(sessionID) &&
                !recovering.has(sessionID) &&
                !preparedInFlight.has(sessionID),
            ),
            prepareResume,
          )
          yield* Effect.forEach(
            direct,
            Effect.fnUntraced(function* (sessionID) {
              suspended.delete(sessionID)
              yield* execution.resume(sessionID).pipe(Effect.ignore, Effect.forkIn(scope))
            }),
            { concurrency: "unbounded", discard: true },
          )

          yield* Deferred.succeed(recoveryReady, undefined)

          // Start children only now: their settlement reports wake parents, so the parent's
          // restart budget must already be charged. SessionExecution's settle hook owns the
          // report, so no jobs.wait observer is needed.
          yield* Effect.forEach(
            resumable,
            Effect.fnUntraced(function* ({ background, recovery }) {
              yield* SubagentJob.start(jobs, execution, recovery, background.notificationID)
              suspended.delete(recovery.childSessionID)
            }),
            { discard: true },
          )
        }).pipe(Effect.scoped),
      })
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [
    SessionStore.node,
    SessionExecution.node,
    Bus.node,
    Job.node,
    Session.node,
    Instance.node,
    Database.node,
    Shell.daemonNode,
  ],
})
