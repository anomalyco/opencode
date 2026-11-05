import { initialWebUpdate, transitionWebUpdate } from "./web-machine"
import type { WebUpdateEffect, WebUpdateEvent, WebUpdateState, WebWorker } from "./web-machine"

/** How often an open, visible window asks the server for a newer build. */
const CHECK_INTERVAL_MS = 10 * 60_000

/** How long `applying` waits for the new worker to take over before reloading anyway. */
const APPLY_TIMEOUT_MS = 10_000

type Current = { state: WebUpdateState; registration?: ServiceWorkerRegistration; disposed: boolean }

export type WebUpdateReport =
  | { readonly result: "up-to-date" }
  | { readonly result: "failed"; readonly message: string }

export type WebUpdaterOptions = {
  /** The state changed. */
  readonly changed: (state: WebUpdateState) => void
  /** A newer build is ready to load. */
  readonly announce: () => void
  /** The user's check found nothing newer, or failed with `message` (empty when the browser gave none). */
  readonly report: (report: WebUpdateReport) => void
}

/**
 * Runs the web update machine against this window's service worker registration. It checks for a newer build when the
 * window opens, comes back into view or reconnects, and every ten minutes while visible. Without service workers (an
 * insecure origin, or development) it stays `unavailable`.
 */
export function startWebUpdater(options: WebUpdaterOptions) {
  const container = "serviceWorker" in navigator ? navigator.serviceWorker : undefined

  const current: Current = { state: initialWebUpdate, disposed: false }

  const queue: WebUpdateEvent[] = []

  const cleanup: (() => void)[] = []

  // An event dispatched while another applies (a listener that fires synchronously) waits its turn.
  const dispatch = (event: WebUpdateEvent) => {
    if (current.disposed) return
    queue.push(event)

    if (queue.length > 1) return

    for (const next of queue) apply(next)
    queue.length = 0
  }

  const apply = (event: WebUpdateEvent) => {
    const step = transitionWebUpdate(current.state, event)

    if (step.state !== current.state) {
      current.state = step.state
      options.changed(step.state)
    }

    step.effects.forEach(perform)
  }

  const perform = (effect: WebUpdateEffect) => {
    if (effect.type === "announce") return options.announce()

    if (effect.type === "report") return options.report(effect)

    if (effect.type === "reload") return location.reload()

    if (effect.type === "reset") return void reset()

    const registration = current.registration

    if (!registration) return

    if (effect.type === "update") {
      const attempt = effect.attempt

      return void registration.update().then(
        () => dispatch({ type: "check.settled", attempt, worker: newest(registration) }),
        // The browser rejects with a TypeError or DOMException, both Errors.
        (error: Error) => dispatch({ type: "check.failed", attempt, message: error.message }),
      )
    }

    // Workbox's generated worker skips waiting when it receives this message.
    registration.waiting?.postMessage({ type: "SKIP_WAITING" })
    const timer = setTimeout(() => dispatch({ type: "apply.timeout" }), APPLY_TIMEOUT_MS)
    cleanup.push(() => clearTimeout(timer))
  }

  const check = (manual: boolean) => dispatch({ type: "check.requested", manual, at: Date.now() })

  const listen = (target: EventTarget, type: string, listener: () => void) => {
    target.addEventListener(type, listener)
    cleanup.push(() => target.removeEventListener(type, listener))
  }

  const track = (worker: ServiceWorker | null) => {
    if (!worker) return

    listen(worker, "statechange", () => {
      if (worker.state === "installed") dispatch({ type: "worker.installed" })

      if (worker.state === "redundant") dispatch({ type: "worker.redundant" })
    })
  }

  if (container) {
    // A page the worker did not serve (a first visit) already runs the newest build; only a served page follows a
    // takeover.
    const controlled = !!container.controller
    listen(container, "controllerchange", () => {
      if (controlled) dispatch({ type: "controller.changed" })
    })

    void container.ready.then((registration) => {
      if (current.disposed) return

      current.registration = registration
      listen(registration, "updatefound", () => {
        dispatch({ type: "worker.installing" })
        track(registration.installing)
      })
      track(registration.installing)
      dispatch({ type: "registered", worker: newest(registration) })
      check(false)
    })

    listen(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") check(false)
    })
    listen(window, "online", () => check(false))

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") check(false)
    }, CHECK_INTERVAL_MS)

    cleanup.push(() => clearInterval(interval))
  }

  return {
    state: () => current.state,
    /** Asks the server for a newer build now and reports what it found. */
    check: () => check(true),
    /** Moves every window to the downloaded build. */
    apply: () => dispatch({ type: "apply.requested" }),
    /** Drops the saved copy of the app and loads the server's current build. */
    reset: () => dispatch({ type: "reset.requested" }),
    dispose: () => {
      current.disposed = true
      cleanup.splice(0).forEach((run) => run())
    },
  }
}

function newest(registration: ServiceWorkerRegistration): WebWorker {
  if (registration.waiting) return "waiting"

  if (registration.installing) return "installing"

  return "none"
}

// Every window of this origin loses the saved app, so each loads the server's build on its next navigation.
async function reset() {
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
  const names = "caches" in window ? await caches.keys().catch(() => []) : []
  await Promise.allSettled([
    ...registrations.map((registration) => registration.unregister()),
    ...names.map((name) => caches.delete(name)),
  ])
  location.reload()
}
