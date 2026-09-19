import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { InteractiveJobs } from "../../tool/interactive/store"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
    })

    // drain-interrupt support (spec R32/I10): kill the Session's interactive
    // jobs that have a call in flight BEFORE the drain fibers are interrupted,
    // while their in-flight claims are still observable; jobs without in-flight
    // calls are untouched
    const killInFlight = Effect.fn("SessionExecutionLocal.killInFlight")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return
      yield* InteractiveJobs.Service.use((jobs) => jobs.cancelInFlight({ sessionID, reason: "interrupt" })).pipe(
        Effect.provide(locations.get(session.location)),
        Effect.ignore,
      )
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: (sessionID) => killInFlight(sessionID).pipe(Effect.andThen(coordinator.interrupt(sessionID))),
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node],
})

export * as SessionExecutionLocal from "./local"
