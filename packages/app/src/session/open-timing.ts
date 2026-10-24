// Always-on timing for each session open: route change → transcript requests → store publish →
// first and newest timeline row painted → idle. Paint uses the e2e navigation milestone rules
// (`e2e/performance/timeline/navigation-milestones.ts`): sample after rAF + setTimeout, and call a
// milestone stable after three consecutive matching samples. Results go to a ring buffer on
// `window.__opencodeSessionOpens` and one `[session-open]` console line, which the desktop app
// writes to `renderer.log`.

type SessionOpenRequest = {
  path: string
  startMs: number
  headersMs?: number
  status?: number
  // content-length on the wire, so compressed bytes when the server compresses.
  bytes?: number
  error?: boolean
}

type SessionOpen = {
  sessionID: string
  at: string
  // A pointer or key press up to a second before the route change starts the clock instead.
  input?: string
  routeMs: number
  cached: { messages: number; view?: boolean }
  requests: SessionOpenRequest[]
  storedMs?: number
  messages?: number
  firstRowMs?: number
  firstRowStableMs?: number
  newestRowMs?: number
  newestRowStableMs?: number
  idleMs?: number
  frames: number
  maxFrameGapMs: number
  outcome?: "idle" | "replaced" | "left" | "timeout"
}

declare global {
  interface Window {
    __opencodeSessionOpens?: SessionOpen[]
  }
}

type Tap = {
  sessionID: string
  path: string
  start: number
  headers?: number
  status?: number
  bytes?: number
  error?: boolean
}

type Active = {
  entry: SessionOpen
  t0: number
  last: number
  taps: Tap[]
  messages: () => number
  streak: { first: number; newest: number; idle: number }
  timer: ReturnType<typeof setTimeout>
}

const bufferSize = 50

const inputWindowMs = 1_000

const timeoutMs = 15_000

const stableSamples = 3

const recentLimit = 16

const messagePath = /^\/api\/session\/([^/]+)\/message$/

let active: Active | undefined

let lastInput = { at: -Infinity, type: "" }

let listening = false

// Home starts the transcript request before it changes the route, so message page requests are
// kept briefly and attributed to an open by session ID rather than by which open is active.
const recent: Tap[] = []

const round = (value: number) => Math.round(value * 10) / 10

function listen() {
  if (listening || typeof document === "undefined") return
  listening = true

  const mark = (event: Event) => {
    lastInput = { at: event.timeStamp, type: event.type }
  }

  document.addEventListener("pointerdown", mark, { capture: true, passive: true })
  document.addEventListener("keydown", mark, { capture: true, passive: true })
}

function finish(outcome: NonNullable<SessionOpen["outcome"]>) {
  const current = active

  if (!current) return
  active = undefined
  clearTimeout(current.timer)
  const at = (value: number | undefined) => (value === undefined ? undefined : round(value - current.t0))

  // A snapshot, so responses that land after the open is logged cannot change the logged entry.
  const entry: SessionOpen = {
    ...current.entry,
    requests: current.taps.map((tap) => ({
      path: tap.path,
      startMs: round(tap.start - current.t0),
      headersMs: at(tap.headers),
      status: tap.status,
      bytes: tap.bytes,
      error: tap.error,
    })),
    outcome,
  }

  const buffer = (window.__opencodeSessionOpens ??= [])

  buffer.push(entry)

  if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize)
  console.info(`[session-open] ${JSON.stringify(entry)}`)
}

function inView(element: Element | null | undefined, bounds: DOMRect | undefined) {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  const top = bounds?.top ?? 0
  const bottom = bounds?.bottom ?? innerHeight

  return rect.height > 0 && rect.bottom > top && rect.top < bottom
}

