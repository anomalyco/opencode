import { once, type EventEmitter } from "node:events"
import type { Extension, Session } from "electron"
import { Schema } from "effect"
import { eventPage, manifestQuery } from "./extension-api/event-page"

/** One advisory budget after registration, not one timeout per extension. A cold uBO took 2.3s here. */
const DEADLINE = 3500

/** An advisory barrier for local HTTP navigations, never an extension enable/disable decision. */
export function createFilterGate(lifetime: AbortSignal, unconfirmed: (id: string) => void) {
  type Attempt = { abort: AbortController; retry?: ReturnType<typeof setTimeout> }

  const pending = new Map<string, Attempt>()
  let batch: { done: ReturnType<typeof Promise.withResolvers<void>>; deadline: ReturnType<typeof setTimeout> } | undefined

  const remove = (id: string) => {
    const item = pending.get(id)

    if (!item) return
    pending.delete(id)
    item.abort.abort()
    clearTimeout(item.retry)

    if (pending.size || !batch) return
    clearTimeout(batch.deadline)
    batch.done.resolve()
    batch = undefined
  }

  const clear = () => pending.forEach((_, id) => remove(id))
  lifetime.addEventListener("abort", clear, { once: true })

  return {
    remove,
    start(id: string, probe: (signal: AbortSignal) => Promise<boolean>) {
      if (lifetime.aborted) return
      // Replace an attempt in place; existing navigations keep waiting on the same batch.
      const old = pending.get(id)
      old?.abort.abort()
      clearTimeout(old?.retry)
      const item: Attempt = { abort: new AbortController() }
      pending.set(id, item)
      batch ??= {
        done: Promise.withResolvers<void>(),
        deadline: setTimeout(() => {
          pending.forEach((_, key) => unconfirmed(key))
          clear()
        }, DEADLINE),
      }

      const check = async () => {
        const ready = await probe(item.abort.signal).catch(() => false)

        if (pending.get(id) !== item) return

        if (ready === true) return remove(id)
        item.retry = setTimeout(() => void check(), 50)
      }

      void check()
    },
    wait(url: string, signal: AbortSignal) {
      if (!batch || !/^https?:\/\//i.test(url)) return
      signal.throwIfAborted()
      const canceled = Promise.withResolvers<never>()
      const close = () => canceled.reject(signal.reason)
      signal.addEventListener("abort", close, { once: true })

      return Promise.race([batch.done.promise, canceled.promise]).then(() => {
        lifetime.throwIfAborted()
        signal.throwIfAborted()
      }).finally(() => signal.removeEventListener("abort", close))
    },
  }
}

export function networkPermissions(permissions: readonly string[]) {
  return permissions.some((p) => ["webRequest", "webRequestBlocking", "declarativeNetRequest", "declarativeNetRequestWithHostAccess"].includes(p))
}

const Background = Schema.Struct({
  page: Schema.optional(Schema.String),
  scripts: Schema.optional(Schema.Array(Schema.String)),
  persistent: Schema.optional(Schema.Boolean),
  service_worker: Schema.optional(Schema.String),
})

/** Each retry rechecks Chromium's actual background. A failed start/message during registration is not a permanent
 * failure. Absence of a background is valid for a purely declarative extension. Never expose a package value to main. */
export async function filterReady(session: Session, extension: Extension, signal: AbortSignal) {
  const background = Schema.is(Background)(extension.manifest.background) ? extension.manifest.background : undefined
  const dnr = extension.manifest.permissions?.some((p: string) => p === "declarativeNetRequest" || p === "declarativeNetRequestWithHostAccess")
  const requests = extension.manifest.permissions?.includes("webRequest")

  if (background?.service_worker) {
    const worker = await session.serviceWorkers.startWorkerForScope(extension.url)

    if (!worker || worker.isDestroyed() || worker.scope !== extension.url) return false

    // An MV3 webRequest worker may still be adding its listeners. A dedicated acknowledgement from our own
    // preload checks Chromium's registrations without delivering a synthetic event to the extension.
    if (requests && !dnr) return workerListening(worker, signal)
  }

  signal.throwIfAborted()

  if (background?.page || background?.scripts?.length) {
    const { webContents } = await import("electron")
    const url = new URL(background.page ?? "_generated_background_page.html", extension.url).href

    if (!url.startsWith(extension.url)) return false

    const page = background.persistent === false
      ? await eventPage(session, extension.url, false, signal)
      : webContents.getAllWebContents().find(w => w.session === session && w.getType() === "backgroundPage" && w.getURL() === url)

    if (!page || page.isDestroyed() || page.isCrashed() || page.getURL() !== url || page.isLoadingMainFrame()) return false

    if (requests && !dnr) {
      const listening = await page.executeJavaScript(`['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived','onAuthRequired','onCompleted','onErrorOccurred','onBeforeRedirect','onResponseStarted','onSendHeaders'].some(name => chrome.webRequest?.[name]?.hasListeners?.())`)

      if (listening !== true) return false
    }

    // The native listener exists before uBO attaches its filter engine. On three cold restores it passed the ad
    // while readyToFilter was false. This is advisory even for a local copy: only a boolean leaves the background.
    if (extension.name === "uBlock Origin" && extension.manifest.manifest_version === 2) {
      const ready = await page.executeJavaScript("globalThis.µBlock?.readyToFilter === true && typeof globalThis.vAPI?.net?.suspendableListener === 'function'")

      if (ready !== true) return false
    }
  }

  if (dnr) return manifestQuery(session, extension.url, "rulesets", signal)

  return true
}

/** Chromium can drop a send during startup. Expire this acknowledgement so the gate can probe the new worker
 * on the next attempt. This never extends the shared navigation deadline. */
export async function workerListening(worker: { ipc: EventEmitter; send(channel: string, reply: string): void }, signal: AbortSignal) {
  const channel = `browser-extension:listening:${crypto.randomUUID()}`
  const ack = new AbortController()
  const retry = setTimeout(() => ack.abort(), 250)

  try {
    const [reply] = await Promise.all([
      once(worker.ipc, channel, { signal: AbortSignal.any([signal, ack.signal]) }),
      Promise.resolve().then(() => worker.send("browser-extension:listening", channel)),
    ])

    return reply[1] === true
  } finally {
    clearTimeout(retry)
    ack.abort()
  }
}
