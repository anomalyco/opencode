import type { SessionInfo } from "@opencode/client"
import { readJson, writeJsonAtomic } from "./util/persistence"
import { isRecord } from "./util/record"

/** Team sessions are titled `<team>-<n> (leader|member)` by the subagent tool. */
const TEAM_TITLE = /^(.*)-(\d+) \((leader|member)\)(?:\s*[—–-]\s*|\s*$)/

export type TeamIdentity = {
  readonly name: string
  readonly position: number
  readonly role: "leader" | "member"
}

export function parseTeam(title: string | undefined): TeamIdentity | undefined {
  if (!title) return
  const match = TEAM_TITLE.exec(title)
  if (!match) return
  const position = Number(match[2])
  if (!Number.isInteger(position)) return
  return { name: match[1], position, role: match[3] as TeamIdentity["role"] }
}

/** Number of pinned slots for frequently used teams. */
export const TEAM_SLOTS = 4

export type TeamSlots = Record<string, readonly string[]>

export function decodeTeamSlots(value: unknown): TeamSlots {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (key.length === 0 || !Array.isArray(item)) return []
      const names = item.filter((name): name is string => typeof name === "string" && name.length > 0)
      return [[key, names.slice(0, TEAM_SLOTS)] as const]
    }),
  )
}

/** Inserts a newly used team at the front, keeping existing slot order and evicting the oldest. */
export function promoteTeam(slots: TeamSlots, key: string, team: string): TeamSlots {
  const current = slots[key] ?? []
  if (current.includes(team)) return slots
  return { ...slots, [key]: [team, ...current].slice(0, TEAM_SLOTS) }
}

export function teamLocationKey(location: { directory: string; workspaceID?: string }) {
  return JSON.stringify([location.directory, location.workspaceID])
}

export function createTeamSlotRepository(filePath: string) {
  const state = { pending: Promise.resolve() as Promise<unknown> }
  const read = () =>
    readJson<unknown>(filePath)
      .then(decodeTeamSlots)
      .catch(() => decodeTeamSlots(undefined))

  return {
    load: () => state.pending.then(read),
    save(value: TeamSlots) {
      const result = state.pending.then(() => writeJsonAtomic(filePath, value))
      state.pending = result.catch(() => undefined)
      return result
    },
  }
}

export type TeamGroup = {
  readonly team: string
  readonly sessions: readonly SessionInfo[]
}

/**
 * Groups family sessions by team. Slot teams keep their pinned order; other teams
 * follow by newest leader creation. Sessions inside a team are fixed by creation order.
 */
export function groupTeams(sessions: readonly SessionInfo[], slots: readonly string[]): TeamGroup[] {
  const teams = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    const parsed = parseTeam(session.title)
    if (!parsed) continue
    const group = teams.get(parsed.name)
    if (group) group.push(session)
    else teams.set(parsed.name, [session])
  }

  const created = (group: SessionInfo[]) => Math.min(...group.map((session) => session.time.created))
  const order = (group: SessionInfo[]) =>
    [...group].sort((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id))

  const pinned = slots.filter((team) => teams.has(team))
  const rest = [...teams.keys()]
    .filter((team) => !pinned.includes(team))
    .sort((a, b) => created(teams.get(b)!) - created(teams.get(a)!) || a.localeCompare(b))

  return [...pinned, ...rest].map((team) => ({ team, sessions: order(teams.get(team)!) }))
}
