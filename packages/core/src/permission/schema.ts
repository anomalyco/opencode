export * as PermissionSchema from "./schema"

import { Permission } from "@opencode-ai/schema/permission"

export const Effect = Permission.Effect
export type Effect = Permission.Effect

export const Rule = Permission.Rule
export type Rule = Permission.Rule

export const Ruleset = Permission.Ruleset
export type Ruleset = Permission.Ruleset
