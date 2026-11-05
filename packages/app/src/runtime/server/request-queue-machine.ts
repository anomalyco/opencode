// Chromium allows six connections per origin. The event stream holds one for the life of the
// connection and health probes use their own fetch, so the app's API calls stay below that or
// a burst stalls probes and user actions inside the browser where nothing can observe it.
export const REQUEST_QUEUE_LIMIT = 4

// Endpoints that shell out to git or walk the filesystem take seconds on a large repository. They
// may hold at most this many slots, so a session mount's small reads never queue behind them.
export const REQUEST_QUEUE_SLOW_LIMIT = 2

// A mount legitimately fires a dozen requests at once; only a request that has waited this long
// for a slot indicates the server is not keeping up.
export const REQUEST_STALL_MS = 2_000

export const REQUEST_STALL_COOLDOWN_MS = 10_000

const slowRequestPaths = ["/api/vcs", "/api/worktree"]

export type RequestQueueConfig = {
  readonly limit: number
  readonly slowLimit: number
  readonly stallMs: number
}

export type RequestPriority = 0 | 1 | 2

export type RequestEntry = {
  readonly id: number
  readonly method: string
  readonly url: string
  /** When the request arrived while it waits, and when it started once in flight. */
  readonly at: number
  readonly slow: boolean
  readonly priority: RequestPriority
}

export type RequestStallItem = { readonly method: string; readonly url: string; readonly ms: number }

export type RequestStallSnapshot = {
  readonly limit: number
  readonly inflight: readonly RequestStallItem[]
  readonly queued: readonly RequestStallItem[]
}

/**
 * One transport's HTTP slots.
 * - `running`: every request has a slot (possibly none in flight); the stall watcher is off.
 * - `queued`: at least one request waits for a slot; the stall watcher is armed.
 * - `disposed`: the transport is gone; every request it held was cancelled.
 */
export type RequestQueueState =
  | {
      readonly status: "running"
      readonly nextId: number
      readonly warnedAt: number
      readonly inflight: readonly RequestEntry[]
    }
  | {
      readonly status: "queued"
      readonly nextId: number
      readonly warnedAt: number
      readonly inflight: readonly RequestEntry[]
      readonly waiting: readonly RequestEntry[]
    }
  | { readonly status: "disposed" }

export type RequestQueueEvent =
  | {
      readonly type: "request.arrived"
      readonly method: string
      readonly url: string
      readonly slow: boolean
      readonly priority: RequestPriority
      readonly now: number
    }
  | { readonly type: "request.settled"; readonly id: number; readonly now: number }
  | { readonly type: "request.aborted"; readonly id: number; readonly now: number }
  | { readonly type: "watch.due"; readonly now: number }
  | { readonly type: "disposed" }

export type RequestQueueEffect =
  | { readonly type: "request.start"; readonly id: number }
  | { readonly type: "request.cancel"; readonly ids: readonly number[] }
  | { readonly type: "watcher.start"; readonly delayMs: number }
  | { readonly type: "watcher.stop" }
  | { readonly type: "log.stall"; readonly data: RequestStallSnapshot }

export type RequestQueueTransition = {
  readonly state: RequestQueueState
  readonly effects: readonly RequestQueueEffect[]
}

export type RequestClassification =
  | { readonly bypass: true }
  | { readonly bypass: false; readonly slow: boolean; readonly setup: boolean; readonly priority: RequestPriority }

const none: readonly RequestQueueEffect[] = []
const stop: RequestQueueEffect = { type: "watcher.stop" }
const bypass: RequestClassification = { bypass: true }

export function createRequestQueueState(): RequestQueueState {
  return { status: "running", nextId: 1, warnedAt: -Infinity, inflight: [] }
}

export function transitionRequestQueue(
  state: RequestQueueState,
  event: RequestQueueEvent,
  config: RequestQueueConfig,
): RequestQueueTransition {
  if (state.status === "disposed") return { state, effects: none }

  if (event.type === "request.arrived") return arrived(state, event, config)

  if (event.type === "request.settled" || event.type === "request.aborted") return left(state, event, config)

  if (event.type === "watch.due") return watched(state, event.now, config)

  if (state.status === "running")
    return {
      state: { status: "disposed" },
      effects: state.inflight.length ? [{ type: "request.cancel", ids: state.inflight.map((entry) => entry.id) }] : none,
    }

  return {
    state: { status: "disposed" },
    effects: [stop, { type: "request.cancel", ids: [...state.waiting, ...state.inflight].map((entry) => entry.id) }],
  }
}

export function selectInflightCount(state: RequestQueueState) {
  return state.status === "disposed" ? 0 : state.inflight.length
}

export function selectQueuedCount(state: RequestQueueState) {
  return state.status === "queued" ? state.waiting.length : 0
}

export function isRequestInflight(state: RequestQueueState, id: number) {
  return state.status !== "disposed" && state.inflight.some((entry) => entry.id === id)
}

/**
 * The event stream bypasses the queue. Writes go first. Session lists and the first transcript page unblock
 * navigation, so they go ahead of location reads. Older pages and filtered indexes keep background priority.
 */
