import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { Database } from "../../database/database"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import * as ReflectionMetric from "../runner/reflection-metric"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */

const computeDiagnostic = (
  state: string,
  muR: string,
  tauR: string,
  initialPromptText: string,
  whyExtensions: number,
  thenExtensions: number,
): SessionRunner.ReflectionDiagnostic => {
  const rhoMuR = ReflectionMetric.rho(muR, initialPromptText)
  const rhoTauR = ReflectionMetric.rho(tauR, initialPromptText)
  const rhoState = ReflectionMetric.rho(state, initialPromptText)
  const forwardMisalignment = Math.abs(rhoTauR - rhoState)
  const backwardMisalignment = Math.abs(rhoState - rhoMuR)
  const extensionsDetected = whyExtensions + thenExtensions
  return {
    muR,
    tauR,
    state,
    initialPrompt: initialPromptText,
    rhoMuR,
    rhoTauR,
    rhoState,
    forwardMisalignment,
    backwardMisalignment,
    totalMisalignment: forwardMisalignment + backwardMisalignment,
    objectiveGap: ReflectionMetric.objectiveGap(initialPromptText, muR, tauR),
    cofinality: ReflectionMetric.cofinality(extensionsDetected),
    extensionsDetected,
  }
}

const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const db = yield* Database.Service
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

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
      reflect: Effect.fnUntraced(function* (
        sessionID: SessionSchema.ID,
        input?: { readonly model?: { readonly providerID: string; readonly modelID: string } },
      ) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunner.Service.use((runner) =>
          Effect.gen(function* () {
            const initialPromptText = yield* ReflectionMetric.initialPrompt(db.db, sessionID)
            const state = yield* runner.lastAssistantText(sessionID)
            const why = yield* runner.whyLoop(sessionID, input?.model)
            const then = yield* runner.thenLoop(sessionID, input?.model)
            const diagnostic = computeDiagnostic(
              state,
              why.text,
              then.text,
              initialPromptText,
              why.extensionsDetected,
              then.extensionsDetected,
            )
            // eslint-disable-next-line unicorn/no-thenable
            return { why, then, diagnostic } satisfies SessionRunner.ReflectionOutcome
          }),
        ).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to reflect on Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),

      whyLoop: Effect.fnUntraced(function* (
        sessionID: SessionSchema.ID,
        input?: { readonly model?: { readonly providerID: string; readonly modelID: string } },
      ) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunner.Service.use((runner) =>
          runner.whyLoop(sessionID, input?.model),
        ).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed whyLoop on Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),

      thenLoop: Effect.fnUntraced(function* (
        sessionID: SessionSchema.ID,
        input?: { readonly model?: { readonly providerID: string; readonly modelID: string } },
      ) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunner.Service.use((runner) =>
          runner.thenLoop(sessionID, input?.model),
        ).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed thenLoop on Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),

      escalate: Effect.fnUntraced(function* (input: {
        readonly sessionID: SessionSchema.ID
        readonly reason: string
      }) {
        yield* Effect.logInfo("Escalation requested", {
          sessionID: input.sessionID,
          reason: input.reason,
        })
        yield* coordinator.interrupt(input.sessionID).pipe(Effect.orDie)
        yield* coordinator.wake(input.sessionID).pipe(Effect.orDie)
        return {
          escalated: true,
          message: `Task escalated to cloud model: ${input.reason}`,
        }
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, Database.node],
})

export * as SessionExecutionLocal from "./local"
