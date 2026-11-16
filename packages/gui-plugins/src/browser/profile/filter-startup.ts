import type { Extension, Session, WebContents } from "electron"
import { Schema } from "effect"
import { eventPage, manifestQuery } from "./extension-api/event-page"
import { apiManifest } from "./extension-api/manifest"

/** One advisory budget, not one per extension. On ten cold two-blocker profiles the last confirmation came
 * 4.15–4.32s after the first registration. */
const DEADLINE = 5000

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

      const check = async (interval: number) => {
        const ready = await probe(item.abort.signal).catch(() => false)

        if (pending.get(id) !== item) return

        if (ready === true) return remove(id)
        item.retry = setTimeout(() => void check(Math.min(500, 2 * interval)), interval)
      }

      void check(50)
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

export function filterKind(extension: Pick<Extension, "manifest">) {
  const { permissions, version } = apiManifest(extension)

  if (permissions.some(p => p === "declarativeNetRequest" || p === "declarativeNetRequestWithHostAccess")) return "rulesets"

  // In Electron 44 webRequest listeners on MV3 service workers receive no requests (see compatibility.ts).
  if (version === 2 && permissions.some(p => p === "webRequest" || p === "webRequestBlocking")) return "requests"
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
  const kind = filterKind(extension)

  if (!kind) return true
  const background = Schema.is(Background)(extension.manifest.background) ? extension.manifest.background : undefined

  if (background?.service_worker) {
    const worker = await session.serviceWorkers.startWorkerForScope(extension.url)

    if (!worker || worker.isDestroyed() || worker.scope !== extension.url) return false
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

    if (kind === "requests") return backgroundReady(page, extension.name === "uBlock Origin", signal)
  }

  if (kind === "rulesets") return manifestQuery(session, extension.url, "rulesets", signal)

  return true
}

/** A first-install background can reload itself while its JS call is in flight. Electron need not settle that
 * call for the old frame; let the next poll find the replacement instead of consuming the entire gate deadline. */
async function backgroundReady(page: WebContents, ublock: boolean, signal: AbortSignal) {
  const lost = Promise.withResolvers<false>()
  const stop = () => lost.resolve(false)
  const timer = setTimeout(stop, 500)
  page.once("destroyed", stop)
  page.once("render-process-gone", stop)
  signal.addEventListener("abort", stop, { once: true })
  const listeners = `['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived','onAuthRequired','onCompleted','onErrorOccurred','onBeforeRedirect','onResponseStarted','onSendHeaders'].some(name => chrome.webRequest?.[name]?.hasListeners?.())`
  const engine = "globalThis.µBlock?.readyToFilter === true && typeof globalThis.vAPI?.net?.suspendableListener === 'function'"

  try {
    signal.throwIfAborted()

    return await Promise.race([page.mainFrame.executeJavaScript(ublock ? `${listeners} && ${engine}` : listeners), lost.promise]) === true
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", stop)
    page.off("destroyed", stop)
    page.off("render-process-gone", stop)
  }
}
