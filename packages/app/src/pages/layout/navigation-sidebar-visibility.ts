import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { compareSessionTime, displayName, projectForSession } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"

export const SIDEBAR_SESSION_DAY = 86_400_000

export type SidebarSessionRecord = {
  session: Session
  project: LocalProject
  name: string
}

export type SidebarProjectGroup = {
  key: string
  project: LocalProject
  name: string
  records: SidebarSessionRecord[]
}

export function buildSidebarRecords(input: { sessions: Session[]; projects: LocalProject[] }) {
  const projectByID = new Map(input.projects.flatMap((project) => (project.id ? [[project.id, project]] : [])))
  const directories = new Set(
    input.projects.flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])]).map(pathKey),
  )
  const sessions = input.sessions
    .filter((session) => directories.has(pathKey(session.directory)))
    .filter((session) => !session.parentID)
  const unique = [...new Map(sessions.map((session) => [session.id, session] as const)).values()].sort(
    compareSessionTime,
  )
  return unique.flatMap((session): SidebarSessionRecord[] => {
    const directory = pathKey(session.directory)
    const project =
      input.projects.find(
        (item) => pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
      ) ?? projectForSession(session, input.projects, projectByID)
    if (!project) return []
    return [{ session, project, name: displayName(project) }]
  })
}

export function groupSidebarRecords(records: SidebarSessionRecord[]): SidebarProjectGroup[] {
  return [
    ...records
      .reduce((groups, record) => {
        const key = pathKey(record.project.worktree)
        const group = groups.get(key)
        if (group) group.records.push(record)
        if (!group) groups.set(key, { key, project: record.project, name: record.name, records: [record] })
        return groups
      }, new Map<string, SidebarProjectGroup>())
      .values(),
  ]
}

export function sidebarSessionAge(session: Session, now: number) {
  return Math.max(0, now - (session.time.updated || session.time.created))
}

/**
 * Working, open and currently viewed sessions stay pinned regardless of age so the sidebar never
 * hides a session the user is actively waiting on.
 */
export function partitionSidebarRecords(input: {
  records: SidebarSessionRecord[]
  pinned: (record: SidebarSessionRecord) => boolean
  days: number
  now: number
}) {
  const cutoff = input.days <= 0 ? Number.POSITIVE_INFINITY : input.days * SIDEBAR_SESSION_DAY
  return input.records.reduce(
    (groups, record) => {
      const visible = input.pinned(record) || sidebarSessionAge(record.session, input.now) <= cutoff
      groups[visible ? "visible" : "hidden"].push(record)
      return groups
    },
    { visible: [] as SidebarSessionRecord[], hidden: [] as SidebarSessionRecord[] },
  )
}

export function matchesSidebarFilter(record: SidebarSessionRecord, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return record.name.toLowerCase().includes(needle) || (record.session.title ?? "").toLowerCase().includes(needle)
}
