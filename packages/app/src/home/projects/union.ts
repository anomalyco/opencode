import { aliasPathKey, pathKey } from "@/workspaces/path-key"
import type { SessionInfo } from "@opencode/client/promise"
import { RECENTLY_CLOSED_DISPLAY_LIMIT } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"

export type HomeProjectUnionDb = Pick<LocalProject, "worktree"> & Partial<LocalProject>

type UnionItem = Pick<LocalProject, "worktree"> &
  Partial<Pick<LocalProject, "id" | "expanded" | "sandboxes" | "name" | "icon">> & {
    id?: string
    sandboxes?: readonly string[]
    expanded?: boolean
  }

function aliasKeys(worktree: string, sandboxes?: readonly string[]) {
  const keys = [aliasPathKey(worktree)]
  for (const sandbox of sandboxes ?? []) keys.push(aliasPathKey(sandbox))
  return keys
}

function isUnionSession(session: SessionInfo) {
  if (session.parentID) return false
  if (typeof session.time.archived === "number") return false
  return true
}

// Union client opened order + DB sync + distinct session dirs.
// Order: client > db > orphan. ID-only dedupe first (never merge
// distinct IDs by path prefix), alias second-pass via aliasPathKey
// (E:/ vs /mnt collapse, Rememory vs Rememory2 stay distinct).
// Read-only; no DB writes. Enrich is reused for DB/orphan rows so
// local icon overrides and metadata stay consistent with open rows.
export function buildHomeProjectUnion(input: {
  client: readonly LocalProject[]
  db: readonly HomeProjectUnionDb[]
  sessions: readonly SessionInfo[]
  enrich: (project: { worktree: string; expanded: boolean }) => LocalProject
}): LocalProject[] {
  const seenIDs = new Set<string>()
  const seenAlias = new Set<string>()
  const out: LocalProject[] = []

  const claim = (item: UnionItem) => {
    if (item.id) {
      if (seenIDs.has(item.id)) return false
    }
    const keys = aliasKeys(item.worktree, item.sandboxes)
    if (keys.some((key) => seenAlias.has(key))) return false
    if (item.id) seenIDs.add(item.id)
    for (const key of keys) seenAlias.add(key)
    return true
  }

  for (const item of input.client) {
    if (!claim(item)) continue
    out.push(item)
  }

  for (const raw of input.db) {
    if (raw.id && seenIDs.has(raw.id)) continue
    const keys = aliasKeys(raw.worktree, raw.sandboxes)
    if (keys.some((key) => seenAlias.has(key))) continue
    const enriched = input.enrich({ worktree: raw.worktree, expanded: false })
    // Preserve DB identity when enrich misses; enrich keeps local icon
    // overrides via childStore, so it wins over raw except for identity.
    const merged = {
      ...raw,
      ...enriched,
      worktree: raw.worktree,
      expanded: false,
      id: enriched.id ?? raw.id,
    } as LocalProject
    if (!claim(merged)) continue
    out.push(merged)
  }

  for (const session of input.sessions) {
    if (!isUnionSession(session)) continue
    if (seenIDs.has(session.projectID)) continue
    if (seenAlias.has(aliasPathKey(session.location.directory))) continue
    const enriched = input.enrich({ worktree: session.location.directory, expanded: false })
    const row = {
      ...enriched,
      id: enriched.id ?? session.projectID,
      worktree: session.location.directory,
      expanded: false,
    } as LocalProject
    if (!claim(row)) continue
    out.push(row)
  }

  return out
}

// Recently closed stays filtered to DB-known worktrees (pathKey exact,
// matching runtime enrich semantics) and capped at the display limit.
// Read-only; no DB writes.
export function buildHomeRecentlyClosed(input: {
  closed: readonly string[]
  known: readonly Pick<LocalProject, "worktree">[]
  enrich: (project: { worktree: string; expanded: boolean }) => LocalProject
  limit?: number
}): LocalProject[] {
  const limit = input.limit ?? RECENTLY_CLOSED_DISPLAY_LIMIT
  const knownKeys = new Set(input.known.map((project) => pathKey(project.worktree)))
  return input.closed
    .filter((worktree) => knownKeys.has(pathKey(worktree)))
    .slice(0, limit)
    .map((worktree) => input.enrich({ worktree, expanded: false }))
}
