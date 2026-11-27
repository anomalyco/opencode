import type { ElectronAPI } from "../api-types"

type Listener = (urls: string[]) => void

// Links that arrived before the app listened, and the app's listeners.
const pending: string[] = []

const listeners = new Set<Listener>()

// Main sends each link to one renderer at a time and forgets it once acknowledged, so a reload or a new window
// never handles it again.
export function startDeepLinks(api: Pick<ElectronAPI, "onDeepLink" | "acknowledgeDeepLinks" | "readyDeepLinks">) {
  api.onDeepLink((delivery) => {
    deliver(delivery.urls)
    api.acknowledgeDeepLinks(delivery.attempt)
  })
  api.readyDeepLinks()
}

/** Follows the links opened with the app; the ones that came before the first listener reach it at once. */
export function onDeepLinks(listener: Listener) {
  listeners.add(listener)

  const queued = pending.splice(0)

  if (queued.length) listener(queued)

  return () => {
    listeners.delete(listener)
  }
}

function deliver(urls: string[]) {
  if (urls.length === 0) return

  if (listeners.size === 0) {
    pending.push(...urls)

    return
  }

  listeners.forEach((listener) => listener(urls))
}
