import { sameLoopbackServer } from "@/runtime/server/loopback"
import { ServerConnection } from "@/runtime/server/registry"
import { rootSession } from "@/shell/routes/session"
import type { SessionTab, Tab } from "@/shell/tabs/tabs"
import { normalizeDeepLinkServerUrl, type SessionDeepLink } from "./machine"

export type DeepLinkSessionInfo = {
  readonly id: string
  readonly parentID?: string
}

export type SessionDeepLinkLookup = {
  readonly servers: readonly ServerConnection.Any[]
  readonly activeServer: ServerConnection.Key | undefined
  readonly cached: (server: ServerConnection.Key, sessionID: string) => DeepLinkSessionInfo | undefined
  readonly fetch: (server: ServerConnection.Key, sessionID: string) => Promise<DeepLinkSessionInfo | undefined>
}

export type SessionDeepLinkTabs = {
  readonly addSessionTab: (tab: Omit<SessionTab, "type">) => Tab
  readonly rememberSessionRoute: (tab: SessionTab, sessionId: string, parentId?: string) => void
  readonly select: (tab: Tab) => void
}

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
 * Explicit `?server=` matches only configured servers. Without `?server=`, prefers the active server,
 * checks configured servers for the session when multiple exist, and falls back to the active or default server.
 */
export async function resolveSessionDeepLink(
  link: SessionDeepLink,
  lookup: SessionDeepLinkLookup,
): Promise<{ readonly server: ServerConnection.Key; readonly session: DeepLinkSessionInfo | undefined } | undefined> {
  if (link.server) {
    const server = matchConfiguredServer(link.server, lookup.servers)

    if (!server) return

    const session = lookup.cached(server, link.sessionID) ?? (await lookup.fetch(server, link.sessionID))

    return { server, session }
  }

  if (lookup.servers.length === 0) return

  const configuredKeys = lookup.servers.map(ServerConnection.key)

  const fallback =
    (lookup.activeServer && configuredKeys.includes(lookup.activeServer) ? lookup.activeServer : undefined) ??
    ServerConnection.key(lookup.servers.find(ServerConnection.builtin) ?? lookup.servers[0])

  const ordered = [fallback, ...configuredKeys.filter((key) => key !== fallback)]

  if (ordered.length === 1) {
    const session = lookup.cached(fallback, link.sessionID) ?? (await lookup.fetch(fallback, link.sessionID))

    return { server: fallback, session }
  }

  for (const server of ordered) {
    const session = lookup.cached(server, link.sessionID)

    if (session) return { server, session }
  }

  const probed = await Promise.all(
    ordered.map((server) =>
      lookup.fetch(server, link.sessionID).then((session) => (session ? { server, session } : undefined)),
    ),
  )

  return probed.find((match) => match !== undefined) ?? { server: fallback, session: undefined }
}

/** Opens and selects the session tab for a resolved session deep link, nesting subagent sessions under their root tab. */
export async function openSessionDeepLink(
  link: SessionDeepLink,
  lookup: SessionDeepLinkLookup,
  tabs: SessionDeepLinkTabs,
): Promise<boolean> {
  const resolved = await resolveSessionDeepLink(link, lookup)

  if (!resolved) return false

  const rootID = await resolveRootSessionID(resolved.server, link.sessionID, resolved.session, lookup)
  const isChild = rootID !== link.sessionID
  const routeSessionId = isChild ? link.sessionID : undefined
  const routeParentId = isChild ? resolved.session?.parentID : undefined

  const tabInput: Omit<SessionTab, "type"> = isChild
    ? { server: resolved.server, sessionId: rootID, routeSessionId, routeParentId }
    : { server: resolved.server, sessionId: rootID }

  const tab = tabs.addSessionTab(tabInput)

  if (tab.type !== "session") return false

  tabs.rememberSessionRoute(tab, link.sessionID, routeParentId)
  tabs.select({ ...tab, routeSessionId, routeParentId })

  return true
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
      const next = lookup.cached(server, id) ?? (await lookup.fetch(server, id))

      if (!next) throw new Error(`Session not found: ${id}`)

      return next
    })

    return root.id
  } catch {
    return sessionID
  }
}
