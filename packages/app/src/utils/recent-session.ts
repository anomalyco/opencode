import { getFilename } from "@opencode-ai/core/util/path"
import { type GlobalSession } from "@opencode-ai/sdk/v2/client"
import { DateTime } from "luxon"

export type RecentSection = {
  label: string
  items: GlobalSession[]
}

export type RecentFlatEntry = {
  session: GlobalSession
  depth: number
}

type Clock = DateTime<true> | DateTime<false>

export const recentTime = (session: { time: { created: number; updated: number } }) => {
  return session.time.updated ?? session.time.created
}

const key = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "") || "/"

export const recentPrefix = (session: GlobalSession) => {
  const dir = getFilename(session.directory) || session.directory
  const project = session.project
  if (!project) return dir

  const root = getFilename(project.worktree) || project.worktree
  if (key(session.directory) === key(project.worktree)) return root
  if (dir === root) return root
  return `${root} / ${dir}`
}

function rank(a: GlobalSession, b: GlobalSession) {
  const diff = recentTime(b) - recentTime(a)
  if (diff) return diff
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function section(ts: number, now: Clock) {
  const day = now.startOf("day")
  const date = DateTime.fromMillis(ts)

  if (date >= day) return "Today"
  if (date >= day.minus({ days: 1 })) return "Yesterday"
  if (date >= day.minus({ days: 7 })) return "Previous 7 Days"
  if (date >= day.minus({ days: 30 })) return "Previous 30 Days"
  if (date.year === now.year) return date.toFormat("LLLL")
  return date.toFormat("LLLL yyyy")
}

export function organizeRecentSessions(list: GlobalSession[], now: Clock = DateTime.local()) {
  const lookup = new Map<string, GlobalSession>(list.map((session) => [session.id, session]))
  const children = new Map<string, string[]>()
  const prefixes = new Map<string, string>()

  for (const session of list) {
    prefixes.set(session.id, recentPrefix(session))
    if (!session.parentID) continue
    if (!lookup.has(session.parentID)) continue
    const items = children.get(session.parentID) ?? []
    items.push(session.id)
    children.set(session.parentID, items)
  }

  const latest = new Map<string, number>()
  const visit = (session: GlobalSession): number => {
    const cached = latest.get(session.id)
    if (cached !== undefined) return cached

    const child = children.get(session.id) ?? []
    const value = child.reduce((max, id) => {
      const item = lookup.get(id)
      if (!item) return max
      return Math.max(max, visit(item))
    }, recentTime(session))

    latest.set(session.id, value)
    return value
  }

  const roots = list
    .filter((session) => !session.parentID)
    .sort((a, b) => {
      const diff = visit(b) - visit(a)
      if (diff) return diff
      return rank(a, b)
    })

  const sections: RecentSection[] = []
  for (const session of roots) {
    const label = section(visit(session), now)
    const last = sections[sections.length - 1]
    if (!last || last.label !== label) {
      sections.push({ label, items: [session] })
      continue
    }
    last.items.push(session)
  }

  return {
    lookup,
    children,
    prefixes,
    roots,
    sections,
  }
}

export function flattenRecentRoots(input: {
  roots: GlobalSession[]
  lookup: Map<string, GlobalSession>
  children: Map<string, string[]>
}) {
  const result: RecentFlatEntry[] = []

  const walk = (session: GlobalSession, depth: number) => {
    result.push({ session, depth })
    for (const id of input.children.get(session.id) ?? []) {
      const child = input.lookup.get(id)
      if (!child) continue
      walk(child, depth + 1)
    }
  }

  for (const session of input.roots) {
    walk(session, 0)
  }

  return result
}
