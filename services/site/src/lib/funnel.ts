// Reports the site's and the docs' pages to the Console's funnel (opencode-console docs/features/funnel.md). The
// tracker the Console serves at /console/funnel/v1.js reads views, sections, clicks, copies, downloads, page speed and
// chunk errors from the page's markup (`data-section`, `data-funnel`, `data-funnel-copy`, `data-funnel-surface`).
// This module is the only part in a page's first JavaScript: it loads the tracker, with the page's config, on the first
// pointer or key press or once the page is idle, and keeps the events a page reports itself until then. Nothing a
// visitor types is ever sent.
export * as Funnel from "./funnel"

type Value = string | number | boolean | null

/** An event the page reports itself, such as a search; the tracker adds the view's surface and path. */
export type FunnelEvent = {
  name: string
  action: string
  target?: string
  properties?: Record<string, Value | readonly string[]>
}

type Queued = { event: FunnelEvent; at: number }

declare global {
  interface Window {
    /**
     * Where a page reports its own events, each at its time on the page's clock: a list until the tracker loads, then
     * the tracker's queue. Only a page that started the funnel has it, so the site's other modules push here directly
     * rather than importing this one, which would split it out of the entry chunk.
     */
    __ocFunnel?: Array<Queued> | { push: (item: Queued) => unknown }
  }
}

// Through Function, as Vite would wrap a plain import() in its preload helper: a kilobyte the docs don't otherwise load.
const load = new Function("url", "return import(url)") as (
  url: string,
) => Promise<{ start: (config: object) => unknown }>

/** Reports `event` on the current view, now; it waits for the tracker when that hasn't loaded yet. */
export function track(event: FunnelEvent) {
  window.__ocFunnel?.push({ event, at: performance.now() })
}

let started = false

/**
 * Loads the tracker and starts it with the config `config` loads, once per page load, on the first pointer or key
 * press or when the page is next idle (within a second). A page in a frame (the device preview) reports nothing.
 * Failures, such as a host without the Console, leave the page as it is.
 */
export function start(config: () => Promise<object>) {
  if (started || typeof window === "undefined" || window.top !== window) return
  started = true
  window.__ocFunnel ??= []
  let waiting = true
  const inputs = ["pointerdown", "keydown"]
  const begin = () => {
    if (!waiting) return
    waiting = false
    inputs.forEach((type) => removeEventListener(type, begin, true))
    // The tracker's URL is a public contract of the Console's: a breaking change ships as v2.js.
    Promise.all([config(), load("/console/funnel/v1.js")])
      .then(([options, module]) => module.start(options))
      .catch(() => undefined)
  }
  inputs.forEach((type) => addEventListener(type, begin, { capture: true, passive: true }))
  if ("requestIdleCallback" in window) return void requestIdleCallback(begin, { timeout: 1000 })
  setTimeout(begin, 1000)
}
