import { useCallback, useEffect, useRef, useState } from "react"

import {
  DEFAULT_RELAY_URL,
  parseSessionItems,
  persistServerState,
  restoreServerState,
  serverBases,
  looksLikeLocalHost,
  type ServerItem,
} from "@/lib/server-sessions"

export { DEFAULT_RELAY_URL, looksLikeLocalHost, type ServerItem, type SessionItem } from "@/lib/server-sessions"

export function useServerSessions() {
  const [servers, setServers] = useState<ServerItem[]>([])
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const serversRef = useRef<ServerItem[]>([])
  const restoredRef = useRef(false)
  const refreshSeqRef = useRef<Record<string, number>>({})
  const activeServerIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    serversRef.current = servers
  }, [servers])

  useEffect(() => {
    activeServerIdRef.current = activeServerId
  }, [activeServerId])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const next = await restoreServerState()
        if (!mounted || !next) return

        setServers(next.servers)
        setActiveServerId(next.activeServerId)
        setActiveSessionId(next.activeSessionId)
        console.log("[Server] restore", {
          count: next.servers.length,
          activeServerId: next.activeServerId,
        })
      } finally {
        restoredRef.current = true
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!restoredRef.current) return

    void persistServerState(servers, activeServerId, activeSessionId).catch(() => {})
  }, [activeServerId, activeSessionId, servers])

  const refreshServerStatusAndSessions = useCallback(async (serverID: string, includeSessions = true) => {
    const server = serversRef.current.find((item) => item.id === serverID)
    if (!server) return

    const req = (refreshSeqRef.current[serverID] ?? 0) + 1
    refreshSeqRef.current[serverID] = req
    const current = () => refreshSeqRef.current[serverID] === req

    const candidates = serverBases(server.url)
    const base = candidates[0] ?? server.url.replace(/\/+$/, "")
    const healthURL = `${base}/health`
    const sessionsURL = `${base}/experimental/session?limit=100`
    let insecureRemote = false
    try {
      const parsedBase = new URL(base)
      insecureRemote = parsedBase.protocol === "http:" && !looksLikeLocalHost(parsedBase.hostname)
    } catch {
      insecureRemote = base.startsWith("http://")
    }

    console.log("[Server] refresh:start", {
      id: server.id,
      name: server.name,
      base,
      healthURL,
      sessionsURL,
      includeSessions,
    })

    setServers((prev) =>
      prev.map((item) => (item.id === serverID && includeSessions ? { ...item, sessionsLoading: true } : item)),
    )

    let activeBase = base
    try {
      let healthRes: Response | null = null
      let healthErr: unknown

      for (const item of candidates) {
        const url = `${item}/health`
        try {
          const next = await fetch(url)
          if (next.ok) {
            healthRes = next
            activeBase = item
            if (item !== server.url.replace(/\/+$/, "") && current()) {
              setServers((prev) => prev.map((entry) => (entry.id === serverID ? { ...entry, url: item } : entry)))
              console.log("[Server] refresh:scheme-upgrade", {
                id: server.id,
                from: server.url,
                to: item,
              })
            }
            break
          }
          healthRes = next
          activeBase = item
        } catch (err) {
          healthErr = err
          console.log("[Server] health:attempt-error", {
            id: server.id,
            url,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          })
        }
      }

      const online = !!healthRes?.ok
      if (!current()) {
        console.log("[Server] refresh:stale-skip", { id: server.id, req })
        return
      }

      console.log("[Server] health", {
        id: server.id,
        base: activeBase,
        url: `${activeBase}/health`,
        status: healthRes?.status ?? "fetch_error",
        online,
      })

      if (!online) {
        setServers((prev) =>
          prev.map((item) =>
            item.id === serverID ? { ...item, status: "offline", sessionsLoading: false, sessions: [] } : item,
          ),
        )
        console.log("[Server] refresh:offline", {
          id: server.id,
          base,
          candidates,
          error: healthErr instanceof Error ? `${healthErr.name}: ${healthErr.message}` : String(healthErr),
        })
        return
      }

      if (!includeSessions) {
        setServers((prev) =>
          prev.map((item) => (item.id === serverID ? { ...item, status: "online", sessionsLoading: false } : item)),
        )
        console.log("[Server] refresh:online", { id: server.id, base })
        return
      }

      const resolvedSessionsURL = `${activeBase}/experimental/session?limit=100&roots=true`
      const sessionsRes = await fetch(resolvedSessionsURL)
      if (!current()) {
        console.log("[Server] refresh:stale-skip", { id: server.id, req })
        return
      }

      if (!sessionsRes.ok) {
        console.log("[Server] sessions:http-error", {
          id: server.id,
          url: resolvedSessionsURL,
          status: sessionsRes.status,
        })
      }

      const json = sessionsRes.ok ? await sessionsRes.json() : []
      const sessions = parseSessionItems(json)

      setServers((prev) =>
        prev.map((item) =>
          item.id === serverID ? { ...item, status: "online", sessionsLoading: false, sessions } : item,
        ),
      )
      console.log("[Server] sessions", { id: server.id, count: sessions.length })
    } catch (err) {
      if (!current()) {
        console.log("[Server] refresh:stale-skip", { id: server.id, req })
        return
      }

      setServers((prev) =>
        prev.map((item) =>
          item.id === serverID ? { ...item, status: "offline", sessionsLoading: false, sessions: [] } : item,
        ),
      )
      console.log("[Server] refresh:error", {
        id: server.id,
        base,
        healthURL,
        sessionsURL,
        candidates,
        insecureRemote,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      if (insecureRemote) {
        console.log("[Server] refresh:hint", {
          id: server.id,
          message: "Remote http:// host may be blocked by iOS ATS; prefer https:// for non-local hosts.",
        })
      }
    }
  }, [])

  const refreshAllServerHealth = useCallback(() => {
    const ids = serversRef.current.map((item) => item.id)
    ids.forEach((id) => {
      void refreshServerStatusAndSessions(id, false)
    })
  }, [refreshServerStatusAndSessions])

  const selectServer = useCallback((id: string) => {
    setActiveServerId(id)
    setActiveSessionId(null)
  }, [])

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const removeServer = useCallback((id: string) => {
    setServers((prev) => prev.filter((item) => item.id !== id))
    setActiveServerId((prev) => (prev === id ? null : prev))
    if (activeServerIdRef.current === id) {
      setActiveSessionId(null)
    }
  }, [])

  const addServer = useCallback(
    (serverURL: string, relayURL: string, relaySecretRaw: string, serverIDRaw?: string) => {
      const raw = serverURL.trim()
      if (!raw) return false

      const normalized = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `http://${raw}`

      const rawRelay = relayURL.trim()
      const relayNormalizedRaw = rawRelay.length > 0 ? rawRelay : DEFAULT_RELAY_URL
      const normalizedRelay =
        relayNormalizedRaw.startsWith("http://") || relayNormalizedRaw.startsWith("https://")
          ? relayNormalizedRaw
          : `http://${relayNormalizedRaw}`

      let parsed: URL
      let relayParsed: URL
      try {
        parsed = new URL(normalized)
        relayParsed = new URL(normalizedRelay)
      } catch {
        return false
      }

      const id = `srv-${Date.now()}`
      const relaySecret = relaySecretRaw.trim()
      const serverID = typeof serverIDRaw === "string" && serverIDRaw.length > 0 ? serverIDRaw : null
      const url = `${parsed.protocol}//${parsed.host}`
      const inferredName =
        parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" ? "Local OpenCode" : parsed.hostname
      const relay = `${relayParsed.protocol}//${relayParsed.host}`
      const existing = serversRef.current.find(
        (item) =>
          item.url === url &&
          item.relayURL === relay &&
          item.relaySecret.trim() === relaySecret &&
          (!serverID || item.serverID === serverID || item.serverID === null),
      )

      if (existing) {
        if (serverID && existing.serverID !== serverID) {
          setServers((prev) =>
            prev.map((item) => (item.id === existing.id ? { ...item, serverID: serverID ?? item.serverID } : item)),
          )
        }

        setActiveServerId(existing.id)
        setActiveSessionId(null)
        void refreshServerStatusAndSessions(existing.id)
        return true
      }

      setServers((prev) => [
        ...prev,
        {
          id,
          name: inferredName,
          url,
          serverID,
          relayURL: relay,
          relaySecret,
          status: "offline",
          sessions: [],
          sessionsLoading: false,
        },
      ])
      setActiveServerId(id)
      setActiveSessionId(null)
      void refreshServerStatusAndSessions(id)
      return true
    },
    [refreshServerStatusAndSessions],
  )

  const createSession = useCallback(
    async (
      serverID: string,
      options?: {
        directory?: string
        workspaceID?: string
        title?: string
      },
    ) => {
      const server = serversRef.current.find((item) => item.id === serverID)
      if (!server) {
        return null
      }

      const base = server.url.replace(/\/+$/, "")
      const params = new URLSearchParams()
      const directory = options?.directory?.trim()
      const workspaceID = options?.workspaceID?.trim()
      const title = options?.title?.trim()

      if (directory) {
        params.set("directory", directory)
      }

      const body: {
        workspaceID?: string
        title?: string
      } = {}

      if (workspaceID) {
        body.workspaceID = workspaceID
      }

      if (title) {
        body.title = title
      }

      const query = params.toString()
      const endpoint = `${base}/session${query ? `?${query}` : ""}`

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          console.log("[Server] session:create:http-error", {
            id: server.id,
            endpoint,
            status: response.status,
          })
          return null
        }

        const payload = (await response.json()) as unknown
        const parsed = parseSessionItems([payload])[0]

        if (!parsed) {
          void refreshServerStatusAndSessions(serverID)
          return null
        }

        const created = parsed.updated > 0 ? parsed : { ...parsed, updated: Date.now() }

        setServers((prev) =>
          prev.map((item) => {
            if (item.id !== serverID) return item

            const sessions = [created, ...item.sessions.filter((session) => session.id !== created.id)].sort(
              (a, b) => b.updated - a.updated,
            )

            return {
              ...item,
              status: "online",
              sessionsLoading: false,
              sessions,
            }
          }),
        )
        setActiveServerId(serverID)
        setActiveSessionId(created.id)

        console.log("[Server] session:create", {
          id: server.id,
          sessionID: created.id,
          hasDirectory: Boolean(created.directory),
          hasWorkspaceID: Boolean(created.workspaceID),
        })

        return created
      } catch (err) {
        console.log("[Server] session:create:error", {
          id: server.id,
          endpoint,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        return null
      }
    },
    [refreshServerStatusAndSessions],
  )

  const findServerForSession = useCallback(
    async (sessionID: string, preferredServerID?: string | null): Promise<ServerItem | null> => {
      if (!serversRef.current.length && !restoredRef.current) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          if (serversRef.current.length > 0 || restoredRef.current) {
            break
          }
        }
      }

      if (preferredServerID) {
        const preferred = serversRef.current.find((server) => server.serverID === preferredServerID)
        if (preferred?.sessions.some((session) => session.id === sessionID)) {
          return preferred
        }
        if (preferred) {
          await refreshServerStatusAndSessions(preferred.id)
          const refreshed = serversRef.current.find((server) => server.id === preferred.id)
          if (refreshed?.sessions.some((session) => session.id === sessionID)) {
            return refreshed
          }
        }
      }

      const direct = serversRef.current.find((server) => server.sessions.some((session) => session.id === sessionID))
      if (direct) return direct

      const ids = serversRef.current.map((server) => server.id)
      for (const id of ids) {
        await refreshServerStatusAndSessions(id)
        const matched = serversRef.current.find(
          (server) => server.id === id && server.sessions.some((session) => session.id === sessionID),
        )
        if (matched) {
          return matched
        }
      }

      return null
    },
    [refreshServerStatusAndSessions],
  )

  return {
    servers,
    setServers,
    serversRef,
    activeServerId,
    setActiveServerId,
    activeServerIdRef,
    activeSessionId,
    setActiveSessionId,
    activeSessionIdRef,
    restoredRef,
    refreshServerStatusAndSessions,
    refreshAllServerHealth,
    selectServer,
    selectSession,
    removeServer,
    addServer,
    createSession,
    findServerForSession,
  }
}
