/**
 * Per-prompt dynamic allow/deny action lists for cruise_control.
 *
 * Learned from successful classifier outcomes (after safety rails) so repeated
 * identical permission asks within the same user-prompt turn skip the LLM.
 * Scoped by workspace/session/prompt and cleared only for the affected session
 * on each new user prompt via the `chat.message` plugin hook.
 *
 * In-memory only (KanCode process state) — not written to kancode.json or a
 * state file, because the cache is intentionally short-lived per prompt.
 */

export const CACHED_ALLOW_REASON = "Cached allow (no fresh model review)"
export const CACHED_DENY_REASON = "Cached deny (no fresh model review)"

export const DEFAULT_DYNAMIC_LIST_MAX_SIZE = 256

export type DynamicListDecision = "allow" | "deny"

export type DynamicListOptions = {
  /** When false, skip lookup and remember (default: true). */
  enabled?: boolean
  /** Max entries per list; oldest evicted (default: 256). */
  max_size?: number
}

type ListStore = {
  allow: Map<string, true>
  deny: Map<string, true>
}

const stores = new Map<string, ListStore>()

function getStore(scope: string, create = false): ListStore | undefined {
  const current = stores.get(scope)
  if (current || !create) return current
  const next = { allow: new Map<string, true>(), deny: new Map<string, true>() }
  stores.set(scope, next)
  return next
}

/** Stable key: permission + normalized patterns (+ optional command fingerprint). */
export function actionKey(
  permission: string,
  patterns: readonly string[],
  metadata: Record<string, unknown> = {},
): string {
  const normalizedPatterns = patterns.map(normalizeToken).filter(Boolean).sort()
  const command = typeof metadata.command === "string" ? normalizeToken(metadata.command) : ""
  return [permission.trim().toLowerCase(), ...normalizedPatterns, command ? `cmd:${command}` : ""]
    .filter(Boolean)
    .join("\0")
}

function normalizeToken(raw: string): string {
  return raw.trim().toLowerCase().replaceAll("\\", "/").replace(/\s+/g, " ")
}

export function dynamicListEnabled(opts: DynamicListOptions | undefined): boolean {
  return opts?.enabled !== false
}

function maxSize(opts: DynamicListOptions | undefined): number {
  const n = opts?.max_size
  if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.floor(n)
  return DEFAULT_DYNAMIC_LIST_MAX_SIZE
}

function touch(map: Map<string, true>, key: string, limit: number) {
  if (map.has(key)) map.delete(key)
  map.set(key, true)
  while (map.size > limit) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

/**
 * Lookup cached decision. Deny wins if both lists somehow contain the key.
 * Returns undefined on miss.
 */
export function lookupDynamic(
  key: string,
  opts: DynamicListOptions | undefined,
  scope = "",
): DynamicListDecision | undefined {
  if (!dynamicListEnabled(opts)) return undefined
  const store = getStore(scope)
  if (!store) return undefined
  if (store.deny.has(key)) {
    touch(store.deny, key, maxSize(opts))
    return "deny"
  }
  if (store.allow.has(key)) {
    touch(store.allow, key, maxSize(opts))
    return "allow"
  }
  return undefined
}

/**
 * Remember a final binary decision after classifier + rails.
 * Removes the key from the opposite list.
 */
export function rememberDynamic(
  key: string,
  decision: DynamicListDecision,
  opts: DynamicListOptions | undefined,
  scope = "",
) {
  if (!dynamicListEnabled(opts)) return
  const store = getStore(scope, true)!
  const limit = maxSize(opts)
  if (decision === "deny") {
    store.allow.delete(key)
    touch(store.deny, key, limit)
    return
  }
  store.deny.delete(key)
  touch(store.allow, key, limit)
}

/** Clear all lists, or only scopes belonging to one workspace/session prefix. */
export function clearDynamicLists(scopePrefix?: string) {
  if (scopePrefix === undefined) {
    stores.clear()
    return
  }
  for (const scope of stores.keys()) {
    if (scope === scopePrefix || scope.startsWith(`${scopePrefix}\0`)) stores.delete(scope)
  }
}

/** Replace store contents (tests only). */
export function resetDynamicListsForTests(next?: { allow?: string[]; deny?: string[] }, scope = "") {
  stores.delete(scope)
  const store = getStore(scope, true)!
  for (const key of next?.allow ?? []) store.allow.set(key, true)
  for (const key of next?.deny ?? []) store.deny.set(key, true)
}
