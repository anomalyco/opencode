export * as ConfigPermissionModule from "./permission-module"

import { PermissionModule } from "@opencode-ai/schema/permission-module"

/** Wire-safe permission module options (re-export schema contracts). */
export const Options = PermissionModule.Options
export type Options = PermissionModule.Options

export const Info = PermissionModule.Info
export type Info = PermissionModule.Info

export const CRUISE_CONTROL = PermissionModule.CRUISE_CONTROL
export const Fallback = PermissionModule.Fallback
export type Fallback = PermissionModule.Fallback