export function classifyRequest(method: string, url: URL): RequestClassification {
  const pathname = url.pathname

  // The event stream is long-lived; never count it against the request budget.
  if (pathname === "/api/event") return bypass

  const initialMessages =
    /^\/api\/session\/[^/]+\/message$/.test(pathname) &&
    !url.searchParams.has("cursor") &&
    !url.searchParams.has("before") &&
    !url.searchParams.has("type") &&
    url.searchParams.get("order") !== "asc"

  return {
    bypass: false,
    slow: slowRequestPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
    setup: method === "POST" && pathname === "/api/worktree",
    priority: method !== "GET" ? 2 : pathname === "/api/session" || initialMessages ? 1 : 0,
  }
}

type OpenState = Exclude<RequestQueueState, { status: "disposed" }>

function arrived(
  state: OpenState,
  event: Extract<RequestQueueEvent, { type: "request.arrived" }>,
  config: RequestQueueConfig,
): RequestQueueTransition {
  const entry: RequestEntry = {
    id: state.nextId,
    method: event.method,
    url: event.url,
    at: event.now,
    slow: event.slow,
    priority: event.priority,
  }

  const nextId = entry.id + 1

  if (canStart(state.inflight, entry.slow, config))
    return { state: { ...state, nextId, inflight: [...state.inflight, entry] }, effects: [{ type: "request.start", id: entry.id }] }

  if (state.status === "running")
    return {
      state: { status: "queued", nextId, warnedAt: state.warnedAt, inflight: state.inflight, waiting: [entry] },
      effects: [{ type: "watcher.start", delayMs: config.stallMs }],
    }

  // FIFO within each priority tier.
  const position = state.waiting.findIndex((item) => item.priority < entry.priority)

  return {
    state: {
      ...state,
      nextId,
      waiting: position === -1 ? [...state.waiting, entry] : state.waiting.toSpliced(position, 0, entry),
    },
    effects: none,
  }
}

function left(
  state: OpenState,
  event: Extract<RequestQueueEvent, { type: "request.settled" | "request.aborted" }>,
  config: RequestQueueConfig,
): RequestQueueTransition {
  const index = state.inflight.findIndex((entry) => entry.id === event.id)

  if (index === -1) {
    // Only an abort can take a request out of the queue before it starts.
    if (state.status === "running" || event.type === "request.settled") return { state, effects: none }

    const position = state.waiting.findIndex((entry) => entry.id === event.id)

    if (position === -1) return { state, effects: none }

    const waiting = state.waiting.toSpliced(position, 1)

    if (waiting.length) return { state: { ...state, waiting }, effects: none }

    return { state: running(state, state.inflight), effects: [stop] }
  }

  const inflight = state.inflight.toSpliced(index, 1)

  if (state.status === "running") return { state: { ...state, inflight }, effects: none }

  // A slow request waits its turn behind faster ones while the slow slots are full.
  const next = state.waiting.findIndex((entry) => canStart(inflight, entry.slow, config))

  if (next === -1) return { state: { ...state, inflight }, effects: none }

  const promoted = { ...state.waiting[next]!, at: event.now }
  const waiting = state.waiting.toSpliced(next, 1)
  const start: RequestQueueEffect = { type: "request.start", id: promoted.id }

  if (waiting.length) return { state: { ...state, inflight: [...inflight, promoted], waiting }, effects: [start] }

  return { state: running(state, [...inflight, promoted]), effects: [stop, start] }
}

// Debug exports include the console, so list what the server is busy with while requests wait. Priority
// insertion puts newer requests ahead of older ones, so the longest wait is anywhere in the queue.
function watched(state: OpenState, now: number, config: RequestQueueConfig): RequestQueueTransition {
  if (state.status !== "queued") return { state, effects: none }

  const waited = now - state.waiting.reduce((oldest, entry) => Math.min(oldest, entry.at), now)

  if (waited >= config.stallMs && now - state.warnedAt >= REQUEST_STALL_COOLDOWN_MS)
    return {
      state: { ...state, warnedAt: now },
      effects: [
        { type: "watcher.start", delayMs: config.stallMs },
        {
          type: "log.stall",
          data: {
            limit: config.limit,
            inflight: state.inflight.map((entry) => describe(entry, now)),
            queued: state.waiting.map((entry) => describe(entry, now)),
          },
        },
      ],
    }

  return {
    state,
    effects: [
      { type: "watcher.start", delayMs: waited >= config.stallMs ? config.stallMs : Math.max(1, config.stallMs - waited) },
    ],
  }
}

function running(state: OpenState, inflight: readonly RequestEntry[]): RequestQueueState {
  return { status: "running", nextId: state.nextId, warnedAt: state.warnedAt, inflight }
}

function canStart(inflight: readonly RequestEntry[], slow: boolean, config: RequestQueueConfig) {
  if (inflight.length >= config.limit) return false

  if (!slow) return true

  return inflight.reduce((count, entry) => (entry.slow ? count + 1 : count), 0) < config.slowLimit
}

function describe(entry: RequestEntry, now: number): RequestStallItem {
  return { method: entry.method, url: entry.url, ms: now - entry.at }
}
