import { sameLoopbackServer } from "@/runtime/server/loopback"
import { ServerConnection } from "@/runtime/server/registry"
import { rootSession } from "@/shell/routes/session"
import type { SessionTab, Tab } from "@/shell/tabs/tabs"
import { normalizeDeepLinkServerUrl, type SessionDeepLink } from "./machine"

// Matches `route-sync.ts` so a server that stops responding never stalls this link or later links in the queue.
const RESOLVE_TIMEOUT_MS = 15_000

export type DeepLinkSessionInfo = {
  readonly id: string
  readonly parentID?: string
}

export type SessionFetchResult =
  | { readonly status: "found"; readonly session: DeepLinkSessionInfo }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" }

export type SessionDeepLinkLookup = {
  readonly servers: readonly ServerConnection.Any[]
  readonly activeServer: ServerConnection.Key | undefined
  readonly cached: (server: ServerConnection.Key, sessionID: string) => DeepLinkSessionInfo | undefined
  readonly fetch: (server: ServerConnection.Key, sessionID: string, signal: AbortSignal) => Promise<SessionFetchResult>
}

export type SessionDeepLinkTabs = {
  readonly addSessionTab: (tab: Omit<SessionTab, "type">) => Tab
  readonly rememberSessionRoute: (tab: SessionTab, sessionId: string, parentId?: string) => void
  readonly select: (tab: Tab) => void
}

export type SessionDeepLinkResolution =
  | { readonly status: "found"; readonly server: ServerConnection.Key; readonly session: DeepLinkSessionInfo }
  | { readonly status: "unavailable"; readonly server: ServerConnection.Key }
  | { readonly status: "not-found" }
  | { readonly status: "unknown-server" }

export type SessionDeepLinkOutcome = "opened" | "not-found" | "unknown-server"

/** Matches a `?server=` URL against already-configured servers only; never accepts unknown origins. */
export function matchConfiguredServer(
  targetUrl: string,
  servers: readonly ServerConnection.Any[],
): ServerConnection.Key | undefined {
  const target = normalizeDeepLinkServerUrl(targetUrl)

  if (!target) return
  const targetPathname = new URL(target).pathname

  for (const conn of servers) {
    const url = ServerConnection.http(conn)?.url
    const normalized = normalizeDeepLinkServerUrl(url)

    if (!normalized) continue

    if (normalized === target) return ServerConnection.key(conn)

    if (new URL(normalized).pathname === targetPathname && sameLoopbackServer(normalized, target)) {
      return ServerConnection.key(conn)
    }
  }

  return
}

/**
 * Resolves which configured server should open a session deep link.
 * Explicit `?server=` matches only configured servers and rejects confirmed not-found sessions.
 * Without `?server=`, checks cached and connected servers (preferring the active server) and returns `not-found`
 * when no server owns the session.
 */
export async function resolveSessionDeepLink(
  link: SessionDeepLink,
  lookup: SessionDeepLinkLookup,
): Promise<SessionDeepLinkResolution> {
  if (link.server) {
    const server = matchConfiguredServer(link.server, lookup.servers)

    if (!server) return { status: "unknown-server" }

    const cached = lookup.cached(server, link.sessionID)

    if (cached) return { status: "found", server, session: cached }

    const fetched = await fetchWithTimeout(lookup, server, link.sessionID)

    if (fetched.status === "found") return { status: "found", server, session: fetched.session }

    if (fetched.status === "not-found") return { status: "not-found" }

    return { status: "unavailable", server }
  }

  if (lookup.servers.length === 0) return { status: "not-found" }

  const configuredKeys = lookup.servers.map(ServerConnection.key)

  const fallback =
    (lookup.activeServer && configuredKeys.includes(lookup.activeServer) ? lookup.activeServer : undefined) ??
    ServerConnection.key(lookup.servers.find(ServerConnection.builtin) ?? lookup.servers[0])

  const ordered = [fallback, ...configuredKeys.filter((key) => key !== fallback)]

  for (const server of ordered) {
    const session = lookup.cached(server, link.sessionID)

    if (session) return { status: "found", server, session }
  }

  const probed = await Promise.all(
    ordered.map((server) => fetchWithTimeout(lookup, server, link.sessionID).then((result) => ({ server, result }))),
  )

  const match = probed.find((entry) => entry.result.status === "found")

  if (match && match.result.status === "found") {
    return { status: "found", server: match.server, session: match.result.session }
  }

  return { status: "not-found" }
}

/** Opens and selects the session tab for a resolved session deep link, nesting subagent sessions under their root tab. */
export async function openSessionDeepLink(
  link: SessionDeepLink,
  lookup: SessionDeepLinkLookup,
  tabs: SessionDeepLinkTabs,
): Promise<SessionDeepLinkOutcome> {
  const resolved = await resolveSessionDeepLink(link, lookup)

  if (resolved.status === "unknown-server") return "unknown-server"

  if (resolved.status === "not-found") return "not-found"

  const session = resolved.status === "found" ? resolved.session : undefined
  const rootID = await resolveRootSessionID(resolved.server, link.sessionID, session, lookup)
  const isChild = rootID !== link.sessionID
  const routeSessionId = isChild ? link.sessionID : undefined
  const routeParentId = isChild ? session?.parentID : undefined

  const tabInput: Omit<SessionTab, "type"> = isChild
    ? { server: resolved.server, sessionId: rootID, routeSessionId, routeParentId }
    : { server: resolved.server, sessionId: rootID }

  const tab = tabs.addSessionTab(tabInput)

  if (tab.type !== "session") return "not-found"

  tabs.rememberSessionRoute(tab, link.sessionID, routeParentId)
  tabs.select({ ...tab, routeSessionId, routeParentId })

  return "opened"
}

function fetchWithTimeout(
  lookup: SessionDeepLinkLookup,
  server: ServerConnection.Key,
  sessionID: string,
): Promise<SessionFetchResult> {
  const controller = new AbortController()

  return new Promise<SessionFetchResult>((resolve) => {
    const timer = setTimeout(() => {
      controller.abort()
      resolve({ status: "unavailable" })
    }, RESOLVE_TIMEOUT_MS)

    void lookup.fetch(server, sessionID, controller.signal).then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      () => {
        clearTimeout(timer)
        resolve({ status: "unavailable" })
      },
    )
  })
}

async function resolveRootSessionID(
  server: ServerConnection.Key,
  sessionID: string,
  session: DeepLinkSessionInfo | undefined,
  lookup: SessionDeepLinkLookup,
) {
  if (!session?.parentID) return sessionID

  try {
    const root = await rootSession(session, async (id) => {
      const cached = lookup.cached(server, id)

      if (cached) return cached

      const fetched = await fetchWithTimeout(lookup, server, id)

      if (fetched.status !== "found") throw new Error(`Session not found: ${id}`)

      return fetched.session
    })

    return root.id
  } catch {
    return sessionID
  }
}
