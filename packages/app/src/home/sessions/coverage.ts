import type { SessionInfo } from "@opencode/client/promise"
import { aliasPathKey, directorySpellings } from "@/workspaces/path-key"
import { mapWithProjectListConcurrency } from "./budget"

export const PROJECT_LIST_DEFAULT_LIMIT = 50
export const PROJECT_LIST_MAX_PAGES = 100

export type CoverageProject = {
  id: string
  worktree: string
  sandboxes?: readonly string[]
  expanded?: boolean
}

export function isCoverageSession(session: SessionInfo) {
  if (session.parentID) return false
  if (typeof session.time.archived === "number") return false
  return true
}

export function dedupeProjectsByID<T extends CoverageProject>(projects: readonly T[]) {
  const seen = new Set<string>()
  return projects.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function unionSessionLists(a: readonly SessionInfo[], b: readonly SessionInfo[]) {
  return [...new Map([...a, ...b].map((session) => [session.id, session] as const)).values()]
}

export function isOrphanSession(session: SessionInfo, projectIDs: ReadonlySet<string>) {
  return !projectIDs.has(session.projectID)
}

function projectMatchesDirectory(project: CoverageProject, directory: string) {
  const key = aliasPathKey(directory)
  if (aliasPathKey(project.worktree) === key) return true
  return project.sandboxes?.some((sandbox) => aliasPathKey(sandbox) === key) ?? false
}

export function collectProjectCoverage(input: {
  clientProjects: readonly CoverageProject[]
  dbProjects: readonly CoverageProject[]
  sessions: readonly SessionInfo[]
}) {
  const projects = dedupeProjectsByID([...input.clientProjects, ...input.dbProjects])
  const sessions = [...new Map(input.sessions.filter(isCoverageSession).map((session) => [session.id, session] as const)).values()]
  const ids = new Set(projects.map((item) => item.id))
  const rows = [...projects]
  for (const session of sessions) {
    if (ids.has(session.projectID)) continue
    rows.push({ id: session.projectID, worktree: session.location.directory, expanded: false })
    ids.add(session.projectID)
  }
  const counts: Record<string, number> = {}
  for (const item of rows) counts[item.id] = 0
  for (const session of sessions) {
    const direct = rows.find((item) => item.id === session.projectID)
    if (direct) {
      counts[direct.id] += 1
      continue
    }
    const byDir = rows.find((item) => projectMatchesDirectory(item, session.location.directory))
    if (byDir) counts[byDir.id] += 1
  }
  return { projects: rows, counts, sessions }
}

export async function walkSessionPages(
  list: (
    input: { limit: number; cursor?: string },
    options?: { signal?: AbortSignal },
  ) => Promise<{ data: SessionInfo[]; cursor: { next?: string | null } }>,
  options?: { limit?: number; maxPages?: number; signal?: AbortSignal },
) {
  const limit = options?.limit ?? PROJECT_LIST_DEFAULT_LIMIT
  const maxPages = options?.maxPages ?? PROJECT_LIST_MAX_PAGES
  const out: SessionInfo[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const response = await list(cursor ? { limit, cursor } : { limit }, { signal: options?.signal })
    out.push(...response.data)
    const next = response.cursor.next ?? undefined
    if (!next) return out
    if (response.data.length === 0) return out
    if (seen.has(next)) return out
    seen.add(next)
    cursor = next
  }
  return out
}

// Dual-query E:/ + /mnt coverage walk: expand each directory to its verbatim
// spellings, walk each spelling with limit-50 pagination (!next/empty/
// repeated + cap), fan out with p-limit 5, then union by session ID.
// Project-row matching stays ID-first then aliasPathKey in
// collectProjectCoverage. Read-only; no DB writes.
export async function walkCoverageSessionsForDirectories(
  directories: readonly string[],
  listByDirectory: (
    directory: string,
    input: { limit: number; cursor?: string },
    options?: { signal?: AbortSignal },
  ) => Promise<{ data: SessionInfo[]; cursor: { next?: string | null } }>,
  options?: { limit?: number; maxPages?: number; signal?: AbortSignal },
) {
  const spellings = [...new Set(directories.flatMap(directorySpellings))]
  const pages = await mapWithProjectListConcurrency(spellings, (directory) =>
    walkSessionPages((input, opts) => listByDirectory(directory, input, opts), options),
  )
  return pages.reduce<SessionInfo[]>((acc, cur) => unionSessionLists(acc, cur), [])
}
