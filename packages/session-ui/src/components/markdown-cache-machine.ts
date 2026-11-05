export type MarkdownCacheEntry = {
  raw: string
  src?: string
  hash: string
  html: string
}

export type RunningParseJob = {
  readonly jobId: number
  readonly raw: string
  readonly src: string
  /** Consumers waiting on this parse; never empty while the job runs. */
  readonly consumers: readonly number[]
}

export type RunningKeyState = {
  /** The source this key last asked for. Only a job for it may fill the cache; older jobs still settle their consumers. */
  readonly targetSrc: string
  readonly jobs: readonly RunningParseJob[]
}

type Counters = {
  readonly issuedJobs: number
  readonly issuedConsumers: number
}

/**
 * Worker parses shared by every consumer that asks for the same key and source. The completed-entry LRU stays a plain
 * map in the driver: it is data, not a phase, and copying 200 entries on every touch would cost the streaming path.
 */
export type MarkdownCacheState =
  | (Counters & { readonly status: "idle" })
  | (Counters & {
      readonly status: "running"
      readonly keys: ReadonlyMap<string, RunningKeyState>
      readonly jobKeys: ReadonlyMap<number, string>
      readonly consumerJobs: ReadonlyMap<number, number>
    })

export type MarkdownCacheEvent =
  /** A cached or freshly parsed entry for `key` now shows `src`. */
  | { readonly type: "cache.touched"; readonly key: string; readonly src: string }
  /** A consumer missed the cache; it takes the next consumer id. */
  | { readonly type: "render.requested"; readonly key: string; readonly raw: string; readonly src: string }
  | { readonly type: "consumer.aborted"; readonly consumerId: number }
  | { readonly type: "parse.succeeded"; readonly jobId: number; readonly entry: MarkdownCacheEntry }
  | { readonly type: "parse.failed"; readonly jobId: number; readonly error: unknown }

export type MarkdownCacheRejectReason = { readonly kind: "disposed" } | { readonly kind: "error"; readonly error: unknown }

export type MarkdownCacheEffect =
  | { readonly type: "start-parse"; readonly jobId: number; readonly raw: string; readonly src: string }
  | { readonly type: "abort-parse"; readonly jobId: number }
  | { readonly type: "store"; readonly key: string; readonly entry: MarkdownCacheEntry }
  | { readonly type: "resolve-consumers"; readonly consumerIds: readonly number[]; readonly entry: MarkdownCacheEntry }
  | {
      readonly type: "reject-consumers"
      readonly consumerIds: readonly number[]
      readonly reason: MarkdownCacheRejectReason
    }

export type MarkdownCacheTransition = {
  readonly state: MarkdownCacheState
  readonly effects: readonly MarkdownCacheEffect[]
}

type Running = Extract<MarkdownCacheState, { status: "running" }>

export const INITIAL_MARKDOWN_CACHE_STATE: MarkdownCacheState = Object.freeze({
  status: "idle",
  issuedJobs: 0,
  issuedConsumers: 0,
})

const NO_EFFECTS: readonly MarkdownCacheEffect[] = Object.freeze([])

const DISPOSED: MarkdownCacheRejectReason = Object.freeze({ kind: "disposed" })

const EMPTY = new Map<never, never>()

export function transitionMarkdownCache(state: MarkdownCacheState, event: MarkdownCacheEvent): MarkdownCacheTransition {
  if (event.type === "render.requested") return render(state, event)

  if (state.status === "idle") return { state, effects: NO_EFFECTS }

  if (event.type === "cache.touched") {
    const keyState = state.keys.get(event.key)

    // Running jobs stay joinable; only the source that may fill the cache moves.
    if (!keyState || keyState.targetSrc === event.src) return { state, effects: NO_EFFECTS }

    return {
      state: { ...state, keys: put(state.keys, event.key, { targetSrc: event.src, jobs: keyState.jobs }) },
      effects: NO_EFFECTS,
    }
  }

  if (event.type === "consumer.aborted") return abort(state, event.consumerId)

  return settle(state, event)
}

