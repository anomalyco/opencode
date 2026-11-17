import type { Browser } from "@opencode/plugin-browser/rpc"

/** Electron rejects loadURL as soon as a second main-frame navigation starts, before its document commits. */
export function replacementNavigation() {
  let starts = 0
  let replacement: ReturnType<typeof Promise.withResolvers<boolean>> | undefined

  return {
    start(event: { isMainFrame: boolean; isSameDocument: boolean }) {
      if (event.isMainFrame && !event.isSameDocument && ++starts === 2) replacement = Promise.withResolvers<boolean>()
    },
    commit: () => replacement?.resolve(true),
    stop: () => replacement?.resolve(false),
    after(error: Error) {
      return "errno" in error && error.errno === -3 ? replacement?.promise : undefined
    },
  }
}

/** A page owns at most one not-yet-issued navigation. Once issued, Chromium owns cancellation and history. */
export function navigationTurn(
  wait: ((url: string, signal: AbortSignal) => Promise<void> | undefined) | undefined,
  started: (url: string) => void,
  stopped: () => void,
  heldStop?: (address?: string) => void,
) {
  let pending: AbortController | undefined
  let held: string | undefined
  let spinning = false

  const cancel = () => {
    pending?.abort()
    pending = undefined
    held = undefined

    if (spinning) stopped()
    spinning = false
  }

  return {
    cancel,
    nativeStart(event: { isMainFrame: boolean; isSameDocument: boolean }) {
      if (event.isMainFrame && !event.isSameDocument) cancel()
    },
    interrupt(method: Browser.Method, restoring?: string, origin?: "agent" | "user") {
      if (!["stop", "back", "forward", "reload", "navigate"].includes(method)) return

      // This load hasn't been issued yet. Let it satisfy Reload: cancelling would both lose its URL and leave
      // initial CDP setup waiting for a renderer that the replacement command cannot start until setup finishes.
      if (pending && restoring) {
        if (method === "reload") return restoring

        // Navigate still gets its own destination after ready. Do not cancel the load that creates the renderer
        // while a preview is resolving its grant, before it has even entered the network gate.
        if (method === "navigate") {
          if (origin !== "user" || held === undefined || !heldStop) return
          const address = held
          spinning = false
          cancel()
          heldStop(address || restoring)

          return
        }
      }

      // A not-yet-issued initial restore has no committed history entry to traverse.
      if ((method === "stop" || (restoring && (method === "back" || method === "forward"))) && (held !== undefined || (pending && restoring)) && heldStop) {
        const address = held ?? restoring
        spinning = false
        cancel()
        heldStop(address || undefined)

        return
      }

      cancel()
    },
    begin(signal: AbortSignal, keepAddress = true) {
      cancel()
      const mine = new AbortController()
      pending = mine
      const lifetime = AbortSignal.any([mine.signal, signal])

      return async (url: string, issue: () => void | Promise<void>, loading?: () => boolean) => {
        if (mine.signal.aborted) return
        lifetime.throwIfAborted()
        const waiting = wait?.(url, lifetime)

        if (waiting) {
          held = keepAddress ? url : ""
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
        held = undefined
        spinning = false
        await issue()

        // Same-document history traversal need not emit did-stop-loading to settle our synthetic spinner.
        if (waiting && !pending && loading && !loading()) stopped()
      }
    },
  }
}
