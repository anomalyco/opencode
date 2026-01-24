import { createSignal, createEffect, onMount, onCleanup, type ParentProps } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useServer } from "@/context/server"
import { showToast, toaster } from "@opencode-ai/ui/toast"

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
}

/**
 * Default session timeout: 7 days in milliseconds.
 */
const DEFAULT_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Poll interval: 60 seconds.
 */
const POLL_INTERVAL_MS = 60 * 1000

/**
 * Warning threshold: 15 minutes in milliseconds.
 * Show warning toast when session has less than this time remaining.
 */
const WARNING_THRESHOLD_MS = 15 * 60 * 1000

export const { use: useSession, provider: SessionProvider } = createSimpleContext({
  name: "Session",
  init: (props: ParentProps) => {
    const server = useServer()
    const [sessionInfo, setSessionInfo] = createSignal<SessionInfo | undefined>(undefined)
    const [isExpired, setIsExpired] = createSignal(false)
    const [ready, setReady] = createSignal(false)
    const [authRequired, setAuthRequired] = createSignal(false)
    let intervalId: number | undefined
    let warningShown = false
    let warningToastId: number | undefined

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
      }
    }

    /**
     * Check if session is expiring soon and show warning toast.
     */
    function checkExpirationWarning(): void {
      const remaining = remainingMs()
      if (remaining === undefined) return

      // Show warning when below threshold but session not yet expired
      if (remaining < WARNING_THRESHOLD_MS && remaining > 0 && !warningShown) {
        warningShown = true
        warningToastId = showToast({
          title: "Session expiring soon",
          description: "Your session will expire in about 15 minutes",
          persistent: true,
          actions: [
            {
              label: "Extend session",
              onClick: async () => {
                const url = server.url
                if (!url) return

                try {
                  // Fetch /auth/session to trigger UserSession.touch() via middleware
                  await fetch(`${url}/auth/session`, {
                    credentials: "include",
                  })
                  // Polling will pick up the new lastAccessTime
                  // Reset warning state
                  warningShown = false
                  if (warningToastId !== undefined) {
                    toaster.dismiss(warningToastId)
                    warningToastId = undefined
                  }
                } catch (err) {
                  console.warn("Failed to extend session:", err)
                }
              },
            },
          ],
        })
      }

      // Reset warning state when session is extended (back above threshold)
      if (remaining >= WARNING_THRESHOLD_MS && warningShown) {
        warningShown = false
        if (warningToastId !== undefined) {
          toaster.dismiss(warningToastId)
          warningToastId = undefined
        }
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
        checkExpirationWarning()
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

    // Reactive computed values
    const username = () => sessionInfo()?.username
    const isAuthenticated = () => sessionInfo() !== undefined

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
