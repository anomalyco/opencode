import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { createWebGitHubConnector } from "./web-github"
import type { DeviceFlowStart, GitHubConnectorStatus, GitHubConnectorPlatform } from "./types"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * SolidJS controller for the GitHub connector.
 *
 * Resolves a `GitHubConnectorPlatform` from the best available transport:
 * - Desktop: the platform bridge (`platform.connector.github`), backed by IPC
 *   to the main process, which owns the device-flow polling and the encrypted
 *   token (safeStorage).
 * - Web: the Jarvis server connector endpoints, which proxy the device flow
 *   and store the token server-side (no CORS, no token in the browser).
 *
 * Returns null-ish behaviour gracefully when neither transport is available,
 * letting the UI show an "unavailable" state.
 */
export function useGitHubConnector() {
  const platform = usePlatform()
  const serverSDK = useServerSDK()

  // Cache the resolved transport for the lifetime of this controller instance.
  const github = createMemo<GitHubConnectorPlatform | undefined>(() => {
    const platformConnector = platform.connector?.github
    if (platformConnector) return platformConnector
    try {
      const sdk = serverSDK()
      const http = sdk.server.http
      return createWebGitHubConnector({
        baseUrl: http.url,
        username: http.username,
        password: http.password,
        fetch: platform.fetch,
      })
    } catch {
      // No active server (e.g. settings opened before a server is selected).
      return undefined
    }
  })

  const [status, setStatus] = createSignal<GitHubConnectorStatus>({
    enabled: false,
    connected: false,
  })
  const [device, setDevice] = createSignal<DeviceFlowStart | null>(null)
  const [polling, setPolling] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Load persisted status on mount.
  onMount(() => {
    const api = github()
    if (!api) return
    void api
      .getStatus()
      .then(setStatus)
      .catch(() => undefined)
  })

  // Stop any in-flight polling loop when this controller is disposed
  // (e.g. the settings dialog closes mid-authorization).
  onCleanup(() => {
    setDevice(null)
    setPolling(false)
  })

  /** Toggle the connector Switch. Disabling keeps the token (re-enabling is instant). */
  async function toggleEnabled(enabled: boolean) {
    const api = github()
    if (!api) return
    try {
      const next = await api.setEnabled(enabled)
      setStatus(next)
    } catch {
      setError("generic")
    }
  }

  /** Start a device-flow authorization and begin polling until a terminal state. */
  async function startConnect() {
    const api = github()
    if (!api) return
    setError(null)
    let started: DeviceFlowStart
    try {
      started = await api.startDeviceFlow()
    } catch {
      setError("generic")
      return
    }
    setDevice(started)
    void pollLoop(started)
  }

  async function pollLoop(started: DeviceFlowStart) {
    const api = github()
    if (!api) return
    setPolling(true)
    try {
      let interval = started.interval
      while (device() !== null) {
        await sleep(interval * 1000)
        const current = device()
        if (!current || current.sessionId !== started.sessionId) return
        let result
        try {
          result = await api.pollDeviceFlow(current.sessionId)
        } catch {
          setError("generic")
          setDevice(null)
          return
        }
        if (result.status === "pending") {
          if (result.slowDown) interval += 5
          continue
        }
        if (result.status === "success") {
          setStatus({ enabled: true, connected: true, user: result.user })
        } else if (result.status === "expired") {
          setError("expired")
        } else if (result.status === "denied") {
          setError("denied")
        } else {
          setError(result.message || "generic")
        }
        setDevice(null)
        return
      }
    } finally {
      setPolling(false)
    }
  }

  /** Cancel an in-flight authorization attempt (main-process session expires on its own). */
  function cancelConnect() {
    setDevice(null)
    setPolling(false)
  }

  /** Revoke the stored token and disconnect the account. */
  async function disconnect() {
    const api = github()
    if (!api) return
    try {
      const next = await api.disconnect()
      setStatus(next)
      setError(null)
    } catch {
      setError("generic")
    }
  }

  return {
    status,
    device,
    polling,
    error,
    /** Whether a transport exists (desktop bridge or web server connector). */
    available: () => github() !== undefined,
    toggleEnabled,
    startConnect,
    cancelConnect,
    disconnect,
  }
}

export type GitHubConnectorController = ReturnType<typeof useGitHubConnector>
