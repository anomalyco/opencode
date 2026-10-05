/**
 * Watches a service worker registration for a new build and hands the caller a way to switch to it.
 *
 * The worker never skips waiting on its own, so an open app keeps its complete build. A waiting build would otherwise
 * activate only once every app window closes, which a suspended home-screen app rarely does.
 */
export function watchServiceWorkerUpdates(registration: ServiceWorkerRegistration, offer: (apply: () => void) => void) {
  const offered = new WeakSet<ServiceWorker>()
  const controlled = !!navigator.serviceWorker.controller

  const check = () => {
    const worker = registration.waiting

    // The first install has no build to replace.
    if (!worker || !controlled || offered.has(worker)) return
    offered.add(worker)
    // Workbox's generated worker skips waiting when a page sends this message.
    offer(() => worker.postMessage({ type: "SKIP_WAITING" }))
  }

  const found = () => {
    const worker = registration.installing

    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") check()
    })
  }

  // Resuming a suspended app is not a navigation, so the browser does not look for a new worker by itself.
  const visible = () => {
    if (document.visibilityState === "visible") void registration.update().catch(() => undefined)
  }

  // Every window moves to the new build together: the old build's lazy chunks are no longer served once it activates.
  // Composer drafts live in IndexedDB, so the reload keeps them.
  const switched = () => {
    if (controlled) location.reload()
  }

  registration.addEventListener("updatefound", found)
  document.addEventListener("visibilitychange", visible)
  navigator.serviceWorker.addEventListener("controllerchange", switched)
  // The page's own navigation may already have started downloading a new build before this watcher attached.
  found()
  check()

  return () => {
    registration.removeEventListener("updatefound", found)
    document.removeEventListener("visibilitychange", visible)
    navigator.serviceWorker.removeEventListener("controllerchange", switched)
  }
}
