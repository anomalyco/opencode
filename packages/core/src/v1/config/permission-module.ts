export * as ConfigPermissionModule from "./permission-module"

import { PermissionModule } from "@kancode/schema/permission-module"

/** Wire-safe permission module options (re-export schema contracts). */
export const Options = PermissionModule.Options
export type Options = PermissionModule.Options

export const Instructions = PermissionModule.Instructions
export type Instructions = PermissionModule.Instructions

export const Info = PermissionModule.Info
export type Info = PermissionModule.Info