function sample(current: Active) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (active !== current) return
      const now = performance.now()
      const entry = current.entry
      const streak = current.streak

      entry.frames++
      entry.maxFrameGapMs = Math.max(entry.maxFrameGapMs, round(now - current.last))
      current.last = now
      const at = round(now - current.t0)
      const stored = entry.storedMs !== undefined
      // Only this session's timeline counts: during a transition the outgoing one is still mounted.
      const content = document.querySelector(`[data-timeline-session-key$="/${CSS.escape(entry.sessionID)}"]`)
      const shown = stored && !!content?.checkVisibility({ checkVisibilityCSS: true })
      const bounds = content?.closest('[data-slot="session-timeline-scroll"]')?.getBoundingClientRect()

      // Rows are only walked until the first one is stably in view.
      const first =
        shown &&
        !!content &&
        (streak.first >= stableSamples ||
          [...content.querySelectorAll("[data-timeline-key]")].some((row) => inView(row, bounds)))

      // The bottom spacer follows the last row, so it is in view only when the newest row is.
      const newest = first && inView(content?.querySelector('[data-timeline-row="bottom-spacer"]'), bounds)
      const pinned = !!content?.hasAttribute("data-timeline-pinned")

      streak.first = first ? streak.first + 1 : 0
      streak.newest = newest ? streak.newest + 1 : 0

      if (first) entry.firstRowMs ??= at

      if (newest) entry.newestRowMs ??= at

      if (streak.first === stableSamples) entry.firstRowStableMs ??= at

      if (streak.newest === stableSamples) entry.newestRowStableMs ??= at
      const pending = current.taps.some((tap) => tap.headers === undefined && !tap.error)
      const empty = stored && entry.messages === 0
      // An unpinned open (a message link, a kept scroll position) never shows the newest row.
      const idle = !pending && (empty || (first && (newest || !pinned)))

      streak.idle = idle ? streak.idle + 1 : 0

      if (streak.idle === stableSamples) {
        entry.idleMs = at
        finish("idle")

        return
      }

      sample(current)
    }, 0)
  })
}

export const sessionOpenTiming = {
  start(sessionID: string, messages: () => number) {
    if (typeof window === "undefined") return
    listen()
    finish("replaced")
    const route = performance.now()
    const input = route - lastInput.at <= inputWindowMs ? lastInput : undefined

    lastInput = { at: -Infinity, type: "" }
    const t0 = input?.at ?? route

    const current: Active = {
      entry: {
        sessionID,
        at: new Date(performance.timeOrigin + t0).toISOString(),
        input: input?.type,
        routeMs: round(route - t0),
        cached: { messages: messages() },
        requests: [],
        frames: 0,
        maxFrameGapMs: 0,
      },
      t0,
      last: route,
      taps: recent.filter((tap) => tap.sessionID === sessionID && route - tap.start <= inputWindowMs),
      messages,
      streak: { first: 0, newest: 0, idle: 0 },
      timer: setTimeout(() => finish("timeout"), timeoutMs),
    }

    active = current
    sample(current)
  },
  cancel() {
    finish("left")
  },
  view(cached: boolean) {
    if (active && active.entry.cached.view === undefined) active.entry.cached.view = cached
  },
  stored(sessionID: string) {
    if (!active || active.entry.sessionID !== sessionID || active.entry.storedMs !== undefined) return
    active.entry.storedMs = round(performance.now() - active.t0)
    active.entry.messages = active.messages()
  },
  fetch(base: typeof globalThis.fetch): typeof globalThis.fetch {
    return Object.assign(
      (resource: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? (resource instanceof Request ? resource.method : "GET")
        const url = new URL(resource instanceof Request ? resource.url : resource.toString(), globalThis.location?.href)
        const match = method.toUpperCase() === "GET" ? messagePath.exec(url.pathname) : null

        if (!match) return base(resource, init)

        const tap: Tap = {
          sessionID: decodeURIComponent(match[1]!),
          path: `message${url.search.replace(/cursor=[^&]*/, "cursor")}`,
          start: performance.now(),
        }

        recent.push(tap)

        if (recent.length > recentLimit) recent.shift()

        if (active?.entry.sessionID === tap.sessionID) active.taps.push(tap)
        const response = base(resource, init)

        void response.then(
          (value) => {
            tap.headers = performance.now()
            tap.status = value.status
            const length = value.headers.get("content-length")

            if (length !== null) tap.bytes = Number(length)
          },
          () => {
            tap.error = true
          },
        )

        return response
      },
      { preconnect: () => {} },
    )
  },
}
