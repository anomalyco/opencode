export * as SessionExecution from "./execution.js"

import { Cause, Context, Effect, Exit, Layer } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { LocationServiceMap } from "../location-service-map.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { SessionEvent } from "./event.js"
import { SessionRunCoordinator } from "./run-coordinator.js"
import { SessionRunner } from "./runner/index.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { toSessionError } from "./to-session-error.js"
import { UserInterruptedError } from "./error.js"
import { SessionInbox } from "./inbox.js"

export interface Interface {
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Registers newly recorded work. Repeated wakeups coalesce, with a full drain taking precedence. */
  readonly wake: (
    sessionID: SessionSchema.ID,
    options?: { readonly scope?: SessionRunner.DrainScope | "active" },
  ) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID, options?: { readonly continue?: boolean }) => Effect.Effect<void>
  /** Resolves once this process owns no active execution for the Session. Returns immediately when idle and never starts work. */
  readonly awaitIdle: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionExecution") {}

type InterruptReason = "user" | "shutdown" | "superseded"

export function terminal(exit: Exit.Exit<void, SessionRunner.RunError>, reason?: InterruptReason) {
  if (Exit.isSuccess(exit)) return { type: "succeeded" as const }
  if (Cause.hasInterrupts(exit.cause)) return { type: "interrupted" as const, reason: reason ?? "shutdown" }
  const failure = Cause.squash(exit.cause)
  if (failure instanceof UserInterruptedError) return { type: "interrupted" as const, reason: "user" as const }
  return { type: "failed" as const, error: toSessionError(failure) }
}

/** Process-local execution: drains run in this process, routed through the Session's Location graph. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const bus = yield* Bus.Service
    const db = (yield* Database.Service).db
    const wakeScopes = new Map<SessionSchema.ID, SessionRunner.DrainScope>()
    const activeScopes = new Map<SessionSchema.ID, SessionRunner.DrainScope>()
    const continuingInterrupts = new Map<SessionSchema.ID, Set<symbol>>()
    const deferredWakes = new Set<SessionSchema.ID>()
    const reportLifecycle = <A>(sessionID: SessionSchema.ID, effect: Effect.Effect<A>) =>
      effect.pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError("Failed to publish Session execution lifecycle", cause).pipe(
                Effect.annotateLogs({ sessionID }),
              ),
        ),
        Effect.asVoid,
      )
    // Write-ahead claim: starting records the durable intent that a turn is in flight, in the same
    // transaction as the started event. Terminals release it — except shutdown interruption, which
    // preserves the claim so the next server start resumes the turn. A claim that survives with no
    // terminal is the signature of a process that died without teardown (crash, SIGKILL, eviction);
    // recovery is a property of the database, never of a shutdown hook that may not run.
    const claimOnCommit = (sessionID: SessionSchema.ID) => ({
      commit: () => store.claim(sessionID),
    })
    const releaseOnCommit = (sessionID: SessionSchema.ID) => ({
      commit: () => store.release(sessionID),
    })
    function drain(
      sessionID: SessionSchema.ID,
      force: boolean,
      continuation?: SessionRunner.Continuation,
      scope: SessionRunner.DrainScope = "all",
    ): Effect.Effect<void, SessionRunner.RunError> {
      return Effect.gen(function* () {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
        const result = yield* SessionRunner.Service.use((runner) =>
          runner.drain({ sessionID, force, continuation, scope }),
        ).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
        if (result.type === "complete") return
        return yield* drain(sessionID, false, result.continuation, scope)
      })
    }
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError, InterruptReason>({
      started: (sessionID) =>
        reportLifecycle(
          sessionID,
          bus.publish(SessionEvent.Execution.Started, { sessionID }, claimOnCommit(sessionID)),
        ),
      drain: (sessionID, force) =>
        Effect.sync(() => {
          const scope = force ? "all" : (wakeScopes.get(sessionID) ?? "all")
          wakeScopes.delete(sessionID)
          return scope
        }).pipe(
          Effect.flatMap((scope) =>
            Effect.sync(() => activeScopes.set(sessionID, scope)).pipe(
              Effect.andThen(drain(sessionID, force, undefined, scope)),
              Effect.ensuring(Effect.sync(() => activeScopes.delete(sessionID))),
            ),
          ),
        ),
      // One terminal observation per busy period, covering every coalesced drain.
      settled: (sessionID, exit, reason) =>
        reportLifecycle(
          sessionID,
          Effect.gen(function* () {
            const outcome = terminal(exit, reason)
            if (outcome.type === "succeeded") {
              yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID }, releaseOnCommit(sessionID))
              return
            }
            if (outcome.type === "interrupted") {
              // A user cancel (or a superseding execution) releases the claim: the turn must not
              // resurrect at the next boot. Shutdown interruption keeps it for restart continuity.
              yield* bus.publish(
                SessionEvent.Execution.Interrupted,
                { sessionID, reason: outcome.reason },
                outcome.reason === "shutdown" ? undefined : releaseOnCommit(sessionID),
              )
              return
            }
            yield* bus.publish(
              SessionEvent.Execution.Failed,
              {
                sessionID,
                error: outcome.error,
              },
              releaseOnCommit(sessionID),
            )
          }),
        ),
    })
    const scheduleWake = (sessionID: SessionSchema.ID, scope: SessionRunner.DrainScope) =>
      Effect.sync(() => {
        if (scope === "all" || !wakeScopes.has(sessionID)) wakeScopes.set(sessionID, scope)
      }).pipe(Effect.andThen(coordinator.wake(sessionID)))

    const wake = (sessionID: SessionSchema.ID, scope: SessionRunner.DrainScope) =>
      Effect.suspend(() => {
        if (!continuingInterrupts.has(sessionID)) return scheduleWake(sessionID, scope)
        deferredWakes.add(sessionID)
        return Effect.void
      })

    const interrupt = (sessionID: SessionSchema.ID, options?: { readonly continue?: boolean }) => {
      if (!options?.continue) return coordinator.interrupt(sessionID, "user")
      const token = Symbol()
      const release = Effect.sync(() => {
        const active = continuingInterrupts.get(sessionID)
        active?.delete(token)
        if (active?.size !== 0) return
        continuingInterrupts.delete(sessionID)
        deferredWakes.delete(sessionID)
      })
      return Effect.uninterruptible(
        Effect.sync(() => {
          const active = continuingInterrupts.get(sessionID)
          if (active) {
            active.add(token)
            return
          }
          continuingInterrupts.set(sessionID, new Set([token]))
          deferredWakes.delete(sessionID)
          wakeScopes.delete(sessionID)
        }).pipe(
          Effect.andThen(coordinator.interrupt(sessionID, "user")),
          Effect.andThen(SessionInbox.has(db, sessionID, "steer")),
          Effect.flatMap((hasSteer) =>
            Effect.sync(() => {
              const deferred = deferredWakes.delete(sessionID)
              return hasSteer || deferred
            }).pipe(
              Effect.flatMap((resume) =>
                resume ? scheduleWake(sessionID, "steer").pipe(Effect.andThen(release)) : release,
              ),
            ),
          ),
          Effect.ensuring(release),
        ),
      )
    }

    return Service.of({
      active: coordinator.active,
      interrupt,
      resume: coordinator.run,
      wake: (sessionID, options) => {
        if (options?.scope !== "active") return wake(sessionID, options?.scope ?? "all")
        const scope = activeScopes.get(sessionID)
        return scope ? wake(sessionID, scope) : Effect.void
      },
      awaitIdle: coordinator.awaitIdle,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, Bus.node, Database.node],
})

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    awaitIdle: () => Effect.void,
  }),
)
