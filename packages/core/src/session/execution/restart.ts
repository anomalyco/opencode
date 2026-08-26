export * as SessionRestart from "./restart.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../../bus.js"
import { Database } from "../../database/database.js"
import { Job } from "../../job.js"
import { SessionEvent } from "../event.js"
import { SessionExecution } from "../execution.js"
import { SessionInbox } from "../inbox.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"

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
      const database = yield* Database.Service
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
        })
        return true
      })

      return Service.of({
        resumeSuspendedSessions: Effect.gen(function* () {
          const pending = yield* jobs.pendingBackground
          yield* store.releaseChildClaims(
            pending.flatMap((background) =>
              background.recovery.kind === "subagent" ? [background.recovery.childSessionID] : [],
            ),
          )
          const active = yield* execution.active
          // Sessions already draining in this process keep their claim; resuming
          // them would only inject a stray continuation into a live turn.
          const orphaned = (yield* store.listSuspended()).filter((sessionID) => !active.has(sessionID))
          yield* Effect.forEach(
            pending,
            (background) =>
              Effect.gen(function* () {
                if ((yield* jobs.get(background.id))?.status === "running") return
                if (background.recovery.kind === "shell") {
                  if (yield* store.get(background.recovery.sessionID)) {
                    const state = background.status === "running" ? "cancelled" : background.status
                    const text =
                      background.status === "running"
                        ? "Command cancelled because the server restarted"
                        : state === "completed"
                          ? (background.output ?? "Command completed")
                          : state === "error"
                            ? (background.error ?? "Command failed")
                            : "Command cancelled"
                    yield* bus.publish(
                      SessionEvent.Synthetic,
                      {
                        sessionID: background.recovery.sessionID,
                        description: background.recovery.command,
                        text: `<shell id="${background.id}" state="${state}" command="${background.recovery.command}">\n${text}\n</shell>`,
                        metadata: {
                          source: "shell",
                          jobID: background.id,
                          shellID: background.recovery.shellID,
                          state,
                        },
                      },
                      { commit: () => jobs.completeBackground(background.notificationID) },
                    )
                    return
                  }
                  yield* jobs.completeBackground(background.notificationID)
                  return
                }

                const recovery = background.recovery
                const child = yield* store.get(recovery.childSessionID)
                if (
                  !(yield* store.get(recovery.parentSessionID)) ||
                  !child ||
                  child.parentID !== recovery.parentSessionID
                ) {
                  yield* jobs.completeBackground(background.notificationID)
                  return
                }

                const notify = Effect.fnUntraced(function* (
                  result: Pick<Job.Background, "status" | "output" | "error">,
                ) {
                  if (result.status === "running") return
                  const text =
                    result.status === "completed"
                      ? (result.output ?? "Subagent completed without a text response.")
                      : result.status === "error"
                        ? (result.error ?? "Subagent failed")
                        : "Subagent cancelled"
                  yield* SessionInbox.admit(database.db, bus, {
                    id: background.notificationID,
                    sessionID: recovery.parentSessionID,
                    item: SessionInbox.Item.make({
                      type: "synthetic",
                      delivery: "steer",
                      payload: {
                        description: recovery.description,
                        text: `<subagent sessionID="${recovery.childSessionID}" state="${result.status}" description="${recovery.description}">\n${text}\n</subagent>`,
                        metadata: {
                          source: "subagent",
                          childID: recovery.childSessionID,
                          agent: recovery.agent,
                          state: result.status,
                        },
                      },
                    }),
                  })
                  yield* jobs.completeBackground(background.notificationID)
                  yield* execution.wake(recovery.parentSessionID)
                })

                if (background.status !== "running") {
                  yield* notify(background)
                  return
                }
                if (active.has(recovery.childSessionID)) return
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
                          message.type === "assistant" &&
                          message.time.completed !== undefined &&
                          message.error === undefined,
                      )
                      if (assistant?.type !== "assistant") return "Subagent completed without a text response."
                      return (
                        assistant.content
                          .filter((part) => part.type === "text")
                          .map((part) => part.text)
                          .join("") || "Subagent completed without a text response."
                      )
                    }),
                  ),
                })
                yield* jobs.background(background.id)
                yield* jobs.wait({ id: background.id }).pipe(
                  Effect.flatMap((result) => (result.info ? notify(result.info) : Effect.void)),
                  Effect.ignore,
                  Effect.forkIn(scope),
                )
              }),
            { discard: true },
          )
          yield* Effect.forEach(
            orphaned,
            (sessionID) =>
              prepareResume(sessionID).pipe(
                Effect.flatMap((resume) =>
                  resume ? execution.resume(sessionID).pipe(Effect.ignore, Effect.forkIn(scope)) : Effect.void,
                ),
              ),
            { concurrency: "unbounded", discard: true },
          )
        }),
      })
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [SessionStore.node, SessionExecution.node, Bus.node, Job.node, Database.node],
})
