import { base64Encode } from "@opencode-ai/core/util/encode"
import { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { useServerSync } from "@/context/server-sync"
import { createMemo, createSignal, onMount } from "solid-js"

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function legacySessionHref(directory: string, sessionID: string) {
  return `/${base64Encode(directory)}/session/${sessionID}`
}

export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")
  return ServerConnection.Key.make(key)
}

export function legacySessionServer(
  tabs: readonly { type: "session"; server: ServerConnection.Key; sessionId: string }[],
  sessionID: string,
  active: ServerConnection.Key,
) {
  const matches = tabs.filter((tab) => tab.sessionId === sessionID)
  return matches.find((tab) => tab.server === active)?.server ?? (matches.length === 1 ? matches[0]?.server : active)
}

type SessionParent = { id: string; parentID?: string }

// Reactive session lineage for the target session route, read from the sync store.
// The route keys its consumer to the session ID, so resolution runs once per target.
// Resolution is imperative rather than a resource on purpose: a resource created here
// would be created inside the router's navigation transition, and suspending that
// transition deadlocks the URL commit and double-mounts the session header portals
// from the transition's shadow render. `lineage.resolve` fills the sync store, which
// the returned accessor observes; resolve failures rethrow on read so the enclosing
// SessionRouteErrorBoundary renders the scoped session error.
export function createSessionLineage(sessionID: () => string) {
  const sync = useServerSync()
  const cached = createMemo(() => sync().session.lineage.peek(sessionID()))
  const [failure, setFailure] = createSignal<unknown>()
  const [settled, setSettled] = createSignal(false)
  onMount(() => {
    if (cached()) {
      setSettled(true)
      return
    }
    sync()
      .session.lineage.resolve(sessionID())
      .then(() => setSettled(true))
      .catch((error) => setFailure(() => error))
  })
  return createMemo(() => {
    const error = failure()
    if (error) throw error
    const lineage = cached()
    // The viewed session is pinned and pinned lineages are exempt from cache pruning,
    // so a lineage missing after settlement means the session (or an ancestor) was
    // deleted, possibly by another client. Match the resolve error so the boundary
    // shows the session not found fallback.
    if (!lineage && settled()) throw new Error(`Session not found: ${sessionID()}`)
    return lineage
  })
}

export async function rootSession<T extends SessionParent>(session: T, get: (sessionID: string) => Promise<T>) {
  const seen = new Set([session.id])
  let current = session
  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
  }
  return current
}
