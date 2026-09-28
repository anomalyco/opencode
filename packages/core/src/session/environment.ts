export * as SessionEnvironment from "./environment.js"

import { Context, Deferred, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionSchema } from "./schema.js"
import { KV } from "../kv.js"

export type Variables = Readonly<Record<string, string>>

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Variables | undefined>
  readonly resolve: (sessionID: SessionSchema.ID) => Effect.Effect<Variables | undefined>
  readonly isReady: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  readonly set: (sessionID: SessionSchema.ID, variables: Variables) => Effect.Effect<void>
  readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionEnvironment") {}

export const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const environments = new Map<SessionSchema.ID, Variables>()
  const pending = new Map<SessionSchema.ID, Deferred.Deferred<void>>()

  return Service.of({
    get: (sessionID) => Effect.sync(() => environments.get(sessionID)),
    isReady: (sessionID) =>
      Effect.gen(function* () {
        return environments.has(sessionID) || (yield* kv.get(`session.environment/${sessionID}`)) !== true
      }),
    resolve: Effect.fn("SessionEnvironment.resolve")(function* (sessionID) {
      if (environments.has(sessionID)) return environments.get(sessionID)
      // Persist only the requirement, never client environment values or credentials.
      // A successor process must not substitute its own identity during recovery.
      if ((yield* kv.get(`session.environment/${sessionID}`)) !== true) return undefined
      if (!environments.has(sessionID)) {
        let ready = pending.get(sessionID)
        if (!ready) {
          ready = yield* Deferred.make<void>()
          pending.set(sessionID, ready)
        }
        yield* Deferred.await(ready)
      }
      return environments.get(sessionID)
    }),
    set: (sessionID, variables) =>
      Effect.gen(function* () {
        yield* kv.set(`session.environment/${sessionID}`, true)
        environments.set(sessionID, { ...variables })
        const ready = pending.get(sessionID)
        if (ready) yield* Deferred.succeed(ready, undefined)
        pending.delete(sessionID)
      }).pipe(Effect.uninterruptible),
    clear: (sessionID) =>
      Effect.gen(function* () {
        yield* kv.remove(`session.environment/${sessionID}`)
        environments.delete(sessionID)
        const ready = pending.get(sessionID)
        if (ready) yield* Deferred.interrupt(ready)
        pending.delete(sessionID)
      }).pipe(Effect.uninterruptible),
  })
})

export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [KV.node] })
