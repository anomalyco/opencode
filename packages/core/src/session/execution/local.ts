import { Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-layer"
import { SessionRunner } from "../runner/index"
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
        return yield* SessionRunner.Service.use((runner) => runner.run(sessionID)).pipe(
          Effect.provide(locations.get(session.location)),
        )
      }),
    })
  }),
)