function render(
  state: MarkdownCacheState,
  event: Extract<MarkdownCacheEvent, { type: "render.requested" }>,
): MarkdownCacheTransition {
  const consumerId = state.issuedConsumers + 1
  const running = state.status === "running" ? state : undefined
  const keyState = running?.keys.get(event.key)
  const keys = running?.keys ?? EMPTY
  const jobKeys = running?.jobKeys ?? EMPTY
  const consumerJobs = running?.consumerJobs ?? EMPTY
  const shared = keyState?.jobs.find((job) => job.src === event.src)

  if (keyState && shared) {
    const joined = { ...shared, consumers: [...shared.consumers, consumerId] }

    return {
      state: {
        status: "running",
        issuedJobs: state.issuedJobs,
        issuedConsumers: consumerId,
        keys: put(keys, event.key, {
          targetSrc: event.src,
          jobs: keyState.jobs.map((job) => (job === shared ? joined : job)),
        }),
        jobKeys,
        consumerJobs: put(consumerJobs, consumerId, shared.jobId),
      },
      effects: NO_EFFECTS,
    }
  }

  const jobId = state.issuedJobs + 1
  const job = { jobId, raw: event.raw, src: event.src, consumers: [consumerId] }

  return {
    state: {
      status: "running",
      issuedJobs: jobId,
      issuedConsumers: consumerId,
      keys: put(keys, event.key, { targetSrc: event.src, jobs: [...(keyState?.jobs ?? []), job] }),
      jobKeys: put(jobKeys, jobId, event.key),
      consumerJobs: put(consumerJobs, consumerId, jobId),
    },
    effects: [{ type: "start-parse", jobId, raw: event.raw, src: event.src }],
  }
}

function abort(state: Running, consumerId: number): MarkdownCacheTransition {
  const jobId = state.consumerJobs.get(consumerId)
  const found = jobId === undefined ? undefined : find(state, jobId)

  if (!found) return { state, effects: NO_EFFECTS }

  const consumerJobs = without(state.consumerJobs, consumerId)
  const reject: MarkdownCacheEffect = { type: "reject-consumers", consumerIds: [consumerId], reason: DISPOSED }

  // A disposed consumer must not cancel another consumer's shared parse.
  if (found.job.consumers.length > 1) {
    const kept = { ...found.job, consumers: found.job.consumers.filter((id) => id !== consumerId) }

    return {
      state: {
        ...state,
        keys: put(state.keys, found.key, {
          targetSrc: found.keyState.targetSrc,
          jobs: found.keyState.jobs.map((job) => (job === found.job ? kept : job)),
        }),
        consumerJobs,
      },
      effects: [reject],
    }
  }

  return {
    state: remove(state, found, consumerJobs),
    effects: [{ type: "abort-parse", jobId: found.job.jobId }, reject],
  }
}

function settle(
  state: Running,
  event: Extract<MarkdownCacheEvent, { type: "parse.succeeded" | "parse.failed" }>,
): MarkdownCacheTransition {
  const found = find(state, event.jobId)

  if (!found) return { state, effects: NO_EFFECTS }

  const consumerIds = found.job.consumers
  const next = remove(
    state,
    found,
    consumerIds.reduce((map, id) => without(map, id), state.consumerJobs),
  )

  if (event.type === "parse.failed")
    return { state: next, effects: [{ type: "reject-consumers", consumerIds, reason: { kind: "error", error: event.error } }] }

  const resolve: MarkdownCacheEffect = { type: "resolve-consumers", consumerIds, entry: event.entry }

  if (found.keyState.targetSrc !== found.job.src || !event.entry.hash) return { state: next, effects: [resolve] }

  return { state: next, effects: [{ type: "store", key: found.key, entry: event.entry }, resolve] }
}

function find(state: Running, jobId: number) {
  const key = state.jobKeys.get(jobId)
  const keyState = key === undefined ? undefined : state.keys.get(key)
  const job = keyState?.jobs.find((item) => item.jobId === jobId)

  if (key === undefined || !keyState || !job) return

  return { key, keyState, job }
}

function remove(
  state: Running,
  found: { key: string; keyState: RunningKeyState; job: RunningParseJob },
  consumerJobs: ReadonlyMap<number, number>,
): MarkdownCacheState {
  const jobs = found.keyState.jobs.filter((job) => job !== found.job)
  const keys = jobs.length
    ? put(state.keys, found.key, { targetSrc: found.keyState.targetSrc, jobs })
    : without(state.keys, found.key)

  if (keys.size === 0) return { status: "idle", issuedJobs: state.issuedJobs, issuedConsumers: state.issuedConsumers }

  return { ...state, keys, jobKeys: without(state.jobKeys, found.job.jobId), consumerJobs }
}

function put<K, V>(map: ReadonlyMap<K, V>, key: K, value: V) {
  const next = new Map(map)
  next.set(key, value)

  return next
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K) {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)

  return next
}
