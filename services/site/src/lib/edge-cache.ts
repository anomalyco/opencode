import { getRequestEvent } from "solid-js/web"

// Cloudflare's cache for this Worker's location (the Workers Cache API), in production only. Dev
// (Node) has no `caches.default`, and the Cache API does nothing on workers.dev.
export function edgeCache() {
  if (import.meta.env.DEV) return
  return (globalThis as { caches?: { default?: Cache } }).caches?.default
}

/** Keeps the Worker alive after the response for `work` (ctx.waitUntil), without delaying the response. */
export function background(work: Promise<unknown>) {
  const done = work.catch((error) => console.error("background work failed", error))
  getRequestEvent()?.nativeEvent.waitUntil(done)
}

/**
 * A value from a slow outside source (GitHub, the status page) that page renders never wait on for
 * long. It comes from this isolate's memory, else Cloudflare's cache at this location (shared by the
 * location's isolates and kept for a week), else the source if it answers within `wait`, else
 * `fallback` (for example a build-time snapshot). Once the value is older than `freshFor`, the next
 * read refreshes it in the background (ctx.waitUntil). A failed refresh keeps the last good value
 * and waits out `freshFor` (a minute with no value) before asking again.
 *
 * `read(wait)` resolves to the value and whether it is a stand-in (`fallback`): renders with a
 * stand-in mark the request, so its HTML is kept at the edge for 30 seconds only (lib/html-cache.ts).
 */
export function staleValue<T>(options: {
  key: string
  freshFor: number
  wait: number
  load: () => Promise<T | undefined>
  fallback: () => Promise<T | undefined> | T | undefined
  /** False when the page reads fine without the value (the status bars), so its HTML may still be kept. */
  marksStandIn?: boolean
}) {
  const state: {
    value?: T
    time: number
    tried: number
    pending?: Promise<T | undefined>
    stored?: Promise<void>
  } = {
    time: 0,
    tried: 0,
  }

  const refresh = () => {
    state.pending ??= options
      .load()
      .catch(() => undefined)
      .then(async (value) => {
        state.pending = undefined
        state.tried = Date.now()
        if (value === undefined) {
          if (state.value !== undefined) state.time = Date.now()
          return state.value
        }
        state.value = value
        state.time = Date.now()
        await writeStored(options.key, { time: state.time, value })
        return value
      })
    return state.pending
  }

  return async function read(wait = options.wait): Promise<{ value: T | undefined; standIn: boolean }> {
    state.stored ??= readStored<T>(options.key).then((stored) => {
      if (!stored || state.value !== undefined) return
      state.value = stored.value
      state.time = stored.time
    })
    await state.stored
    const due =
      Date.now() - state.time >= options.freshFor && Date.now() - state.tried >= Math.min(options.freshFor, 60_000)
    if (state.value !== undefined) {
      if (due) background(refresh())
      return { value: state.value, standIn: false }
    }
    // Only the read that starts a refresh waits for it; reads while it runs take the stand-in at
    // once, unless they asked to wait longer than pages do (feeds).
    if (state.pending ? wait <= options.wait : !due) return standIn()
    const pending = refresh()
    background(pending)
    const value = await Promise.race([pending, new Promise<undefined>((resolve) => setTimeout(resolve, wait))])
    if (value !== undefined) return { value, standIn: false }
    return standIn()
  }

  async function standIn() {
    const event = getRequestEvent()
    if (event && options.marksStandIn !== false) event.locals.standIn = true
    return { value: await options.fallback(), standIn: true }
  }
}

function storedRequest(key: string) {
  return new Request(`https://edge-cache.opencode.internal/${key}`)
}

/** A JSON value this Worker stored at its Cloudflare location (`writeStored`), or undefined. */
export async function readStored<T>(key: string) {
  const cache = edgeCache()
  if (!cache) return
  const response = await cache.match(storedRequest(key)).catch(() => undefined)
  return (await response?.json().catch(() => undefined)) as { time: number; value: T } | undefined
}

/**
 * Stores a JSON value at this Cloudflare location for `seconds` (a week by default). Only this
 * Worker's code can read it: its key is on a host no visitor can request.
 */
export async function writeStored(key: string, entry: { time: number; value: unknown }, seconds = 604800) {
  const cache = edgeCache()
  if (!cache) return
  const response = new Response(JSON.stringify(entry), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${seconds}` },
  })
  await cache.put(storedRequest(key), response).catch(() => {})
}
