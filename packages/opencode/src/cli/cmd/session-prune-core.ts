export type PruneSession = {
  id: string
  parentID?: string
  title?: string
  share?: { url: string }
  time: {
    updated: number
    compacting?: number
  }
}

export type PruneStatus = {
  type: string
}

const durationUnits = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
} as const

type DurationUnit = keyof typeof durationUnits

export type PruneCandidate = {
  root: PruneSession
  sessions: PruneSession[]
}

export function parsePruneDuration(value: string): number | undefined {
  const match = /^(\d+)([mhdw])$/.exec(value.trim())
  if (!match) return undefined

  const amount = Number(match[1])
  const unit = match[2] as DurationUnit
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined

  const duration = amount * durationUnits[unit]
  if (!Number.isSafeInteger(duration)) return undefined
  return duration
}

function collectFamily(
  root: PruneSession,
  children: ReadonlyMap<string, PruneSession[]>,
  visited = new Set<string>(),
): PruneSession[] {
  if (visited.has(root.id)) return []
  visited.add(root.id)
  return [root, ...(children.get(root.id) ?? []).flatMap((child) => collectFamily(child, children, visited))]
}

function sessionFamilies(sessions: PruneSession[]) {
  const children = new Map<string, PruneSession[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const entries = children.get(session.parentID) ?? []
    entries.push(session)
    children.set(session.parentID, entries)
  }

  return sessions
    .filter((session) => !session.parentID)
    .map((root) => ({ root, sessions: collectFamily(root, children) }))
}

export function selectPruneCandidates(
  sessions: PruneSession[],
  cutoff: number,
  active: ReadonlyMap<string, PruneStatus>,
): PruneCandidate[] {
  return sessionFamilies(sessions).filter(({ root, sessions: family }) => {
    if (root.share || family.some((session) => session.share)) return false
    if (family.some((session) => session.time.compacting !== undefined)) return false
    if (
      family.some((session) => {
        const status = active.get(session.id)
        return status !== undefined && status.type !== "idle"
      })
    )
      return false
    return family.every((session) => session.time.updated < cutoff)
  })
}
