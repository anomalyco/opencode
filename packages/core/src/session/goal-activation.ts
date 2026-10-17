export * as SessionGoalActivation from "./goal-activation.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionSchema } from "./schema.js"

/**
 * Process-local willingness to run a goal. Never persisted, so a fresh process or a
 * reloaded instance starts disarmed and a goal never resumes itself after restart.
 * `armed` is the same kind of process-local truth as `session.interrupt`'s
 * `interrupted` flag: it only means anything to the process that owns it.
 */
export interface Interface {
  readonly arm: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly disarm: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly isArmed: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoalActivation") {}

const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const armed = new Set<SessionSchema.ID>()
    return Service.of({
      arm: (sessionID) => Effect.sync(() => void armed.add(sessionID)),
      disarm: (sessionID) => Effect.sync(() => void armed.delete(sessionID)),
      isArmed: (sessionID) => Effect.sync(() => armed.has(sessionID)),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
