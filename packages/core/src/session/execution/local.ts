import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
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
    const inLocation = Effect.fnUntraced(function* <A>(
      sessionID: SessionSchema.ID,
      failure: string,
      use: (runner: SessionRunner.Interface) => Effect.Effect<A, SessionRunner.RunError>,
    ) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return yield* SessionRunner.Service.use(use).pipe(
        Effect.provide(locations.get(session.location)),
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError(failure, cause).pipe(Effect.annotateLogs({ sessionID })),
        ),
      )
    })
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: (sessionID, force) =>
        inLocation(sessionID, "Failed to drain Session", (runner) => runner.run({ sessionID, force })),
      aside: (sessionID) =>
        inLocation(sessionID, "Failed to compact Session", (runner) => runner.compact({ sessionID })),
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
      compact: coordinator.runAside,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node],
})

export * as SessionExecutionLocal from "./local"
