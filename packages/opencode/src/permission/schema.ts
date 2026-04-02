import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { Newtype } from "@/util/schema"

export class PermissionID extends Newtype<PermissionID>()("PermissionID", Schema.String) {
  static make(id: string): PermissionID {
    return this.makeUnsafe(id)
  }

  static ascending(id?: string): PermissionID {
    return this.makeUnsafe(Identifier.ascending("permission", id))
  }

  static readonly zod = Identifier.schema("permission") as unknown as z.ZodType<PermissionID>
}

/**
 * Permission modes control how permissions are handled:
 * - "default": Ask for permission on write operations and bash commands
 * - "plan": Read-only mode - blocks all write operations and bash commands
 * - "acceptEdits": Auto-approve file edits within working directory, ask for bash
 * - "bypassPermissions": Skip all permission checks (dangerous)
 */
export const PermissionMode = z.enum(["default", "plan", "acceptEdits", "bypassPermissions"]).meta({
  ref: "PermissionMode",
})
export type PermissionMode = z.infer<typeof PermissionMode>

export const DEFAULT_PERMISSION_MODE: PermissionMode = "default"

/**
 * Get the next mode in the cycle: default -> acceptEdits -> plan -> bypassPermissions -> default
 */
export function getNextPermissionMode(mode: PermissionMode): PermissionMode {
  const order: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"]
  const idx = order.indexOf(mode)
  return order[(idx + 1) % order.length]
}
