import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"
import { AppState, Platform, type AppStateStatus } from "react-native"
import * as Haptics from "expo-haptics"
import * as Notifications from "expo-notifications"
import Constants from "expo-constants"
import { fetch as expoFetch } from "expo/fetch"

import {
  classifyMonitorEvent,
  extractSessionID,
  formatMonitorEventLabel,
  type OpenCodeEvent,
  type MonitorEventType,
} from "@/lib/opencode-events"
import {
  parsePendingPermissionRequest,
  parsePendingPermissionRequests,
  type PendingPermissionRequest,
} from "@/lib/pending-permissions"
import { registerRelayDevice, unregisterRelayDevice } from "@/lib/relay-client"
import { parseSSEStream } from "@/lib/sse"
import { getDevicePushToken, onPushTokenChange } from "@/notifications/monitoring-notifications"
import type { ServerItem } from "@/hooks/use-server-sessions"

export type MonitorJob = {
  id: string
  sessionID: string
  opencodeBaseURL: string
  startedAt: number
}

export type PermissionDecision = "once" | "always" | "reject"

export type PromptHistoryEntry = {
  promptText: string
  userMessageID: string
}

type SessionRuntimeStatus = "idle" | "busy" | "retry"

type PermissionPromptState = "idle" | "pending" | "granted" | "denied"

type NotificationPayload = {
  serverID: string | null
  eventType: MonitorEventType | null
  sessionID: string | null
}

type CuePlayer = {
  seekTo: (position: number) => unknown
  play: () => unknown
}

type UseMonitoringOptions = {
  completePlayer: CuePlayer
  closeDropdown: () => void
  findServerForSession: (sessionID: string, preferredServerID?: string | null) => Promise<ServerItem | null>
  refreshServerStatusAndSessions: (serverID: string, includeSessions?: boolean) => Promise<void>
  servers: ServerItem[]
  serversRef: MutableRefObject<ServerItem[]>
  restoredRef: MutableRefObject<boolean>
  activeServerId: string | null
  activeSessionId: string | null
  activeServerIdRef: MutableRefObject<string | null>
  activeSessionIdRef: MutableRefObject<string | null>
  setActiveServerId: Dispatch<SetStateAction<string | null>>
  setActiveSessionId: Dispatch<SetStateAction<string | null>>
  setAgentStateDismissed: Dispatch<SetStateAction<boolean>>
  setNotificationPermissionState: Dispatch<SetStateAction<PermissionPromptState>>
}

function parseMonitorEventType(value: unknown): MonitorEventType | null {
  if (value === "complete" || value === "permission" || value === "error") {
    return value
  }

  return null
}

function parseNotificationPayload(data: unknown): NotificationPayload | null {
  if (!data || typeof data !== "object") return null

  const serverIDRaw = (data as { serverID?: unknown }).serverID
  const serverID = typeof serverIDRaw === "string" && serverIDRaw.length > 0 ? serverIDRaw : null

  const eventType = parseMonitorEventType((data as { eventType?: unknown }).eventType)
  const sessionIDRaw = (data as { sessionID?: unknown }).sessionID
  const sessionID = typeof sessionIDRaw === "string" && sessionIDRaw.length > 0 ? sessionIDRaw : null

  if (!eventType && !sessionID && !serverID) return null

  return {
    serverID,
    eventType,
    sessionID,
  }
}

