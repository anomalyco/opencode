export * as SessionRestart from "./restart.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { isReadonlyArrayNonEmpty } from "effect/Array"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Shell as ShellSchema } from "@opencode/schema/shell"
import { Bus } from "../../bus.js"
import { Database } from "../../database/database.js"
import { Detaching } from "../../detaching.js"
import { Instance } from "../../instance/service.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"
import { Shell } from "../../shell.js"
import { ShellTool } from "../../tool/plugin/shell.js"
import { SessionEvent } from "../event.js"
import { SessionExecution } from "../execution.js"
import { SessionHistory } from "../history.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
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
      const instances = yield* Instance.Service
      const db = (yield* Database.Service).db
      // Optional so restart built outside the application graph (tests) need not provide it.
      const detaching = Option.getOrUndefined(yield* Effect.serviceOption(Detaching.Service))
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

      const reattach = (
        shell: Shell.Interface,
        sessionID: SessionSchema.ID,
        info: ShellSchema.Info,
        suspended: ReadonlySet<SessionSchema.ID>,
        notificationID?: SessionMessage.ID,
      ) =>
        ShellTool.reattach({
          shell,
          jobs,
          sessions,
          scope,
          sessionID,
          info,
          notificationID,
          resume: () => (suspended.has(sessionID) ? false : undefined),
          leaveRunning: () => detaching?.isDetaching() === true && shell.detachable(info.id),
        })

      // A shell job the previous server left running is watched again if its command is still known (running or
      // finished during the restart); otherwise it is reported as lost.
      const recoverShellJob = Effect.fnUntraced(function* (
        background: Job.Background,
        recovery: Extract<Job.Recovery, { kind: "shell" }>,
        suspended: ReadonlySet<SessionSchema.ID>,
        reattached: Set<string>,
      ) {
        const shell = background.status === "running" ? yield* shellOf(recovery.sessionID) : undefined
        const info =
          shell && Schema.is(ShellSchema.ID)(recovery.shellID)
            ? yield* shell.get(recovery.shellID).pipe(Effect.option)
            : Option.none()
        if (!shell || Option.isNone(info)) return yield* recoverToolJob(background, recovery)
        reattached.add(info.value.id)
        yield* reattach(shell, recovery.sessionID, info.value, suspended, background.notificationID)
      })

      // A server killed while shutting down may leave a foreground shell call unsettled, its command still running
      // in the daemon. Settle the call as moved to the background and watch the command, as the old server would have.
      const settleBackgroundedCalls = Effect.fnUntraced(function* (
        sessionID: SessionSchema.ID,
        suspended: ReadonlySet<SessionSchema.ID>,
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
            const result = ShellTool.backgroundToolResult(info.id, info.file)
            if (!isReadonlyArrayNonEmpty(result.content)) return
            yield* bus.publish(SessionEvent.Tool.Success, {
              sessionID,
              assistantMessageID: call.assistantMessageID,
              id: call.part.id,
              content: result.content,
              metadata: { shellID: info.id, status: "running", truncated: false },
              executed: call.part.executed === true,
            })
            yield* shell.timeout(info.id, 0).pipe(Effect.ignore)
            // Killed after backgrounding the job but before settling the call: the job was already reattached.
            if (reattached.has(info.id) || (yield* jobs.get(info.id))) return
            yield* reattach(shell, sessionID, info, suspended)
          }),
          { discard: true },
        )
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
          // Early notices wait for recovery's accounting, including Sessions that exhaust their budget.
          const suspended = new Set(
            [...(yield* store.listSuspended()), ...children].filter((sessionID) => !active.has(sessionID)),
          )
          yield* store.releaseChildClaims(children)
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
              if (recovery.kind === "shell") return yield* recoverShellJob(background, recovery, suspended, reattached)
              yield* recoverToolJob(background, recovery)
            }),
            { discard: true },
          )
          yield* Effect.forEach(
            suspended,
            (sessionID) =>
              settleBackgroundedCalls(sessionID, suspended, reattached).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to settle backgrounded shell calls", { sessionID, error }),
                ),
              ),
            { discard: true },
          )
          yield* Effect.forEach(
            pending,
            Effect.fnUntraced(function* (background) {
              const recovery = background.recovery
              if (recovery.kind !== "subagent" || !(yield* recoverable(background))) return
              yield* recoverSubagent(background, recovery, suspended)
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
          // Async observers consult this set at delivery; later completions wake parents normally.
          suspended.clear()
        }),
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
    Detaching.node,
  ],
})
