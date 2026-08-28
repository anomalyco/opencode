export * as PluginSupervisor from "./supervisor-service.js"

import { Context, Effect } from "effect"
import type { Plugin } from "@opencode-ai/schema/plugin"

/**
 * Dependency-only supervisor seam. Keep this module free of implementation
 * imports: the supervisor reaches PluginRuntime, which depends on Session.
 */
export interface Interface {
  /** Wait for the initial plugin generation and startup updates to settle. */
  readonly flush: Effect.Effect<void>
  readonly check: (target: string) => Effect.Effect<Plugin.PackageStatus, Plugin.CheckError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}
