import type { Block, Projection } from "./markdown-stream"
import {
  applyMarkdownWorkerResponse,
  applyProjectionBlocks,
  shouldReleaseMarkdownWorkerState,
  type MarkdownWorkerRequest,
  type MarkdownWorkerResponse,
  type MarkdownWorkerState,
} from "./markdown-worker-protocol"

/** Highlight streams kept before the least recently updated one without a request in flight is evicted. */
export const HIGHLIGHT_STREAM_LIMIT = 200

/** Cooldown after a worker's first failure; each consecutive failure doubles it, up to the maximum. */
export const WORKER_RETRY_DELAY_MS = 2_000

export const WORKER_RETRY_MAX_DELAY_MS = 60_000

/** The worker fails when the oldest request in flight makes no progress across one whole window. */
export const WORKER_HANG_TIMEOUT_MS = 15_000

/** A request held for one worker attempt. The same object is posted as the worker message. */
export type WorkerRequest = Exclude<MarkdownWorkerRequest, { type: "dispose" }>

/** One key's coalescing lane: `active` is posted to the worker, `queued` is the newest snapshot waiting behind it. */
export type WorkerLane = { readonly active: number; readonly queued?: number }

export type WorkerFailure =
  /** The worker could not start, or is cooling down after a failure. */
  { readonly kind: "unavailable"; readonly message: string } | { readonly kind: "error"; readonly message: string }

export type WorkerRejectReason = { readonly kind: "disposed" } | { readonly kind: "superseded" } | WorkerFailure

type Counters = {
  /** Request ids issued across every attempt; the next request takes `issued + 1`. */
  readonly issued: number
  /** Workers spawned so far; the live or last worker is attempt `attempts`. */
  readonly attempts: number
  /** Failures since the last worker reply, which set the retry backoff. */
  readonly failures: number
  /** The highest stream generation dropped so far, so a recreated stream never repeats a rendered generation. */
  readonly generationFloor: number
}

export type MarkdownWorkerReady = Counters & {
  readonly status: "ready"
  /** The oldest request in flight when the watchdog was armed; undefined while it is disarmed. */
  readonly watched: number | undefined
  /** Every unsettled request by id, in issue order. */
  readonly requests: ReadonlyMap<number, WorkerRequest>
  readonly projectLanes: ReadonlyMap<string, WorkerLane>
  /** The blocks of the last projection the worker sent per key, which its next response builds on. */
  readonly projections: ReadonlyMap<string, Block[]>
  readonly highlightLanes: ReadonlyMap<string, WorkerLane>
  /** Accumulated tokens per streamed code block, least recently updated first. */
  readonly highlightStreams: ReadonlyMap<string, MarkdownWorkerState>
}

/**
 * `idle` has no worker and spawns one on the next request. `ready` owns worker `attempts`, every request in flight, and
 * the per-key caches built on its replies. `failed` terminated that worker and rejects requests until its cooldown ends.
 */
export type MarkdownWorkerMachineState =
  | (Counters & { readonly status: "idle" })
  | MarkdownWorkerReady
  | (Counters & { readonly status: "failed"; readonly message: string })

