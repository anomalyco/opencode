export * as SessionRestart from "./restart.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../../bus.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"
import { SessionEvent } from "../event.js"
import { SessionExecution } from "../execution.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { ImageNotice } from "../../image/notice.js"
import { ShellResult } from "../../shell/result.js"
import { SubagentJob } from "../subagent-job.js"
import { SubagentMetadata } from "../subagent-metadata.js"

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
      const subagents = yield* SubagentJob.Service
      const scope = yield* Effect.scope
      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

      const prepareResume = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        // Durable before the resume runs, so a crash inside the resumed turn is
        // counted by the next sweep and the budget cannot be dodged.
        const attempts = yield* store.countResume(sessionID)
        if (attempts === undefined) return false
        if (attempts > maxAttempts) {
          // Terminalize instead: the release hook clears the claim and resets the
          // counter atomically with the terminal event.
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
        completions: Array<Effect.Effect<void>>,
      ): Effect.fn.Return<"stale" | "owned" | "reported" | "exhausted" | "resume"> {
        const child = yield* store.get(recovery.childSessionID)
        if (!child || child.parentID !== recovery.parentSessionID || !(yield* store.get(recovery.parentSessionID))) {
          yield* jobs.completeBackground(background.notificationID)
          return "stale"
        }
        if ((yield* jobs.get(background.id))?.status === "running") return "owned"

        const silent = !SubagentMetadata.notify(child.metadata)
        const notify = Effect.fnUntraced(function* (result: Pick<Job.Background, "status" | "output" | "error">) {
          const completion = subagents
            .complete({
              ...result,
              recovery,
              notificationID: background.notificationID,
              resume: suspended.has(recovery.parentSessionID) ? false : undefined,
            })
            .pipe(Effect.orDie)
          if (silent) {
            // Silent completion wakes a held parent. Defer it until parent accounting and
            // recovered job ownership are established, just like a running child's observer.
            completions.push(completion)
            return
          }
          yield* completion
        })

        // Finished before the crash: no settle survives to report it, so this replay is the report.
        if (background.status !== "running") {
          yield* notify(background)
          return "reported"
        }
        if (yield* execution.isActive(recovery.childSessionID)) return "owned"
        if (!(yield* prepareResume(recovery.childSessionID))) {
          // prepareResume terminalizes on the bus rather than through a busy period, so no settle
          // report follows: this is the only delivery for the exhausted child.
          yield* notify({ status: "error", error: RESUME_EXHAUSTED.message })
          return "exhausted"
        }
        return "resume"
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
          // Early notices wait for recovery's accounting, including Sessions that exhaust their budget.
          const suspended = new Set(
            [...(yield* store.listSuspended()), ...children].filter((sessionID) => !active.has(sessionID)),
          )
          yield* store.releaseChildClaims(children)
          const owned = new Set<SessionSchema.ID>()
          const exhausted = new Set<SessionSchema.ID>()
          const reported = new Set<string>()
          const completions: Array<Effect.Effect<void>> = []
          const resumable: Array<{
            readonly background: Job.Background
            readonly recovery: Extract<Job.Recovery, { kind: "subagent" }>
          }> = []
          yield* Effect.forEach(
            // Admit shell outcomes before a recovered child can start its first model request.
            pending.toSorted((a, b) => Number(a.recovery.kind === "subagent") - Number(b.recovery.kind === "subagent")),
            Effect.fnUntraced(function* (background) {
              const recovery = background.recovery
              if (recovery.kind !== "subagent") {
                if ((yield* jobs.get(background.id))?.status === "running") return
                return yield* recoverToolJob(background, recovery)
              }
              const result = yield* recoverSubagent(background, recovery, suspended, completions)
              if (result === "owned" || result === "resume") owned.add(recovery.childSessionID)
              if (result === "exhausted") exhausted.add(recovery.childSessionID)
              if (result === "reported") reported.add(background.notificationID)
              if (result === "resume") resumable.push({ background, recovery })
            }),
            { discard: true },
          )

          // Background completion can wake a parent, so inspect local ownership only after recovery.
          const resumed = yield* execution.active
          yield* Effect.forEach(
            (yield* store.listSuspended()).filter((sessionID) => !resumed.has(sessionID)),
            (sessionID) =>
              execution
                .resume(sessionID)
                .pipe(Effect.ignore, Effect.forkIn(scope), Effect.when(prepareResume(sessionID))),
            { concurrency: "unbounded", discard: true },
          )
          // A resumed child's settle wakes its parent, so children start only once every suspended
          // parent has been counted and notified above.
          yield* Effect.forEach(
            resumable,
            ({ background, recovery }) =>
              subagents.recover({
                id: background.id,
                notificationID: background.notificationID,
                recovery,
              }),
            {
              discard: true,
            },
          )
          yield* Effect.forEach(completions, (completion) => completion.pipe(Effect.forkIn(scope)), { discard: true })
          // Held direct prompts have no job marker. Wake them only after cancellations are admitted,
          // parents are counted, and recovered jobs own their reports. A wake preserves the held
          // answer boundary without retrying an interrupted model execution.
          yield* Effect.forEach(
            yield* store.listHeldChildren(),
            Effect.fnUntraced(function* (held) {
              if (
                owned.has(held.sessionID) ||
                (yield* execution.isActive(held.sessionID)) ||
                (yield* jobs.get(held.sessionID))?.status === "running"
              )
                return
              if (exhausted.has(held.sessionID) || reported.has(held.report.notificationID))
                return yield* store.releaseReport(held.sessionID)
              const child = yield* store.get(held.sessionID)
              if (!child || !SubagentMetadata.notify(child.metadata) || !(yield* store.get(held.parentID)))
                return yield* store.releaseReport(held.sessionID)
              yield* execution.wake(held.sessionID)
            }),
            { discard: true },
          )
        }),
      })
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [SessionStore.node, SessionExecution.node, Bus.node, Job.node, Session.node, SubagentJob.node],
})
