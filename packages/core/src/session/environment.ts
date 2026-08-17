export * as SessionEnvironment from "./environment.js"

import { Context, Effect, Layer, Ref } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { SessionSchema } from "./schema.js"

export type Variables = Readonly<Record<string, string>>

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Variables | undefined>
  readonly set: (sessionID: SessionSchema.ID, variables: Variables) => Effect.Effect<void>
  readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionEnvironment") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environments = yield* Ref.make(new Map<SessionSchema.ID, Variables>())

    return Service.of({
      get: Effect.fn("SessionEnvironment.get")(function* (sessionID) {
        return (yield* Ref.get(environments)).get(sessionID)
      }),
      set: Effect.fn("SessionEnvironment.set")(function* (sessionID, variables) {
        yield* Ref.update(environments, (current) => new Map(current).set(sessionID, { ...variables }))
      }),
      clear: Effect.fn("SessionEnvironment.clear")(function* (sessionID) {
        yield* Ref.update(environments, (current) => {
          if (!current.has(sessionID)) return current
          const next = new Map(current)
          next.delete(sessionID)
          return next
        })
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
