import { once } from "node:events"
import type { ServiceWorkerMain, Session, WebContents } from "electron"
import { eventPage } from "./event-page"
import type { Wire } from "./api"

/** One FIFO per installation: a navigation burst shares the first wake, and cannot overtake a click being retried. */
export function workerQueue() {
  const lifetime = new AbortController()
  let tail = Promise.resolve()
  let pending = 0

  return {
    close: () => lifetime.abort(),
    enqueue(attempt: (fresh: boolean, signal: AbortSignal) => Promise<void>) {
      if (pending >= 256) return Promise.reject(new Error("Extension event queue is full."))
      pending++

      const result = tail
        .then(async () => {
          if (lifetime.signal.aborted) return
          await bounded(attempt, false, lifetime.signal).catch(async () => {
            if (!lifetime.signal.aborted) await bounded(attempt, true, lifetime.signal)
          })
        })
        .finally(() => {
          pending--
        })

      tail = result.catch(() => undefined)

      return result
    },
  }
}

/** ServiceWorkerMain.send returns void even when its renderer pipe has gone. Hold a task until the preload confirms
 * dispatch in the worker's world. A retry asks Chromium to start the registration rather than reusing a stale ID. */
export async function sendBackgroundEvent(
  session: Session,
  scope: string,
  kind: "worker" | "eventPage",
  token: string,
  name: string,
  args: readonly Wire[],
  fresh: boolean,
  signal: AbortSignal,
) {
  if (kind === "eventPage") {
    const page = await eventPage(session, scope, fresh, signal)

    return dispatch(page, token, name, args, signal)
  }

  const service = session.serviceWorkers
  const running = !fresh && Object.entries(service.getAllRunning()).find(([, info]) => info.scope === scope)

  const worker =
    (running && service.getWorkerFromVersionID(Number(running[0]))) || (await service.startWorkerForScope(scope))

  signal.throwIfAborted()

  if (!worker || worker.isDestroyed() || worker.scope !== scope)
    throw new Error("Extension worker is no longer running.")
  const task = worker.startTask()

  try {
    await dispatch(worker, token, name, args, signal)
  } finally {
    if (!worker.isDestroyed()) task.end()
  }
}

async function dispatch(
  recipient: ServiceWorkerMain | WebContents,
  token: string,
  name: string,
  args: readonly Wire[],
  signal: AbortSignal,
) {
  const cancel = new AbortController()

  try {
    const [reply] = await Promise.all([
      once(recipient.ipc, `browser-extension:received:${token}`, { signal: AbortSignal.any([signal, cancel.signal]) }),
      Promise.resolve().then(() => {
        signal.throwIfAborted()
        recipient.send("browser-extension:event", name, args, token)
      }),
    ])

    if (reply[1] !== true) throw new Error("Extension background has no listener for this event.")
  } finally {
    cancel.abort()
  }
}

/** Bound the whole attempt, including Chromium starting the worker and an event page running its wake callback. */
async function bounded(
  deliver: (fresh: boolean, signal: AbortSignal) => Promise<void>,
  fresh: boolean,
  lifetime: AbortSignal,
) {
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(5000)])
  signal.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const stop = () => aborted.reject(signal.reason)
  signal.addEventListener("abort", stop, { once: true })

  try {
    await Promise.race([deliver(fresh, signal), aborted.promise])
  } finally {
    signal.removeEventListener("abort", stop)
  }
}
