export * as SessionRestart from "./restart.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../../bus.js"
import { Database } from "../../database/database.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"
import { SessionEvent } from "../event.js"
import { SessionExecution } from "../execution.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { SessionInbox } from "../inbox.js"
import { ImageNotice } from "../../image/notice.js"
import { ShellResult } from "../../shell/result.js"
import { SubagentCompletion } from "../subagent-completion.js"

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
      const db = (yield* Database.Service).db
      const scope = yield* Effect.scope
      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

      const prepareResume = Effect.fnUntraced(function* (
        sessionID: SessionSchema.ID,
        options?: {
          /**
           * A candidate was selected from its pending inbox row, not from a claim. Re-check the row
           * here: `execution.resume` is a forced, input-scoped drain, and a forced drain with nothing
           * promotable would spin between boundaries instead of completing.
           */
          readonly requireResumable?: boolean
        },
      ) {
        // A candidate can lose its last eligible row to a concurrent delivery or a sibling sweep
        // before this runs. Check before counting an attempt, so a no-op never spends budget.
        if (options?.requireResumable && (yield* SessionInbox.resumable(db, sessionID)).length === 0) return false
        // Durable before the resume runs, so a crash inside the resumed turn is
        // counted by the next sweep and the budget cannot be dodged.
        const attempts = yield* store.countResume(sessionID)
        if (attempts === undefined) return false
        if (attempts > maxAttempts) {
          // Terminalize instead: the release hook clears the claim and resets the
          // counter atomically with the terminal event. Retirement rides in the same
          // transaction and is scoped to the rows that existed at this decision, so a
          // prompt admitted while this turn settles stays eligible.
          const through = yield* SessionInbox.latestEnqueuedSeq(db, sessionID)
          const terminal = [
            SessionEvent.Execution.Failed,
            { sessionID, error: RESUME_EXHAUSTED },
            { commit: () => store.release(sessionID) },
          ] as const
          if (through === undefined) {
            yield* bus.publish(...terminal)
            return false
          }
          yield* bus.publishAll([
            terminal,
            [SessionEvent.InboxResumeRetired, { sessionID, reason: "exhausted", through } as const, undefined] as const,
          ])
          return false
        }
        // Only a claimed Session was actually working when the process died, so only it gets the
        // "continue where you left off" notice. A row-only candidate never started a turn: its
        // pending prompt is the instruction, and a synthetic admitted ahead of it would promote
        // first and misdescribe what happened.
        if (!options?.requireResumable)
          yield* bus.publish(SessionEvent.Synthetic, {
            sessionID,
            text: CONTINUE_AFTER_SERVER_RESTART,
            description: "Continuing after restart",
            metadata: { notice: "restart" },
          })
        return true
      })

      const restartMessage = (
        background: Job.Background,
        recovery: Exclude<Job.Recovery, { kind: "subagent" }>,
      ) => {
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
        yield* sessions
          .synthetic({
            id: background.notificationID,
            sessionID: recovery.sessionID,
            ...restartMessage(background, recovery),
            // Restart notices must not revive idle owners of long-lived background tools.
            // Interrupted executions resume separately after their notices are admitted.
            resume: false,
          })
          .pipe(
            Effect.catchTag("Session.NotFoundError", () => Effect.void),
            Effect.orDie,
          )
        yield* jobs.completeBackground(background.notificationID)
      })

      const recoverSubagent = Effect.fnUntraced(function* (
        background: Job.Background,
        recovery: Extract<Job.Recovery, { kind: "subagent" }>,
        suspended: ReadonlySet<SessionSchema.ID>,
      ) {
        const child = yield* store.get(recovery.childSessionID)
        if (!child || child.parentID !== recovery.parentSessionID || !(yield* store.get(recovery.parentSessionID))) {
          yield* jobs.completeBackground(background.notificationID)
          return
        }

        const notify = Effect.fnUntraced(function* (result: Pick<Job.Background, "status" | "output" | "error">) {
          yield* SubagentCompletion.deliver(sessions, jobs, {
            ...result,
            recovery,
            notificationID: background.notificationID,
            resume: suspended.has(recovery.parentSessionID) ? false : undefined,
          }).pipe(Effect.orDie)
        })

        if (background.status !== "running") {
          yield* notify(background)
          return
        }
        if (yield* execution.isActive(recovery.childSessionID)) return
        if (!(yield* prepareResume(recovery.childSessionID))) {
          yield* notify({ status: "error", error: RESUME_EXHAUSTED.message })
          return
        }

        yield* jobs.start({
          id: background.id,
          type: "subagent",
          title: recovery.description,
          notificationID: background.notificationID,
          recovery,
          run: execution.resume(recovery.childSessionID).pipe(
            Effect.andThen(store.context(recovery.childSessionID)),
            Effect.map((messages) => {
              const assistant = messages.findLast(
                (message) =>
                  message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
              )
              return SubagentCompletion.text(assistant)
            }),
          ),
        })
        yield* jobs.background(background.id)
        yield* jobs.wait({ id: background.id }).pipe(
          Effect.flatMap((result) => (result.info ? notify(result.info) : Effect.void)),
          Effect.forkIn(scope),
        )
      })

      return Service.of({
        resumeSuspendedSessions: Effect.gen(function* () {
          const active = yield* execution.active
          const pending = yield* jobs.pendingBackground
          const children = pending.flatMap((background) =>
            background.status === "running" && background.recovery.kind === "subagent"
              ? [background.recovery.childSessionID]
              : [],
          )
          // Delivery scope for recovery (B3). A recovered row only ever requests a drain the live
          // path would also have run: `execution.wake` after an admission is input-scoped, so the
          // recovered drain is `resume` (forced, input-scoped) exactly like the wake that was lost.
          // Steer-scoped bypasses stay live-path only: `interrupt({ resume: true })` parks queued
          // prompts, and restart must not promote work the live path would leave parked.
          const candidates = (yield* store.listResumableInbox()).filter((sessionID) => !active.has(sessionID))
          // C5: an unclaimed candidate still belongs in the early suppression set. A background child
          // that completes now could otherwise wake this parent before recovery accounts for it.
          // This is the *decision* set; the resume loop re-reads claims after background recovery.
          const suspended = new Set(
            [...(yield* store.listSuspended()), ...children, ...candidates].filter(
              (sessionID) => !active.has(sessionID),
            ),
          )
          yield* store.releaseChildClaims(children)
          yield* Effect.forEach(
            // Admit shell outcomes before a recovered child can start its first model request.
            pending.toSorted((a, b) => Number(a.recovery.kind === "subagent") - Number(b.recovery.kind === "subagent")),
            Effect.fnUntraced(function* (background) {
              if ((yield* jobs.get(background.id))?.status === "running") return
              const recovery = background.recovery
              if (recovery.kind !== "subagent") return yield* recoverToolJob(background, recovery)
              yield* recoverSubagent(background, recovery, suspended)
            }),
            { discard: true },
          )

          // Background completion can wake a parent, so inspect local ownership only after recovery.
          // C5: the fresh union reconciles the decision set with what recovery actually left behind.
          const resumed = yield* execution.active
          const claimed = yield* store.listSuspended()
          const claimedSet = new Set(claimed)
          const unique = Array.from(new Set([...claimed, ...candidates]))
          yield* Effect.forEach(
            unique.filter((sessionID) => !resumed.has(sessionID)),
            (sessionID) =>
              execution.resume(sessionID).pipe(
                Effect.ignore,
                Effect.forkIn(scope),
                // A claim resumes on its own, exactly as before: it marks an execution that was
                // already in flight. Only a row-only candidate needs an eligible row still to
                // deliver, since `resume` is a forced drain that would otherwise spin.
                Effect.when(prepareResume(sessionID, { requireResumable: !claimedSet.has(sessionID) })),
              ),
            { concurrency: "unbounded", discard: true },
          )
          // Async observers consult this set at delivery; later completions wake parents normally.
          suspended.clear()
        }),
      })
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [SessionStore.node, SessionExecution.node, Bus.node, Job.node, Session.node, Database.node],
})
