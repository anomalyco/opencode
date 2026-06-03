import { Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-layer"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
export const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap
    return SessionExecution.Service.of({
      resume: Effect.fn("SessionExecution.resume")(function* (sessionID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunCoordinator.Service.use((coordinator) => coordinator.run(sessionID)).pipe(
          Effect.provide(locations.get(session.location)),
        )
      }),
      wake: Effect.fn("SessionExecution.wake")(function* (sessionID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunCoordinator.Service.use((coordinator) => coordinator.wake(sessionID)).pipe(
          Effect.provide(locations.get(session.location)),
        )
      }),
    })
  }),
)
