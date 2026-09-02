export * as PluginSupervisor from "./supervisor-service.js"

import { Context, Effect } from "effect"

/**
 * Dependency-only supervisor seam. Keep this module free of implementation
 * imports: the supervisor reaches PluginRuntime, which depends on Session.
 */
export interface Interface {
  /**
   * Wait for configured plugin activation to settle, including missing-package installs.
   * Completion does not imply every plugin succeeded.
   * Interrupting this wait does not cancel activation. Use rarely: avoid blocking reads,
   * UI startup, or unrelated work on plugin boot.
   */
  readonly awaitActivation: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}
