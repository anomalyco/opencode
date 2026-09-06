type Entry = { method: string; url: string; at: number }

// Chromium allows six connections per origin. The event stream holds one for the life of the
// connection and health probes use their own fetch, so the app's API calls stay below that or
// a burst stalls probes and user actions inside the browser where nothing can observe it.
export const requestQueueLimit = 4

// A mount legitimately fires a dozen requests at once; only a request that has waited this long
// for a slot indicates the server is not keeping up.
export const requestStallMs = 2_000

// A socket that dies while the device sleeps can leave fetch waiting for response headers until the
// OS gives up on TCP retransmits, which takes minutes. Bound that so a dead request frees its slot
// instead of wedging every later API call; the body may still stream for as long as it needs.
export const requestHeadersTimeoutMs = 60_000

export function createRequestQueue(input: {
  fetch: typeof globalThis.fetch
  limit?: number
  stallMs?: number
  headersTimeoutMs?: number
  log?: (message: string, data: Record<string, unknown>) => void
  now?: () => number
}) {
  const limit = input.limit ?? requestQueueLimit
  const stallMs = input.stallMs ?? requestStallMs
  const headersTimeoutMs = input.headersTimeoutMs ?? requestHeadersTimeoutMs
  // Call the browser fetch unbound; `input.fetch(...)` would make `this` the options object.
  const base = input.fetch
  const now = input.now ?? Date.now
  const log = input.log ?? ((message, data) => console.warn(`[server-request-queue] ${message}`, data))
  const inflight = new Set<Entry>()
  const waiting: Array<{ entry: Entry; start: () => void }> = []
  let warned = -Infinity
  let watcher: ReturnType<typeof setTimeout> | undefined

  const describe = (entry: Entry) => ({ method: entry.method, url: entry.url, ms: now() - entry.at })
  // Debug exports include the console, so list what the server is busy with while requests wait.
  const watch = () => {
    watcher = undefined
    const oldest = waiting[0]?.entry
    if (!oldest) return
    if (now() - oldest.at >= stallMs && now() - warned >= 10_000) {
      warned = now()
      log("server thrashing detected", {
        limit,
        inflight: [...inflight].map(describe),
        queued: waiting.map((item) => describe(item.entry)),
      })
    }
    watcher = setTimeout(watch, stallMs)
  }
  const release = (entry: Entry) => {
    inflight.delete(entry)
    waiting.shift()?.start()
  }
  const acquire = (entry: Entry) =>
    new Promise<void>((resolve) => {
      const start = () => {
        entry.at = now()
        inflight.add(entry)
        resolve()
      }
      if (inflight.size < limit) return start()
      waiting.push({ entry, start })
      watcher ??= setTimeout(watch, stallMs)
    })

  const fetch: typeof globalThis.fetch = Object.assign(
    async (resource: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(resource, init)
      // The event stream is long-lived; never count it against the request budget.
      if (new URL(request.url).pathname === "/api/event") return base(request)
      const entry = { method: request.method, url: request.url, at: now() }
      await acquire(entry)
      if (request.signal.aborted) {
        release(entry)
        throw request.signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
      }
      const controller = new AbortController()
      request.signal.addEventListener("abort", () => controller.abort(request.signal.reason), { once: true })
      const timer = setTimeout(
        () => controller.abort(new DOMException("Timed out waiting for the server to respond", "TimeoutError")),
        headersTimeoutMs,
      )
      return base(new Request(request, { signal: controller.signal })).finally(() => {
        clearTimeout(timer)
        release(entry)
      })
    },
    // Bun's fetch type carries preconnect; the browser never calls it.
    { preconnect: () => {} },
  )

  return {
    fetch,
    inflight: () => inflight.size,
    queued: () => waiting.length,
  }
}
