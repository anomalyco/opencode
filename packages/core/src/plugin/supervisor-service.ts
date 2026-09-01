export * as PluginSupervisor from "./supervisor-service.js"

import { Context, Effect } from "effect"

/**
 * Dependency-only supervisor seam. Keep this module free of implementation
 * imports: the supervisor reaches PluginRuntime, which depends on Session.
 */
export interface Interface {
  /**
   * Wait for the plugin generation to settle. Use this rarely: blocking reads,
   * UI startup, or other unrelated work on plugin boot should be avoided.
   */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}
