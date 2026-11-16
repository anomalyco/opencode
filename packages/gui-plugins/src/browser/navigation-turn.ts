import type { Browser } from "@opencode/plugin-browser/rpc"

/** A page owns at most one not-yet-issued navigation. Once issued, Chromium owns cancellation and history. */
export function navigationTurn(
  wait: ((url: string, signal: AbortSignal) => Promise<void> | undefined) | undefined,
  started: (url: string) => void,
  stopped: () => void,
) {
  let pending: AbortController | undefined
  let spinning = false

  const cancel = () => {
    pending?.abort()
    pending = undefined

    if (spinning) stopped()
    spinning = false
  }

  return {
    cancel,
    nativeStart(event: { isMainFrame: boolean; isSameDocument: boolean }) {
      if (event.isMainFrame && !event.isSameDocument) cancel()
    },
    interrupt(method: Browser.Method, restoring?: string) {
      if (!["stop", "back", "forward", "reload", "navigate"].includes(method)) return

      // This load hasn't been issued yet. Let it satisfy Reload: cancelling would both lose its URL and leave
      // initial CDP setup waiting for a renderer that the replacement command cannot start until setup finishes.
      if (method === "reload" && pending && restoring && /^https?:\/\//i.test(restoring)) return restoring
      cancel()
    },
    begin(signal: AbortSignal) {
      cancel()
      const mine = new AbortController()
      pending = mine
      const lifetime = AbortSignal.any([mine.signal, signal])

      return async (url: string, issue: () => void | Promise<void>, loading?: () => boolean) => {
        if (mine.signal.aborted) return
        lifetime.throwIfAborted()
        const waiting = wait?.(url, lifetime)

        if (waiting) {
          // Let the pane take ownership before publishing the initial restore's spinner.
          await Promise.resolve()

          if (!lifetime.aborted) {
            spinning = true
            started(url)
          }

          await waiting.catch((cause: unknown) => {
            if (mine.signal.aborted) return
            cancel()
            throw cause
          })
        }

        if (mine.signal.aborted) return
        lifetime.throwIfAborted()
        pending = undefined
        spinning = false
        await issue()

        // Same-document history traversal need not emit did-stop-loading to settle our synthetic spinner.
        if (waiting && !pending && loading && !loading()) stopped()
      }
    },
  }
}
