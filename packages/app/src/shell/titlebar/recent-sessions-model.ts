import type { SessionInfo } from "@opencode/client/promise"

const separator = "\u0000"

export type RecentSession = {
  /** `${server}\u0000${sessionID}`, the same key the pin order stores. */
  key: string
  server: string
  session: SessionInfo
}

export function recentSessionKey(server: string, sessionID: string) {
  return `${server}${separator}${sessionID}`
}

export function splitRecentSessionKey(key: string) {
  const index = key.indexOf(separator)

  if (index === -1) return

  return { server: key.slice(0, index), sessionID: key.slice(index + 1) }
}

/** Pins append to the end; pinning an existing session keeps its place. */
export function addPin(pins: readonly string[], key: string) {
  return pins.includes(key) ? [...pins] : [...pins, key]
}

export function removePin(pins: readonly string[], key: string) {
  return pins.includes(key) ? pins.filter((pin) => pin !== key) : [...pins]
}

/** Drops duplicate and malformed keys, keeping the first occurrence of each. */
export function dedupePins(pins: readonly string[]) {
  return [...new Set(pins)].filter((key) => {
    const parsed = splitRecentSessionKey(key)

    return !!parsed?.sessionID
  })
}

/**
 * Applies a new relative order for the pins a list shows, keeping pins it hides (archived sessions) in their slots.
 * Returns the current order when the visible keys are not the same set.
 */
export function reorderPins(pins: readonly string[], visible: readonly string[], nextVisible: readonly string[]) {
  if (nextVisible.length !== visible.length) return [...pins]

  if (new Set(nextVisible).size !== nextVisible.length) return [...pins]

  const shown = new Set(visible)

  if (nextVisible.some((key) => !shown.has(key))) return [...pins]

  let index = 0

  return pins.map((pin) => (shown.has(pin) ? nextVisible[index++] : pin))
}

/** Recent sessions sort by their latest activity, then by ID so equal timestamps keep one stable order. */
export function compareRecentSessions(a: RecentSession, b: RecentSession) {
  const updated =
    (b.session.time.updated ?? b.session.time.created) - (a.session.time.updated ?? a.session.time.created)

  if (updated !== 0) return updated

  if (a.session.id !== b.session.id) return a.session.id < b.session.id ? -1 : 1

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export function sortRecentSessions(items: readonly RecentSession[]) {
  return [...items].sort(compareRecentSessions)
}

function recent(server: string, sessions: readonly SessionInfo[]) {
  return sessions.flatMap((session): RecentSession[] => {
    if (session.parentID || session.time.archived !== undefined) return []

    return [{ key: recentSessionKey(server, session.id), server, session }]
  })
}

/**
 * A refreshed first page. Before older pages load it replaces the snapshot; afterwards it merges into them, and the
 * caller keeps the cursor it already advanced. Incoming rows win for the same session.
 */
export function mergeFirstPage(
  existing: readonly SessionInfo[],
  incoming: readonly SessionInfo[],
  olderLoaded: boolean,
) {
  if (!olderLoaded) return [...incoming]

  return [...new Map([...existing, ...incoming].map((session) => [session.id, session] as const)).values()]
}

/** One server's sessions plus the live store, keeping root, unarchived sessions. Live entries win. */
export function mergeRecentSessions(
  server: string,
  fetched: readonly SessionInfo[],
  known: readonly SessionInfo[],
) {
  return sortRecentSessions(
    recent(server, [...new Map([...fetched, ...known].map((session) => [session.id, session] as const)).values()]),
  )
}

/** Search results with the live store's copy of each matching session. Only sessions the server returned remain. */
export function mergeSessionSearch(
  server: string,
  results: readonly SessionInfo[],
  known: readonly SessionInfo[],
) {
  const current = new Map(known.map((session) => [session.id, session] as const))

  return sortRecentSessions(recent(server, results.map((session) => current.get(session.id) ?? session)))
}

/**
 * Pinned sessions keep their stored order and leave Recent. A pin whose session is archived is hidden but kept;
 * one that is not loaded yet resolves through `resolvePin`.
 */
export function partitionRecentSessions(input: {
  items: readonly RecentSession[]
  pins: readonly string[]
  resolvePin: (key: string) => RecentSession | undefined
  archived: (key: string) => boolean
}) {
  const byKey = new Map(input.items.map((item) => [item.key, item] as const))

  const pinned = input.pins.flatMap((key): RecentSession[] => {
    if (input.archived(key)) return []
    const item = byKey.get(key) ?? input.resolvePin(key)

    if (!item || item.session.time.archived !== undefined) return []

    return [item]
  })

  const pinnedKeys = new Set([...input.pins, ...pinned.map((item) => item.key)])

  return { pinned, recent: input.items.filter((item) => !pinnedKeys.has(item.key)) }
}
