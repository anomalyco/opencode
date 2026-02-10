export type SessionTreeSession = {
  id: string
  parentID?: string
  time?: {
    created?: number
    updated?: number
  }
}

export type SessionTreeItem = {
  id: string
  depth: number
}

function sessionTime<T extends SessionTreeSession>(session: T | undefined, key: "created" | "updated"): number {
  const time = session?.time
  if (!time) return 0
  if (key === "created") return time.created ?? 0
  return time.updated ?? 0
}

export function resolveRootID<T extends SessionTreeSession>(input: {
  currentSessionID: string
  sessionByID: Map<string, T>
}): string {
  const visited = new Set<string>()
  let current = input.currentSessionID

  while (!visited.has(current)) {
    visited.add(current)

    const session = input.sessionByID.get(current)
    const parent = session?.parentID
    if (!parent) return current
    if (!input.sessionByID.has(parent)) return parent
    current = parent
  }

  return input.currentSessionID
}

export function buildSessionTree<T extends SessionTreeSession>(input: {
  currentSessionID: string
  sessions: T[]
  sort?: "created" | "updated"
}): {
  rootID: string
  list: SessionTreeItem[]
  sessionByID: Map<string, T>
} {
  const sessionByID = new Map(input.sessions.map((s) => [s.id, s]))
  const rootID = resolveRootID({
    currentSessionID: input.currentSessionID,
    sessionByID,
  })

  const childrenByParent = new Map<string, string[]>()
  for (const session of input.sessions) {
    const parent = session.parentID
    if (!parent) continue
    const list = childrenByParent.get(parent)
    if (list) {
      list.push(session.id)
      continue
    }
    childrenByParent.set(parent, [session.id])
  }

  const sortKey = input.sort ?? "created"
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => {
      const at = sessionTime(sessionByID.get(a), sortKey)
      const bt = sessionTime(sessionByID.get(b), sortKey)
      if (at !== bt) return at - bt
      return a.localeCompare(b)
    })
  }

  const seen = new Set<string>([rootID])
  const stack: SessionTreeItem[] = [{ id: rootID, depth: 0 }]
  const out: SessionTreeItem[] = []

  while (stack.length > 0) {
    const item = stack.pop()
    if (!item) continue

    out.push(item)

    const children = childrenByParent.get(item.id) ?? []
    for (const child of children.toReversed()) {
      if (seen.has(child)) continue
      seen.add(child)
      stack.push({ id: child, depth: item.depth + 1 })
    }
  }

  return {
    rootID,
    list: out,
    sessionByID,
  }
}

export type SessionRunState = "working" | "waiting" | "done"

export function sessionRunState(status: { type?: string } | undefined): SessionRunState {
  if (status?.type === "busy" || status?.type === "retry") return "working"
  if (status?.type === "waiting") return "waiting"
  return "done"
}
