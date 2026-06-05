export * as SessionExecution from "./execution"

import { Context, Effect, Layer } from "effect"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"

export interface Interface {
  /** Explicitly drain one Session, making at least one provider attempt. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Schedule a drain after durable work is recorded. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
}

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionExecution") {}

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(Service, Service.of({ resume: () => Effect.void, wake: () => Effect.void }))
