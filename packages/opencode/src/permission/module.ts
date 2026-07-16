export * as PermissionModule from "./module"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionModule as CorePermissionModule } from "@opencode-ai/core/permission/module"

export type Decision = CorePermissionModule.Decision
export type DecideResult = CorePermissionModule.DecideResult
export type DecideInput = CorePermissionModule.DecideInput
export type DecideFn = CorePermissionModule.DecideFn
export type Interface = CorePermissionModule.Interface
export type RegisterInput = CorePermissionModule.RegisterInput
export const Service = CorePermissionModule.Service
export const RegistrationError = CorePermissionModule.RegistrationError
export const isReservedModuleID = CorePermissionModule.isReservedModuleID
export const normalizeDecide = CorePermissionModule.normalizeDecide

/**
 * Empty module registry. Built-in `cruise_control` is registered by the
 * Cruise Control internal plugin via `permission.registerModule`.
 */
export const layer = CorePermissionModule.emptyLayer

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [],
})
