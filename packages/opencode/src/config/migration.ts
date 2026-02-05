import os from "os"
import { mergeDeep } from "remeda"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"
import type { Info, PermissionAction } from "./schema"

const log = Log.create({ service: "config" })

/**
 * Migrate deprecated `mode` field entries to `agent` field with mode: "primary".
 */
export function migrateModesToAgents(result: Info): void {
  for (const [name, mode] of Object.entries(result.mode ?? {})) {
    result.agent = mergeDeep(result.agent ?? {}, {
      [name]: {
        ...mode,
        mode: "primary" as const,
      },
    })
  }
}

/**
 * Apply OPENCODE_PERMISSION flag override.
 */
export function applyPermissionFlag(result: Info): void {
  if (Flag.OPENCODE_PERMISSION) {
    try {
      result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
    } catch (e) {
      log.error("failed to parse OPENCODE_PERMISSION", { error: e })
    }
  }
}

/**
 * Migrate legacy top-level `tools` config to `permission` field.
 */
export function migrateLegacyTools(result: Info): void {
  if (result.tools) {
    const perms: Record<string, PermissionAction> = {}
    for (const [tool, enabled] of Object.entries(result.tools)) {
      const action: PermissionAction = enabled ? "allow" : "deny"
      if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
        perms.edit = action
        continue
      }
      perms[tool] = action
    }
    result.permission = mergeDeep(perms, result.permission ?? {})
  }
}

/**
 * Set default username from system if not configured.
 */
export function applyDefaultUsername(result: Info): void {
  if (!result.username) result.username = os.userInfo().username
}

/**
 * Migrate deprecated `autoshare` field to `share` field.
 */
export function migrateAutoshare(result: Info): void {
  if (result.autoshare === true && !result.share) {
    result.share = "auto"
  }
}

/**
 * Apply flag overrides for compaction settings.
 */
export function applyCompactionFlags(result: Info): void {
  if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) {
    result.compaction = { ...result.compaction, auto: false }
  }
  if (Flag.OPENCODE_DISABLE_PRUNE) {
    result.compaction = { ...result.compaction, prune: false }
  }
}

/**
 * Apply all migrations and flag overrides to a config result.
 */
export function applyMigrations(result: Info): void {
  migrateModesToAgents(result)
  applyPermissionFlag(result)
  migrateLegacyTools(result)
  applyDefaultUsername(result)
  migrateAutoshare(result)
  applyCompactionFlags(result)
}
