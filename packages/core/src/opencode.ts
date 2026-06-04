export * as OpenCode from "./opencode"

import { Context, Effect, Layer } from "effect"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { LocationServiceMap } from "./location-layer"
import { ProjectV2 } from "./project"
import { SessionV2 } from "./session"
import { SessionProjector } from "./session/projector"
import * as SessionExecutionLocal from "./session/execution/local"
import { SessionStore } from "./session/store"

export interface Interface {
  readonly sessions: SessionV2.Interface
}

/** Public embedded OpenCode API for Effect-native applications. */
export class Service extends Context.Service<Service, Interface>()("@opencode/OpenCode") {}

const DefaultSessions = SessionV2.layer.pipe(
  Layer.provide(SessionProjector.layer),
  Layer.provide(SessionExecutionLocal.layer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(SessionStore.layer),
  Layer.provide(EventV2.layer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(ProjectV2.defaultLayer),
  Layer.orDie,
)

// TODO: Accept explicit storage so tests and embeddings can select disposable or application-owned persistence.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({ sessions: yield* SessionV2.Service })
  }),
).pipe(Layer.provide(DefaultSessions))

// TODO: Add OpenCode.create(...) as the Promise facade over the same embedded API semantics.
