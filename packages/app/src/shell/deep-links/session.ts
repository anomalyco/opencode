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

export type SessionDeepLinkOutcome =
  | {
      readonly status: "opened"
      readonly server: ServerConnection.Key
      readonly session: DeepLinkSessionInfo | undefined
    }
  | { readonly status: "not-found" }
  | { readonly status: "unknown-server" }
  | { readonly status: "cancelled" }

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
 * Without `?server=`, checks cached and configured servers (resolving as soon as any server finds the session)
 * and returns `not-found` when no server owns it.
 */
export async function resolveSessionDeepLink(
  link: SessionDeepLink,
  lookup: SessionDeepLinkLookup,
  signal?: AbortSignal,
): Promise<SessionDeepLinkResolution> {
  return withTimeoutSignal(signal, async (timeoutSignal) => {
    if (link.server) {
      const server = matchConfiguredServer(link.server, lookup.servers)

      if (!server) return { status: "unknown-server" }

      const cached = lookup.cached(server, link.sessionID)

      if (cached) return { status: "found", server, session: cached }

      const fetched = await fetchOrAbort(lookup, server, link.sessionID, timeoutSignal)

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

    return probeFirstFound(ordered, lookup, link.sessionID, timeoutSignal)
  })
}

/** Opens and selects the session tab for a resolved session deep link, nesting subagent sessions under their root tab. */
export async function openSessionDeepLink(
  link: SessionDeepLink,
  lookup: SessionDeepLinkLookup,
  tabs: SessionDeepLinkTabs,
  signal?: AbortSignal,
): Promise<SessionDeepLinkOutcome> {
  return withTimeoutSignal(signal, async (timeoutSignal) => {
    const resolved = await resolveSessionDeepLink(link, lookup, timeoutSignal)

    if (signal?.aborted) return { status: "cancelled" }

    if (resolved.status === "unknown-server") return { status: "unknown-server" }

    if (resolved.status === "not-found") return { status: "not-found" }

    const session = resolved.status === "found" ? resolved.session : undefined
    const rootID = await resolveRootSessionID(resolved.server, link.sessionID, session, lookup, timeoutSignal)

    if (signal?.aborted) return { status: "cancelled" }

    if (!rootID) return { status: "not-found" }

    const isChild = rootID !== link.sessionID
    const routeSessionId = isChild ? link.sessionID : undefined
    const routeParentId = isChild ? session?.parentID : undefined

    const tabInput: Omit<SessionTab, "type"> = isChild
      ? { server: resolved.server, sessionId: rootID, routeSessionId, routeParentId }
      : { server: resolved.server, sessionId: rootID }

    const tab = tabs.addSessionTab(tabInput)

    if (tab.type !== "session") return { status: "not-found" }

    tabs.rememberSessionRoute(tab, link.sessionID, routeParentId)
    tabs.select({ ...tab, routeSessionId, routeParentId })

    return { status: "opened", server: resolved.server, session }
  })
}

async function withTimeoutSignal<T>(
  outer: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()

  if (outer?.aborted) controller.abort()
  else outer?.addEventListener("abort", onOuterAbort, { once: true })

  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)

  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener("abort", onOuterAbort)
  }
}

function fetchOrAbort(
  lookup: SessionDeepLinkLookup,
  server: ServerConnection.Key,
  sessionID: string,
  signal: AbortSignal,
): Promise<SessionFetchResult> {
  if (signal.aborted) return Promise.resolve({ status: "unavailable" })

  return new Promise<SessionFetchResult>((resolve) => {
    const onAbort = () => resolve({ status: "unavailable" })
    signal.addEventListener("abort", onAbort, { once: true })

    void lookup.fetch(server, sessionID, signal).then(
      (result) => {
        signal.removeEventListener("abort", onAbort)
        resolve(result)
      },
      () => {
        signal.removeEventListener("abort", onAbort)
        resolve({ status: "unavailable" })
      },
    )
  })
}

function probeFirstFound(
  servers: readonly ServerConnection.Key[],
  lookup: SessionDeepLinkLookup,
  sessionID: string,
  outerSignal: AbortSignal,
): Promise<SessionDeepLinkResolution> {
  if (outerSignal.aborted) return Promise.resolve({ status: "not-found" })

  const probe = new AbortController()

  return new Promise<SessionDeepLinkResolution>((resolve) => {
    let remaining = servers.length
    let settled = false

    const finish = (result: SessionDeepLinkResolution) => {
      if (settled) return
      settled = true
      outerSignal.removeEventListener("abort", onOuterAbort)
      probe.abort()
      resolve(result)
    }

    const onOuterAbort = () => finish({ status: "not-found" })
    outerSignal.addEventListener("abort", onOuterAbort, { once: true })

    for (const server of servers) {
      void lookup.fetch(server, sessionID, probe.signal).then(
        (result) => {
          if (result.status === "found") return finish({ status: "found", server, session: result.session })

          remaining -= 1

          if (remaining === 0) finish({ status: "not-found" })
        },
        () => {
          remaining -= 1

          if (remaining === 0) finish({ status: "not-found" })
        },
      )
    }
  })
}

async function resolveRootSessionID(
  server: ServerConnection.Key,
  sessionID: string,
  session: DeepLinkSessionInfo | undefined,
  lookup: SessionDeepLinkLookup,
  signal: AbortSignal,
) {
  if (!session?.parentID) return sessionID

  try {
    const root = await rootSession(session, async (id) => {
      const cached = lookup.cached(server, id)

      if (cached) return cached

      const fetched = await fetchOrAbort(lookup, server, id, signal)

      if (fetched.status !== "found") throw new Error(`Session not found: ${id}`)

      return fetched.session
    })

    return root.id
  } catch {
    return
  }
}