export type MarkdownWorkerEvent =
  | { readonly type: "parse.requested"; readonly text: string }
  | { readonly type: "parse.aborted"; readonly id: number }
  | { readonly type: "project.requested"; readonly key: string; readonly text: string; readonly live: boolean }
  | { readonly type: "project.disposed"; readonly key: string }
  | {
      readonly type: "highlight.requested"
      readonly key: string
      readonly text: string
      readonly language: string
      readonly complete: boolean
    }
  | { readonly type: "highlight.disposed"; readonly key: string }
  | { readonly type: "worker.message"; readonly attempt: number; readonly response: MarkdownWorkerResponse }
  | { readonly type: "worker.spawn-failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "worker.crashed"; readonly attempt: number; readonly message: string }
  | { readonly type: "watchdog.fired"; readonly attempt: number }
  | { readonly type: "retry.ready"; readonly attempt: number }

export type MarkdownWorkerEffect =
  | { readonly type: "spawn-worker"; readonly attempt: number }
  | { readonly type: "close-worker"; readonly attempt: number }
  | { readonly type: "post"; readonly attempt: number; readonly message: MarkdownWorkerRequest }
  | { readonly type: "arm-watchdog"; readonly attempt: number; readonly delay: number }
  | { readonly type: "schedule-retry"; readonly attempt: number; readonly delay: number }
  | { readonly type: "resolve-parse"; readonly id: number; readonly html: string }
  | { readonly type: "resolve-project"; readonly id: number; readonly projection: Projection }
  | { readonly type: "resolve-highlight"; readonly id: number; readonly value: MarkdownWorkerState }
  | { readonly type: "reject"; readonly ids: readonly number[]; readonly reason: WorkerRejectReason }

export type MarkdownWorkerTransition = {
  readonly state: MarkdownWorkerMachineState
  readonly effects: readonly MarkdownWorkerEffect[]
}

export const INITIAL_MARKDOWN_WORKER_STATE: MarkdownWorkerMachineState = Object.freeze({
  status: "idle",
  issued: 0,
  attempts: 0,
  failures: 0,
  generationFloor: 0,
})

export const EMPTY_WORKER_EFFECTS: readonly MarkdownWorkerEffect[] = Object.freeze([])

const DISPOSED: WorkerRejectReason = Object.freeze({ kind: "disposed" })

const SUPERSEDED: WorkerRejectReason = Object.freeze({ kind: "superseded" })

const TIMED_OUT: WorkerFailure = Object.freeze({ kind: "error", message: "Markdown worker timed out" })

const OUT_OF_SYNC: WorkerFailure = Object.freeze({ kind: "error", message: "Markdown projection out of sync" })

type Requested = Extract<MarkdownWorkerEvent, { type: "parse.requested" | "project.requested" | "highlight.requested" }>

type KeyedRequest = Extract<WorkerRequest, { key: string }>

type LaneField = "projectLanes" | "highlightLanes"

export function transitionMarkdownWorker(
  state: MarkdownWorkerMachineState,
  event: MarkdownWorkerEvent,
): MarkdownWorkerTransition {
  if (event.type === "parse.requested" || event.type === "project.requested" || event.type === "highlight.requested")
    return request(state, event)

  if (event.type === "retry.ready") {
    if (state.status !== "failed" || event.attempt !== state.attempts) return { state, effects: EMPTY_WORKER_EFFECTS }

    return {
      state: {
        status: "idle",
        issued: state.issued,
        attempts: state.attempts,
        failures: state.failures,
        generationFloor: state.generationFloor,
      },
      effects: EMPTY_WORKER_EFFECTS,
    }
  }

  // Every other event belongs to a live worker. A failed one settled everything once and ignores the rest.
  if (state.status !== "ready") return { state, effects: EMPTY_WORKER_EFFECTS }

  if (event.type === "parse.aborted") {
    if (state.requests.get(event.id)?.type !== "parse") return { state, effects: EMPTY_WORKER_EFFECTS }

    return {
      state: { ...state, requests: without(state.requests, event.id) },
      effects: [{ type: "reject", ids: [event.id], reason: DISPOSED }],
    }
  }

  if (event.type === "project.disposed") return dispose(state, "projectLanes", event.key)

  if (event.type === "highlight.disposed") return dispose(state, "highlightLanes", event.key)

  if (event.attempt !== state.attempts) return { state, effects: EMPTY_WORKER_EFFECTS }

  if (event.type === "worker.message") return message(state, event.response)

  if (event.type === "worker.spawn-failed") return fail(state, { kind: "unavailable", message: event.message })

  if (event.type === "worker.crashed") return fail(state, { kind: "error", message: event.message })

  if (state.requests.size === 0) return { state: { ...state, watched: undefined }, effects: EMPTY_WORKER_EFFECTS }
  const oldest = state.requests.keys().next().value

  if (oldest === state.watched) return fail(state, TIMED_OUT)

  return {
    state: { ...state, watched: oldest },
    effects: [{ type: "arm-watchdog", attempt: state.attempts, delay: WORKER_HANG_TIMEOUT_MS }],
  }
}

function request(state: MarkdownWorkerMachineState, event: Requested): MarkdownWorkerTransition {
  const id = state.issued + 1

  if (state.status === "failed")
    return {
      state: { ...state, issued: id },
      effects: [{ type: "reject", ids: [id], reason: { kind: "unavailable", message: state.message } }],
    }

  const message = requestMessage(event, id)

  if (state.status === "ready") return admit(state, message, EMPTY_WORKER_EFFECTS)
  const attempt = state.attempts + 1

  return admit(
    {
      status: "ready",
      issued: state.issued,
      attempts: attempt,
      failures: state.failures,
      generationFloor: state.generationFloor,
      watched: undefined,
      requests: new Map(),
      projectLanes: new Map(),
      projections: new Map(),
      highlightLanes: new Map(),
      highlightStreams: new Map(),
    },
    message,
    [{ type: "spawn-worker", attempt }],
  )
}

function requestMessage(event: Requested, id: number): WorkerRequest {
  if (event.type === "parse.requested") return { type: "parse", id, text: event.text }

  if (event.type === "project.requested")
    return { type: "project", id, key: event.key, text: event.text, live: event.live }

  return {
    type: "highlight",
    id,
    key: event.key,
    text: event.text,
    language: event.language,
    complete: event.complete,
  }
}

// Claims the request id, then posts the request or holds it as its key's newest snapshot behind the one in flight.
function admit(
  state: MarkdownWorkerReady,
  message: WorkerRequest,
  spawn: readonly MarkdownWorkerEffect[],
): MarkdownWorkerTransition {
  const requests = new Map(state.requests).set(message.id, message)
  const lane = message.type === "parse" ? undefined : state[laneField(message)].get(message.key)

  if (lane && message.type !== "parse") {
    if (lane.queued !== undefined) requests.delete(lane.queued)

    return {
      state: withLane(
        { ...state, issued: message.id, requests },
        laneField(message),
        new Map(state[laneField(message)]).set(message.key, { active: lane.active, queued: message.id }),
      ),
      effects:
        lane.queued === undefined ? EMPTY_WORKER_EFFECTS : [{ type: "reject", ids: [lane.queued], reason: SUPERSEDED }],
    }
  }

  // A lane's active request is older than its queued one, so the oldest request in flight has always been posted.
  const arm = state.watched === undefined
  const post: MarkdownWorkerEffect = { type: "post", attempt: state.attempts, message }

  const effects = arm
    ? [...spawn, post, { type: "arm-watchdog" as const, attempt: state.attempts, delay: WORKER_HANG_TIMEOUT_MS }]
    : [...spawn, post]

  const next = { ...state, issued: message.id, watched: arm ? message.id : state.watched, requests }

  if (message.type === "parse") return { state: next, effects }
  const field = laneField(message)

  return { state: withLane(next, field, new Map(state[field]).set(message.key, { active: message.id })), effects }
}

function dispose(state: MarkdownWorkerReady, field: LaneField, key: string): MarkdownWorkerTransition {
  const lane = state[field].get(key)
  const stream = field === "highlightLanes" ? state.highlightStreams.get(key) : undefined
  const projection = field === "projectLanes" ? state.projections.get(key) : undefined

  if (!lane && !stream && !projection) return { state, effects: EMPTY_WORKER_EFFECTS }
  const ids = !lane ? [] : lane.queued === undefined ? [lane.active] : [lane.active, lane.queued]
  const post: MarkdownWorkerEffect = { type: "post", attempt: state.attempts, message: { type: "dispose", key } }

  const next = withLane(
    {
      ...state,
      requests: ids.reduce((requests, id) => without(requests, id), state.requests),
      projections: projection ? without(state.projections, key) : state.projections,
      highlightStreams: stream ? without(state.highlightStreams, key) : state.highlightStreams,
      generationFloor: Math.max(state.generationFloor, stream?.generation ?? 0),
    },
    field,
    without(state[field], key),
  )

  return { state: next, effects: ids.length > 0 ? [{ type: "reject", ids, reason: DISPOSED }, post] : [post] }
}

function message(state: MarkdownWorkerReady, response: MarkdownWorkerResponse): MarkdownWorkerTransition {
  const entry = state.requests.get(response.id)

  // The main thread already settled this request: disposed, aborted or superseded.
  if (!entry) return { state, effects: EMPTY_WORKER_EFFECTS }

  if (response.type === "error" || response.type === "superseded") return refused(state, entry, response)

  if (response.type === "parse" && entry.type === "parse")
    return {
      state: { ...state, failures: 0, requests: without(state.requests, entry.id) },
      effects: [{ type: "resolve-parse", id: entry.id, html: response.html }],
    }

  if (response.type === "project" && entry.type === "project") return projected(state, entry, response)

  if (response.type === "highlight" && entry.type === "highlight") return highlighted(state, entry, response)

  return { state, effects: EMPTY_WORKER_EFFECTS }
}

function projected(
  state: MarkdownWorkerReady,
  entry: Extract<WorkerRequest, { type: "project" }>,
  response: Extract<MarkdownWorkerResponse, { type: "project" }>,
): MarkdownWorkerTransition {
  const next = advance(state, entry)
  const previous = state.projections.get(entry.key)

  // The worker diffed against blocks this thread never applied: reset both sides instead of dropping the blocks between.
  if (response.from > (previous?.length ?? 0))
    return {
      state: { ...next.state, projections: without(state.projections, entry.key) },
      effects: [
        { type: "reject", ids: [entry.id], reason: OUT_OF_SYNC },
        { type: "post", attempt: state.attempts, message: { type: "dispose", key: entry.key } },
        ...next.effects,
      ],
    }

  const blocks = applyProjectionBlocks(previous, response.from, response.blocks)

  return {
    state: { ...next.state, projections: new Map(state.projections).set(entry.key, blocks) },
    effects: [{ type: "resolve-project", id: entry.id, projection: { text: entry.text, blocks } }, ...next.effects],
  }
}

function highlighted(
  state: MarkdownWorkerReady,
  entry: Extract<WorkerRequest, { type: "highlight" }>,
  response: Extract<MarkdownWorkerResponse, { type: "highlight" }>,
): MarkdownWorkerTransition {
  const latest = state.highlightLanes.get(entry.key)?.queued ?? entry.id
  const next = advance(state, entry)
  const previous = state.highlightStreams.get(entry.key)

  const value = applyMarkdownWorkerResponse(
    previous ??
      (state.generationFloor > 0
        ? { id: 0, generation: state.generationFloor, language: "", stable: [], unstable: [] }
        : undefined),
    response,
  )

  const resolve: MarkdownWorkerEffect = { type: "resolve-highlight", id: entry.id, value }

  if (shouldReleaseMarkdownWorkerState(entry.complete ?? false, latest, entry.id))
    return {
      state: previous ? { ...next.state, highlightStreams: without(state.highlightStreams, entry.key) } : next.state,
      effects: [resolve, ...next.effects],
    }

  const streams = new Map(state.highlightStreams)
  streams.delete(entry.key)
  streams.set(entry.key, value)
  const lanes = next.state.highlightLanes
  // Only a stream with nothing in flight is evicted, so a visible block never loses a pending highlight.
  const evicted = streams.size > HIGHLIGHT_STREAM_LIMIT ? [...streams.keys()].find((key) => !lanes.has(key)) : undefined
  const dropped = evicted === undefined ? undefined : streams.get(evicted)

  if (evicted === undefined || !dropped)
    return { state: { ...next.state, highlightStreams: streams }, effects: [resolve, ...next.effects] }
  streams.delete(evicted)

  return {
    state: {
      ...next.state,
      highlightStreams: streams,
      generationFloor: Math.max(state.generationFloor, dropped.generation),
    },
    effects: [
      resolve,
      { type: "post", attempt: state.attempts, message: { type: "dispose", key: evicted } },
      ...next.effects,
    ],
  }
}

// The worker refused a request. An error also forgets the key's cached base on both sides, so the next request starts
// again from nothing instead of building on a reply this thread never applied.
function refused(
  state: MarkdownWorkerReady,
  entry: WorkerRequest,
  response: Extract<MarkdownWorkerResponse, { type: "error" | "superseded" }>,
): MarkdownWorkerTransition {
  const reason: WorkerRejectReason =
    response.type === "superseded" ? SUPERSEDED : { kind: "error", message: response.message }

  const reject: MarkdownWorkerEffect = { type: "reject", ids: [entry.id], reason }

  if (entry.type === "parse")
    return { state: { ...state, failures: 0, requests: without(state.requests, entry.id) }, effects: [reject] }
  const next = advance(state, entry)

  if (response.type === "superseded") return { state: next.state, effects: [reject, ...next.effects] }
  const stream = entry.type === "highlight" ? state.highlightStreams.get(entry.key) : undefined

  return {
    state: {
      ...next.state,
      projections: entry.type === "project" ? without(state.projections, entry.key) : state.projections,
      highlightStreams:
        entry.type === "highlight" ? without(state.highlightStreams, entry.key) : state.highlightStreams,
      generationFloor: Math.max(state.generationFloor, stream?.generation ?? 0),
    },
    effects: [
      reject,
      { type: "post", attempt: state.attempts, message: { type: "dispose", key: entry.key } },
      ...next.effects,
    ],
  }
}

// Settles a key's active request and posts its queued snapshot, if any.
function advance(state: MarkdownWorkerReady, entry: KeyedRequest) {
  const field = laneField(entry)
  const lane = state[field].get(entry.key)
  const queued = lane?.active === entry.id ? lane.queued : undefined
  const promoted = queued === undefined ? undefined : state.requests.get(queued)

  const lanes =
    lane?.active !== entry.id
      ? state[field]
      : queued === undefined
        ? without(state[field], entry.key)
        : new Map(state[field]).set(entry.key, { active: queued })

  const effects: readonly MarkdownWorkerEffect[] = promoted
    ? [{ type: "post", attempt: state.attempts, message: promoted }]
    : EMPTY_WORKER_EFFECTS

  return {
    state: withLane({ ...state, failures: 0, requests: without(state.requests, entry.id) }, field, lanes),
    effects,
  }
}

function fail(state: MarkdownWorkerReady, reason: WorkerFailure): MarkdownWorkerTransition {
  const failures = state.failures + 1
  const ids = [...state.requests.keys()]

  const retry: MarkdownWorkerEffect = {
    type: "schedule-retry",
    attempt: state.attempts,
    delay: Math.min(WORKER_RETRY_DELAY_MS * 2 ** (failures - 1), WORKER_RETRY_MAX_DELAY_MS),
  }

  const close: MarkdownWorkerEffect = { type: "close-worker", attempt: state.attempts }

  return {
    state: {
      status: "failed",
      issued: state.issued,
      attempts: state.attempts,
      failures,
      generationFloor: [...state.highlightStreams.values()].reduce(
        (floor, stream) => Math.max(floor, stream.generation),
        state.generationFloor,
      ),
      message: reason.message,
    },
    effects: ids.length > 0 ? [close, { type: "reject", ids, reason }, retry] : [close, retry],
  }
}

function laneField(request: KeyedRequest): LaneField {
  return request.type === "project" ? "projectLanes" : "highlightLanes"
}

function withLane(
  state: MarkdownWorkerReady,
  field: LaneField,
  lanes: ReadonlyMap<string, WorkerLane>,
): MarkdownWorkerReady {
  if (state[field] === lanes) return state

  if (field === "projectLanes") return { ...state, projectLanes: lanes }

  return { ...state, highlightLanes: lanes }
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)

  return next
}