export function useMonitoring({
  completePlayer,
  closeDropdown,
  findServerForSession,
  refreshServerStatusAndSessions,
  servers,
  serversRef,
  restoredRef,
  activeServerId,
  activeSessionId,
  activeServerIdRef,
  activeSessionIdRef,
  setActiveServerId,
  setActiveSessionId,
  setAgentStateDismissed,
  setNotificationPermissionState,
}: UseMonitoringOptions) {
  const [devicePushToken, setDevicePushToken] = useState<string | null>(null)
  const [monitorJob, setMonitorJob] = useState<MonitorJob | null>(null)
  const [monitorStatus, setMonitorStatus] = useState("")
  const [latestAssistantResponse, setLatestAssistantResponse] = useState("")
  const [latestPromptText, setLatestPromptText] = useState("")
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>([])
  const [latestAssistantContext, setLatestAssistantContext] = useState<LatestAssistantContext | null>(null)
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([])
  const [replyingPermissionID, setReplyingPermissionID] = useState<string | null>(null)
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState)

  const foregroundMonitorAbortRef = useRef<AbortController | null>(null)
  const foregroundPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const monitorJobRef = useRef<MonitorJob | null>(null)
  const syncSessionStateRef = useRef<
    ((input: { serverID: string; sessionID: string; preserveStatusLabel?: boolean }) => Promise<void>) | null
  >(null)
  const pendingNotificationEventsRef = useRef<{ payload: NotificationPayload; source: "received" | "response" }[]>([])
  const notificationHandlerRef = useRef<(payload: NotificationPayload, source: "received" | "response") => void>(
    (payload, source) => {
      pendingNotificationEventsRef.current.push({ payload, source })
    },
  )
  const previousPushTokenRef = useRef<string | null>(null)
  const previousAppStateRef = useRef<AppStateStatus>(AppState.currentState)
  const latestAssistantRequestRef = useRef(0)
  const latestPermissionRequestRef = useRef(0)

  const upsertPendingPermission = useCallback(
    (request: PendingPermissionRequest) => {
      setPendingPermissions((current) => {
        const next = current.filter((item) => item.id !== request.id)
        return [request, ...next]
      })
      closeDropdown()
      setAgentStateDismissed(false)
    },
    [closeDropdown, setAgentStateDismissed],
  )

  useEffect(() => {
    monitorJobRef.current = monitorJob
  }, [monitorJob])

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState)
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        if (Platform.OS !== "ios") return
        const existing = await Notifications.getPermissionsAsync()
        const granted = Boolean((existing as { granted?: unknown }).granted)
        if (active) {
          setNotificationPermissionState(granted ? "granted" : "idle")
        }
        if (!granted) return
        const token = await getDevicePushToken()
        if (token) {
          setDevicePushToken(token)
        }
      } catch {
        // Non-fatal: monitoring can still work in-app via foreground SSE.
      }
    })()

    const sub = onPushTokenChange((token) => {
      if (!active) return
      setDevicePushToken(token)
    })

    return () => {
      active = false
      sub.remove()
    }
  }, [setNotificationPermissionState])

  useEffect(() => {
    const notificationSub = Notifications.addNotificationReceivedListener((notification: unknown) => {
      const data = (notification as { request?: { content?: { data?: unknown } } }).request?.content?.data
      const payload = parseNotificationPayload(data)
      if (!payload) return
      notificationHandlerRef.current(payload, "received")
    })

    const responseSub = Notifications.addNotificationResponseReceivedListener((response: unknown) => {
      const data = (response as { notification?: { request?: { content?: { data?: unknown } } } }).notification?.request
        ?.content?.data
      const payload = parseNotificationPayload(data)
      if (!payload) return
      notificationHandlerRef.current(payload, "response")
    })

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return
        const data = (response as { notification?: { request?: { content?: { data?: unknown } } } }).notification
          ?.request?.content?.data
        const payload = parseNotificationPayload(data)
        if (!payload) return
        notificationHandlerRef.current(payload, "response")
      })
      .catch(() => {})

    return () => {
      notificationSub.remove()
      responseSub.remove()
    }
  }, [])

  const stopForegroundMonitor = useCallback(() => {
    const aborter = foregroundMonitorAbortRef.current
    if (aborter) {
      aborter.abort()
      foregroundMonitorAbortRef.current = null
    }
    if (foregroundPollIntervalRef.current) {
      clearInterval(foregroundPollIntervalRef.current)
      foregroundPollIntervalRef.current = null
    }
  }, [])

  const loadLatestAssistantResponse = useCallback(
    async (baseURL: string, sessionID: string) => {
      const requestID = latestAssistantRequestRef.current + 1
      latestAssistantRequestRef.current = requestID

      const base = baseURL.replace(/\/+$/, "")

      try {
        const response = await fetch(`${base}/session/${sessionID}/message?limit=60`)
        if (!response.ok) {
          throw new Error(`Session messages failed (${response.status})`)
        }

        const payload = (await response.json()) as unknown
        const latest = findLatestAssistantCompletion(payload)
        const promptText = findLatestUserPrompt(payload)
        const history = buildPromptHistory(payload)

        if (latestAssistantRequestRef.current !== requestID) return
        if (activeSessionIdRef.current !== sessionID) return
        setLatestAssistantResponse(latest.text)
        setLatestPromptText(promptText)
        setPromptHistory(history)
        setLatestAssistantContext(latest.context)
        if (latest.text) {
          setAgentStateDismissed(false)
        }
      } catch {
        if (latestAssistantRequestRef.current !== requestID) return
        if (activeSessionIdRef.current !== sessionID) return
        setLatestAssistantResponse("")
        setLatestPromptText("")
        setPromptHistory([])
        setLatestAssistantContext(null)
      }
    },
    [activeSessionIdRef, setAgentStateDismissed],
  )

  const loadPendingPermissions = useCallback(
    async (baseURL: string, sessionID: string) => {
      const requestID = latestPermissionRequestRef.current + 1
      latestPermissionRequestRef.current = requestID

      const base = baseURL.replace(/\/+$/, "")

      try {
        const response = await fetch(`${base}/permission`)
        if (!response.ok) {
          throw new Error(`Permission list failed (${response.status})`)
        }

        const payload = (await response.json()) as unknown
        const requests = parsePendingPermissionRequests(payload).filter((item) => item.sessionID === sessionID)

        if (latestPermissionRequestRef.current !== requestID) return
        if (activeSessionIdRef.current !== sessionID) return

        setPendingPermissions(requests)
        if (requests.length > 0) {
          closeDropdown()
          setAgentStateDismissed(false)
        }
      } catch {
        if (latestPermissionRequestRef.current !== requestID) return
        if (activeSessionIdRef.current !== sessionID) return
      }
    },
    [activeSessionIdRef, closeDropdown, setAgentStateDismissed],
  )

  const fetchSessionRuntimeStatus = useCallback(
    async (baseURL: string, sessionID: string): Promise<SessionRuntimeStatus | null> => {
      const base = baseURL.replace(/\/+$/, "")

      try {
        const response = await fetch(`${base}/session/status`)
        if (!response.ok) {
          throw new Error(`Session status failed (${response.status})`)
        }

        const payload = (await response.json()) as unknown
        if (!payload || typeof payload !== "object") return null

        const status = (payload as Record<string, unknown>)[sessionID]
        if (!status || typeof status !== "object") return "idle"

        const type = (status as { type?: unknown }).type
        if (type === "busy" || type === "retry" || type === "idle") {
          return type
        }

        return null
      } catch {
        return null
      }
    },
    [],
  )

  const handleMonitorEvent = useCallback(
    (eventType: MonitorEventType, job: MonitorJob) => {
      setMonitorStatus(formatMonitorEventLabel(eventType))

      if (eventType === "permission") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
        void loadPendingPermissions(job.opencodeBaseURL, job.sessionID)
        return
      }

      if (eventType === "complete") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        void completePlayer.seekTo(0)
        void completePlayer.play()
        stopForegroundMonitor()
        setMonitorJob(null)
        void loadLatestAssistantResponse(job.opencodeBaseURL, job.sessionID)
        return
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      stopForegroundMonitor()
      setMonitorJob(null)
    },
    [completePlayer, loadLatestAssistantResponse, loadPendingPermissions, stopForegroundMonitor],
  )

  const startForegroundMonitor = useCallback(
    (job: MonitorJob) => {
      stopForegroundMonitor()

      const abortController = new AbortController()
      foregroundMonitorAbortRef.current = abortController

      const base = job.opencodeBaseURL.replace(/\/+$/, "")

      // SSE stream with automatic recovery on failure or natural close
      const connectSSE = () => {
        void (async () => {
          try {
            const response = await expoFetch(`${base}/event`, {
              signal: abortController.signal,
              headers: {
                Accept: "text/event-stream",
                "Cache-Control": "no-cache",
              },
            })

            if (!response.ok || !response.body) {
              throw new Error(`SSE monitor failed (${response.status})`)
            }

            for await (const message of parseSSEStream(response.body)) {
              let parsed: OpenCodeEvent | null = null
              try {
                parsed = JSON.parse(message.data) as OpenCodeEvent
              } catch {
                continue
              }

              if (!parsed) continue
              const sessionID = extractSessionID(parsed)
              if (sessionID !== job.sessionID) continue

              if (parsed.type === "permission.asked") {
                const request = parsePendingPermissionRequest(parsed.properties)
                if (request) {
                  upsertPendingPermission(request)
                }
              }

              const eventType = classifyMonitorEvent(parsed)
              if (!eventType) continue

              const active = monitorJobRef.current
              if (!active || active.id !== job.id) return
              handleMonitorEvent(eventType, job)
            }

            // Stream ended naturally (server closed connection) -- fall through to recovery
          } catch {
            if (abortController.signal.aborted) return
            // SSE failed (network drop, server restart, etc.) -- fall through to recovery
          }

          // Recovery: if this job is still active and we weren't explicitly aborted, poll session status
          if (abortController.signal.aborted) return
          const active = monitorJobRef.current
          if (!active || active.id !== job.id) return

          const serverID = activeServerIdRef.current
          const sessionID = activeSessionIdRef.current
          if (serverID && sessionID) {
            void syncSessionStateRef.current?.({ serverID, sessionID })
          }
        })()
      }

      connectSSE()

      // Periodic polling fallback: check session status every 20s in case SSE silently drops
      foregroundPollIntervalRef.current = setInterval(() => {
        const active = monitorJobRef.current
        if (!active || active.id !== job.id) {
          if (foregroundPollIntervalRef.current) {
            clearInterval(foregroundPollIntervalRef.current)
            foregroundPollIntervalRef.current = null
          }
          return
        }

        const serverID = activeServerIdRef.current
        const sessionID = activeSessionIdRef.current
        if (serverID && sessionID) {
          void syncSessionStateRef.current?.({ serverID, sessionID, preserveStatusLabel: true })
        }
      }, 20_000)
    },
    [activeServerIdRef, activeSessionIdRef, handleMonitorEvent, stopForegroundMonitor, upsertPendingPermission],
  )

  const beginMonitoring = useCallback(
    async (job: MonitorJob) => {
      setMonitorJob(job)
      setMonitorStatus("Monitoring…")
      startForegroundMonitor(job)
    },
    [startForegroundMonitor],
  )

  useEffect(() => {
    const active = monitorJobRef.current
    if (!active) return

    if (appState === "active") {
      startForegroundMonitor(active)
      return
    }

    stopForegroundMonitor()
  }, [appState, startForegroundMonitor, stopForegroundMonitor])

  useEffect(() => {
    const active = monitorJobRef.current
    if (!active) return
    if (activeSessionId === active.sessionID) return

    stopForegroundMonitor()
    setMonitorJob(null)
    setMonitorStatus("")
  }, [activeSessionId, stopForegroundMonitor])

  useEffect(() => {
    setLatestAssistantResponse("")
    setLatestPromptText("")
    setPromptHistory([])
    setLatestAssistantContext(null)
    setPendingPermissions([])
    setAgentStateDismissed(false)
    if (!activeServerId || !activeSessionId) return

    const server = serversRef.current.find((item) => item.id === activeServerId)
    if (!server || server.status !== "online") return
    void loadLatestAssistantResponse(server.url, activeSessionId)
    void loadPendingPermissions(server.url, activeSessionId)
  }, [
    activeServerId,
    activeSessionId,
    loadLatestAssistantResponse,
    loadPendingPermissions,
    serversRef,
    setAgentStateDismissed,
  ])

  useEffect(() => {
    return () => {
      stopForegroundMonitor()
    }
  }, [stopForegroundMonitor])

  const syncSessionState = useCallback(
    async (input: { serverID: string; sessionID: string; preserveStatusLabel?: boolean }) => {
      await refreshServerStatusAndSessions(input.serverID)

      const server = serversRef.current.find((item) => item.id === input.serverID)
      if (!server || server.status !== "online") return

      const runtimeStatus = await fetchSessionRuntimeStatus(server.url, input.sessionID)
      await loadLatestAssistantResponse(server.url, input.sessionID)
      await loadPendingPermissions(server.url, input.sessionID)

      if (runtimeStatus === "busy" || runtimeStatus === "retry") {
        const nextJob: MonitorJob = {
          id: `job-resume-${Date.now()}`,
          sessionID: input.sessionID,
          opencodeBaseURL: server.url.replace(/\/+$/, ""),
          startedAt: Date.now(),
        }

        setMonitorJob(nextJob)
        setMonitorStatus("Monitoring…")
        if (appState === "active") {
          startForegroundMonitor(nextJob)
        }
        return
      }

      if (runtimeStatus === "idle") {
        stopForegroundMonitor()
        setMonitorJob(null)
        if (!input.preserveStatusLabel) {
          setMonitorStatus("")
        }
        return
      }

      // runtimeStatus is null (fetch failed or unparseable) -- retry after a short delay
      // if a monitor job is still active, so we don't leave the user stuck
      if (runtimeStatus === null && monitorJobRef.current) {
        setTimeout(() => {
          const serverID = activeServerIdRef.current
          const sessionID = activeSessionIdRef.current
          if (serverID && sessionID && monitorJobRef.current) {
            void syncSessionStateRef.current?.({ serverID, sessionID })
          }
        }, 5_000)
      }
    },
    [
      activeServerIdRef,
      activeSessionIdRef,
      appState,
      fetchSessionRuntimeStatus,
      loadLatestAssistantResponse,
      loadPendingPermissions,
      refreshServerStatusAndSessions,
      serversRef,
      startForegroundMonitor,
      stopForegroundMonitor,
    ],
  )

  useEffect(() => {
    syncSessionStateRef.current = syncSessionState
  }, [syncSessionState])

  const handleNotificationPayload = useCallback(
    async (payload: NotificationPayload, source: "received" | "response") => {
      const activeServer = activeServerIdRef.current
        ? serversRef.current.find((server) => server.id === activeServerIdRef.current)
        : null
      const matchesActiveSession =
        !!payload.sessionID &&
        activeSessionIdRef.current === payload.sessionID &&
        (!payload.serverID || activeServer?.serverID === payload.serverID)

      if (payload.eventType && (source === "response" || matchesActiveSession || !payload.sessionID)) {
        setMonitorStatus(formatMonitorEventLabel(payload.eventType))
      }

      if (payload.eventType === "complete" && source === "received") {
        void completePlayer.seekTo(0)
        void completePlayer.play()
      }

      if (
        (payload.eventType === "complete" || payload.eventType === "error") &&
        (source === "response" || matchesActiveSession)
      ) {
        stopForegroundMonitor()
        setMonitorJob(null)
      }

      if (!payload.sessionID) return

      if (source === "response") {
        const matched = await findServerForSession(payload.sessionID, payload.serverID)
        if (!matched) {
          console.log("[Notification] open:session-not-found", {
            serverID: payload.serverID,
            sessionID: payload.sessionID,
            eventType: payload.eventType,
          })
          return
        }

        activeServerIdRef.current = matched.id
        activeSessionIdRef.current = payload.sessionID
        setActiveServerId(matched.id)
        setActiveSessionId(payload.sessionID)
        closeDropdown()
        setAgentStateDismissed(false)

        await syncSessionState({
          serverID: matched.id,
          sessionID: payload.sessionID,
          preserveStatusLabel: Boolean(payload.eventType),
        })
        return
      }

      if (!matchesActiveSession) return

      const activeServerID = activeServerIdRef.current
      if (!activeServerID) return

      await syncSessionState({
        serverID: activeServerID,
        sessionID: payload.sessionID,
        preserveStatusLabel: Boolean(payload.eventType),
      })
    },
    [
      activeServerIdRef,
      activeSessionIdRef,
      closeDropdown,
      completePlayer,
      findServerForSession,
      serversRef,
      setActiveServerId,
      setActiveSessionId,
      setAgentStateDismissed,
      stopForegroundMonitor,
      syncSessionState,
    ],
  )

  useEffect(() => {
    notificationHandlerRef.current = (payload, source) => {
      void handleNotificationPayload(payload, source)
    }

    if (!pendingNotificationEventsRef.current.length) return

    const queued = [...pendingNotificationEventsRef.current]
    pendingNotificationEventsRef.current = []
    queued.forEach(({ payload, source }) => {
      void handleNotificationPayload(payload, source)
    })
  }, [handleNotificationPayload])

  useEffect(() => {
    const previous = previousAppStateRef.current
    previousAppStateRef.current = appState

    if (appState !== "active" || previous === "active") return

    const serverID = activeServerIdRef.current
    const sessionID = activeSessionIdRef.current
    if (!serverID || !sessionID) return

    void syncSessionState({ serverID, sessionID })
  }, [activeServerIdRef, activeSessionIdRef, appState, syncSessionState])

  const respondToPermission = useCallback(
    async (input: { serverID: string; sessionID: string; requestID: string; reply: PermissionDecision }) => {
      const server = serversRef.current.find((item) => item.id === input.serverID)
      if (!server) {
        throw new Error("Server unavailable")
      }

      const base = server.url.replace(/\/+$/, "")
      setReplyingPermissionID(input.requestID)
      setMonitorStatus(input.reply === "reject" ? "Rejecting request…" : "Sending approval…")
      let removed: PendingPermissionRequest | undefined
      setPendingPermissions((current) => {
        removed = current.find((item) => item.id === input.requestID)
        return current.filter((item) => item.id !== input.requestID)
      })

      try {
        const response = await fetch(`${base}/permission/${input.requestID}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reply: input.reply }),
        })

        if (!response.ok) {
          throw new Error(`Permission reply failed (${response.status})`)
        }

        await syncSessionState({
          serverID: input.serverID,
          sessionID: input.sessionID,
        })
      } catch (error) {
        if (removed) {
          setPendingPermissions((current) => {
            const restored = removed
            if (!restored) {
              return current
            }
            if (current.some((item) => item.id === restored.id)) {
              return current
            }
            return [restored, ...current]
          })
        }
        throw error
      } finally {
        setReplyingPermissionID((current) => (current === input.requestID ? null : current))
      }
    },
    [serversRef, syncSessionState],
  )

  const activePermissionRequest = pendingPermissions[0] ?? null

  const relayServersKey = useMemo(
    () =>
      servers
        .filter((server) => server.relaySecret.trim().length > 0)
        .map((server) => `${server.id}:${server.relayURL}:${server.relaySecret.trim()}`)
        .join("|"),
    [servers],
  )

  useEffect(() => {
    if (Platform.OS !== "ios") return
    if (!devicePushToken) return

    const list = serversRef.current.filter((server) => server.relaySecret.trim().length > 0)
    if (!list.length) return

    const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? "com.anomalyco.mobilevoice"
    const apnsEnv = "production"
    console.log("[Relay] env", {
      dev: __DEV__,
      node: process.env.NODE_ENV,
      apnsEnv,
    })
    console.log("[Relay] register:batch", {
      tokenSuffix: devicePushToken.slice(-8),
      count: list.length,
      apnsEnv,
      bundleId,
    })

    void Promise.allSettled(
      list.map(async (server) => {
        const secret = server.relaySecret.trim()
        const relay = server.relayURL
        console.log("[Relay] register:start", {
          id: server.id,
          relay,
          tokenSuffix: devicePushToken.slice(-8),
          secretLength: secret.length,
        })
        try {
          await registerRelayDevice({
            relayBaseURL: relay,
            secret,
            deviceToken: devicePushToken,
            bundleId,
            apnsEnv,
          })
          console.log("[Relay] register:ok", { id: server.id, relay })
        } catch (err) {
          console.log("[Relay] register:error", {
            id: server.id,
            relay,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }),
    ).catch(() => {})
  }, [devicePushToken, relayServersKey, serversRef])

  useEffect(() => {
    if (Platform.OS !== "ios") return
    if (!devicePushToken) return
    const previous = previousPushTokenRef.current
    previousPushTokenRef.current = devicePushToken
    if (!previous || previous === devicePushToken) return

    const list = serversRef.current.filter((server) => server.relaySecret.trim().length > 0)
    if (!list.length) return
    console.log("[Relay] unregister:batch", {
      previousSuffix: previous.slice(-8),
      nextSuffix: devicePushToken.slice(-8),
      count: list.length,
    })

    void Promise.allSettled(
      list.map(async (server) => {
        const secret = server.relaySecret.trim()
        const relay = server.relayURL
        console.log("[Relay] unregister:start", {
          id: server.id,
          relay,
          tokenSuffix: previous.slice(-8),
          secretLength: secret.length,
        })
        try {
          await unregisterRelayDevice({
            relayBaseURL: relay,
            secret,
            deviceToken: previous,
          })
          console.log("[Relay] unregister:ok", { id: server.id, relay })
        } catch (err) {
          console.log("[Relay] unregister:error", {
            id: server.id,
            relay,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }),
    ).catch(() => {})
  }, [devicePushToken, relayServersKey, serversRef])

  return {
    devicePushToken,
    setDevicePushToken,
    monitorJob,
    monitorStatus,
    setMonitorStatus,
    latestPromptText,
    setLatestPromptText,
    promptHistory,
    setPromptHistory,
    latestAssistantResponse,
    latestAssistantContext,
    activePermissionRequest,
    pendingPermissionCount: pendingPermissions.length,
    respondingPermissionID: replyingPermissionID,
    respondToPermission,
    beginMonitoring,
  }
}

type SessionMessageInfo = {
  role?: unknown
  time?: unknown
  modelID?: unknown
  providerID?: unknown
  path?: unknown
  agent?: unknown
}

type SessionMessagePart = {
  type?: unknown
  text?: unknown
}

type SessionMessagePayload = {
  info?: unknown
  parts?: unknown
}

type LatestAssistantContext = {
  providerID: string | null
  modelID: string | null
  workingDirectory: string | null
  agent: string | null
}

type LatestAssistantSnapshot = {
  text: string
  context: LatestAssistantContext | null
}

function cleanTranscriptText(text: string): string {
  return text.replace(/[ \t]+$/gm, "").trimEnd()
}

function cleanSessionText(text: string): string {
  return cleanTranscriptText(text).trimStart()
}

function extractMessageText(parts: SessionMessagePart[]): string {
  const textParts: string[] = []

  for (const part of parts) {
    if (!part || part.type !== "text" || typeof part.text !== "string") continue

    const text = cleanSessionText(part.text)
    if (text.length > 0) {
      textParts.push(text)
    }
  }

  return textParts.join("\n\n")
}

function maybeString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildPromptHistory(payload: unknown): PromptHistoryEntry[] {
  if (!Array.isArray(payload)) return []

  const entries: PromptHistoryEntry[] = []

  for (const candidate of payload) {
    const msg = candidate as SessionMessagePayload
    if (!msg || typeof msg !== "object") continue

    const info = msg.info as SessionMessageInfo
    if (!info || typeof info !== "object") continue
    if (info.role !== "user") continue

    const id = (info as { id?: unknown }).id
    if (typeof id !== "string") continue

    const parts = Array.isArray(msg.parts) ? (msg.parts as SessionMessagePart[]) : []
    const text = extractMessageText(parts)
    if (text.length === 0) continue

    entries.push({ promptText: text, userMessageID: id })
  }

  return entries
}

function findLatestUserPrompt(payload: unknown): string {
  if (!Array.isArray(payload)) {
    return ""
  }

  for (let index = payload.length - 1; index >= 0; index -= 1) {
    const candidate = payload[index] as SessionMessagePayload
    if (!candidate || typeof candidate !== "object") continue

    const info = candidate.info as SessionMessageInfo
    if (!info || typeof info !== "object") continue
    if (info.role !== "user") continue

    const parts = Array.isArray(candidate.parts) ? (candidate.parts as SessionMessagePart[]) : []
    const text = extractMessageText(parts)
    if (text.length > 0) {
      return text
    }
  }

  return ""
}

function extractAssistantContext(info: SessionMessageInfo): LatestAssistantContext | null {
  const providerID = maybeString(info.providerID)
  const modelID = maybeString(info.modelID)
  const pathValue = info.path
  const pathRecord = pathValue && typeof pathValue === "object" ? (pathValue as { cwd?: unknown }) : null
  const workingDirectory = maybeString(pathRecord?.cwd)
  const agent = maybeString(info.agent)

  if (!providerID && !modelID && !workingDirectory && !agent) {
    return null
  }

  return {
    providerID,
    modelID,
    workingDirectory,
    agent,
  }
}

function findLatestAssistantCompletion(payload: unknown): LatestAssistantSnapshot {
  if (!Array.isArray(payload)) {
    return {
      text: "",
      context: null,
    }
  }

  for (let index = payload.length - 1; index >= 0; index -= 1) {
    const candidate = payload[index] as SessionMessagePayload
    if (!candidate || typeof candidate !== "object") continue

    const info = candidate.info as SessionMessageInfo
    if (!info || typeof info !== "object") continue
    if (info.role !== "assistant") continue

    const time = info.time as { completed?: unknown } | undefined
    if (!time || typeof time !== "object") continue
    if (typeof time.completed !== "number") continue
    const context = extractAssistantContext(info)

    const parts = Array.isArray(candidate.parts) ? (candidate.parts as SessionMessagePart[]) : []
    const text = extractMessageText(parts)

    if (text.length > 0 || context) {
      return {
        text,
        context,
      }
    }
  }

  return {
    text: "",
    context: null,
  }
}
