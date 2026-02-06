import { showToast, toaster } from "@opencode-ai/ui/toast"

const WARNING_THRESHOLD_MS = 15 * 60 * 1000

export type SessionExpirationWarningOptions = {
  getServerUrl: () => string | undefined
  remainingMs: () => number | undefined
}

export function createSessionExpirationWarning(options: SessionExpirationWarningOptions) {
  let warningShown = false
  let warningToastId: number | undefined

  const resetWarning = () => {
    if (!warningShown) return
    warningShown = false
    if (warningToastId !== undefined) {
      toaster.dismiss(warningToastId)
      warningToastId = undefined
    }
  }

  const extendSession = async () => {
    const url = options.getServerUrl()
    if (!url) return

    try {
      await fetch(`${url}/auth/session`, {
        credentials: "include",
      })
      resetWarning()
    } catch (err) {
      console.warn("Failed to extend session:", err)
    }
  }

  const check = () => {
    const remaining = options.remainingMs()
    if (remaining === undefined) return

    if (remaining < WARNING_THRESHOLD_MS && remaining > 0 && !warningShown) {
      warningShown = true
      warningToastId = showToast({
        title: "Session expiring soon",
        description: "Your session will expire in about 15 minutes",
        persistent: true,
        actions: [
          {
            label: "Extend session",
            onClick: extendSession,
          },
        ],
      })
      return
    }

    if (remaining >= WARNING_THRESHOLD_MS && warningShown) {
      resetWarning()
    }
  }

  return { check, reset: resetWarning }
}
