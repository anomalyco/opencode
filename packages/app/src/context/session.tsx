import { createSignal, onMount, onCleanup, type ParentProps } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useServer } from "@/context/server"
import { createSessionExpirationWarning } from "@opencode-ai/fork-ui"

/**
 * Session information from /auth/session endpoint.
 */
interface SessionInfo {
  id: string
  username: string
  createdAt: number
  lastAccessTime: number
  uid?: number
  gid?: number
  home?: string
  shell?: string
  csrfToken?: string
}

/**
 * Default session timeout: 7 days in milliseconds.
 */
const DEFAULT_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Poll interval: 60 seconds.
 */
const POLL_INTERVAL_MS = 60 * 1000

export const { use: useSession, provider: SessionProvider } = createSimpleContext({
  name: "Session",
  init: (props: ParentProps) => {
    const server = useServer()
    const [sessionInfo, setSessionInfo] = createSignal<SessionInfo | undefined>(undefined)
    const [isExpired, setIsExpired] = createSignal(false)
    const [ready, setReady] = createSignal(false)
    const [authRequired, setAuthRequired] = createSignal(false)
    let intervalId: number | undefined
    /**
     * Fetch session information from the server.
     */
    async function fetchSession(): Promise<void> {
      try {
        const url = server.url
        if (!url) return

        const res = await fetch(`${url}/auth/session`, {
          credentials: "include",
        })

        if (res.status === 401) {
          // Not authenticated or session expired
          setSessionInfo(undefined)
          setAuthRequired(true) // Auth is enabled but user isn't authenticated
          setIsExpired(sessionInfo() !== undefined) // Only mark expired if we had a session
          return
        }

        if (res.ok) {
          const data = await res.json()
          setSessionInfo(data)
          if (typeof data.csrfToken === "string") {
            sessionStorage.setItem("opencode_csrf_token", data.csrfToken)
          }
          setAuthRequired(false)
          setIsExpired(false)
        } else {
          // Other error - treat as not authenticated
          setSessionInfo(undefined)
        }
      } catch (err) {
        console.warn("Session fetch failed:", err)
        // Don't mark as expired on network error - could be temporary
      } finally {
        setReady(true)
        // Check for expiration warning after each fetch
        expirationWarning.check()
      }
    }

    /**
     * Start polling session status.
     */
    function startPolling(): void {
      // Initial fetch
      void fetchSession()

      // Set up interval
      intervalId = window.setInterval(() => {
        // Pause polling when document is hidden (per RESEARCH.md Pitfall 3)
        if (document.hidden) return

        void fetchSession()
        // expirationWarning.check() is called in fetchSession's finally block
      }, POLL_INTERVAL_MS)
    }

    /**
     * Stop polling session status.
     */
    function stopPolling(): void {
      if (intervalId !== undefined) {
        clearInterval(intervalId)
        intervalId = undefined
      }
    }

    // Start polling on mount
    onMount(() => {
      startPolling()
    })

    // Clean up on unmount
    onCleanup(() => {
      stopPolling()
    })

    /**
     * Calculate remaining time in milliseconds until session expires.
     * Returns undefined if not authenticated or session info not loaded.
     */
    const remainingMs = () => {
      const session = sessionInfo()
      if (!session) return undefined

      const now = Date.now()
      const expiryTime = session.lastAccessTime + DEFAULT_TIMEOUT_MS
      const remaining = expiryTime - now

      return remaining > 0 ? remaining : 0
    }

    const expirationWarning = createSessionExpirationWarning({
      getServerUrl: () => server.url,
      remainingMs,
    })

    // Reactive computed values
    const username = () => sessionInfo()?.username
    const isAuthenticated = () => sessionInfo() !== undefined

    return {
      username,
      isAuthenticated,
      sessionInfo,
      remainingMs,
      isExpired,
      ready,
      authRequired,
    }
  },
})
