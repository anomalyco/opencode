import type { Accessor } from "solid-js"
import type { Project } from "@opencode-ai/sdk/v2"
import type { ProjectMeta } from "./global-sync/types"

/**
 * Merge per-workspace overrides from localStorage on top of the database
 * metadata for a project.
 *
 * `meta` (the `projectMeta` cache: name/color/commands/icon) is only populated
 * for projects that resolve to the shared "global" id (non-git directories),
 * where every directory shares a single database row and needs its own local
 * overrides to be distinguishable. `iconOverride` (the per-workspace `icon`
 * cache) lets subdirectories of the same git repo carry individual icons.
 *
 * Icon precedence is database < projectMeta < per-workspace icon cache.
 */
export function mergeProjectOverrides<T extends { worktree: string; expanded: boolean }>(input: {
  metadata: Partial<Project> | undefined
  meta: ProjectMeta | undefined
  iconOverride: string | undefined
  project: T
}): Partial<Project> & T {
  const { metadata, meta, iconOverride, project } = input
  const base = { ...metadata, ...meta, ...project }

  const override = iconOverride ?? meta?.icon?.override
  if (meta?.icon || override) {
    base.icon = { ...metadata?.icon, ...meta?.icon, ...(override ? { override } : {}) }
  }
  return base
}

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}
