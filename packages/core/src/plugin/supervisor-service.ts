export * as PluginSupervisor from "./supervisor-service.js"

import { Context, Effect, Layer } from "effect"

/**
 * Dependency-only supervisor seam. Keep this module free of implementation
 * imports: the supervisor reaches PluginRuntime, which depends on Session.
 */
export interface Interface {
  /** Wait for the initial plugin generation and startup updates to settle. */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}

/** For values-constructed environments: no plugin generations exist, so flush settles immediately. */
export const noop = Layer.succeed(Service, Service.of({ flush: Effect.void }))
