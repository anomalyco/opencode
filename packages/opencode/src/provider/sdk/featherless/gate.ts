import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "featherless.gate" })

const DEFAULT_BASE_URL = "https://api.featherless.ai"
const DEFAULT_RECONNECT_INITIAL_MS = 200
const DEFAULT_RECONNECT_MAX_MS = 5_000
const DEFAULT_RECONNECT_FACTOR = 2

export interface ConcurrencyEvent {
  /** Sum of in-flight request costs reported by the server. */
  used_cost: number
  /** Per-account concurrency budget. `null` means unlimited (admit everything). */
  limit: number | null
}

export type EventSink = (event: ConcurrencyEvent) => void

export interface FeedHandle {
  stop(): void | Promise<void>
}

export type FeedFactory = (sink: EventSink) => FeedHandle | Promise<FeedHandle>

export interface FeatherlessGateOptions {
  /** Pre-built feed for tests. If omitted, `apiKey` must be set so the gate can build a live SSE feed. */
  feed?: FeedFactory
  /** API key used by the live SSE feed when `feed` is not provided. */
  apiKey?: string
  /** Override the base URL. Defaults to `https://api.featherless.ai`. */
  baseURL?: string
  /** Reconnect backoff for the live SSE feed. */
  reconnect?: {
    initialMs?: number
    maxMs?: number
    factor?: number
  }
}

interface Waiter {
  cost: number
  resolve: (release: () => void) => void
  reject: (err: Error) => void
}

/**
 * Admission gate for Featherless requests. Tracks the server-reported
 * `used_cost`/`limit` via an SSE feed, plus a local pending map for
 * requests that haven't yet appeared in the SSE feed (~2 s lag).
 *
 * Admission predicate:
 *     remote.used_cost + Σ(local pending) + new_cost ≤ remote.limit
 *
 * The local sum may briefly double-count our own requests once SSE
 * catches up. That under-admits for a 2-second window — strictly safer
 * than the alternative of risking 429s.
 */
export class FeatherlessGate {
  private remote = { used_cost: 0, limit: Number.POSITIVE_INFINITY }
  private readonly pending = new Map<symbol, number>()
  private readonly waiters: Waiter[] = []
  private feedHandle: FeedHandle | undefined
  private started = false
  private stopped = false

  constructor(private readonly opts: FeatherlessGateOptions = {}) {}

  /** Start the SSE feed (or the injected fake). Idempotent. */
  async start(): Promise<void> {
    if (this.started || this.stopped) return
    this.started = true
    // For the live path, seed state from /account/concurrency BEFORE
    // accepting any admissions. Without this the gate is blind for the
    // first ~2s (until SSE lands) and over-admits, producing exactly the
    // 429s it was supposed to prevent.
    if (!this.opts.feed) {
      const snap = await this.fetchSnapshot()
      if (snap) this.onEvent(snap)
    }
    const factory = this.opts.feed ?? this.buildLiveFeed()
    this.feedHandle = await factory((ev) => this.onEvent(ev))
  }

  private async fetchSnapshot(): Promise<ConcurrencyEvent | undefined> {
    if (!this.opts.apiKey) return undefined
    const baseURL = (this.opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    try {
      const res = await fetch(`${baseURL}/account/concurrency`, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      })
      if (!res.ok) {
        log.warn("snapshot fetch failed, gate starts blind", { status: res.status })
        return undefined
      }
      const json = (await res.json()) as { used_cost?: number; limit?: number | null }
      return {
        used_cost: typeof json.used_cost === "number" ? json.used_cost : 0,
        limit: json.limit === null || json.limit === undefined ? null : Number(json.limit),
      }
    } catch (err) {
      log.warn("snapshot fetch threw, gate starts blind", { error: String(err) })
      return undefined
    }
  }

  /** Tear down. Pending waiters are rejected. Idempotent. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    try {
      await this.feedHandle?.stop()
    } catch (err) {
      log.warn("feed stop failed", { error: String(err) })
    }
    const pendingWaiters = this.waiters.splice(0)
    for (const w of pendingWaiters) w.reject(new Error("FeatherlessGate stopped"))
  }

  /**
   * Reserve `cost` units of concurrency. Resolves with a `release()` fn the
   * caller MUST invoke once the corresponding request has fully completed
   * (stream closed, not just response headers received). `release()` is
   * idempotent.
   */
  acquire(cost: number): Promise<() => void> {
    if (cost <= 0) return Promise.reject(new Error("cost must be a positive integer"))
    if (this.stopped) return Promise.reject(new Error("FeatherlessGate stopped"))
    // FIFO: if anyone is already queued, the new request must queue too —
    // even if it would fit. Otherwise a stream of cheap requests could
    // starve a queued expensive one.
    if (this.waiters.length === 0 && this.canAdmit(cost)) return Promise.resolve(this.reserve(cost))
    return new Promise<() => void>((resolve, reject) => {
      this.waiters.push({ cost, resolve, reject })
    })
  }

  /** Cost of currently-reserved local requests. */
  pendingCost(): number {
    let total = 0
    for (const c of this.pending.values()) total += c
    return total
  }

  /** Number of waiters queued behind the admission gate. */
  queuedCount(): number {
    return this.waiters.length
  }

  /** Latest known server-reported state. Useful for diagnostics/UI. */
  snapshot(): { remote_used_cost: number; remote_limit: number | null; pending_cost: number; queued: number } {
    return {
      remote_used_cost: this.remote.used_cost,
      remote_limit: Number.isFinite(this.remote.limit) ? this.remote.limit : null,
      pending_cost: this.pendingCost(),
      queued: this.waiters.length,
    }
  }

  private canAdmit(cost: number): boolean {
    if (!Number.isFinite(this.remote.limit)) return true // unlimited plan
    return this.remote.used_cost + this.pendingCost() + cost <= this.remote.limit
  }

  private reserve(cost: number): () => void {
    const token = Symbol("featherless.pending")
    this.pending.set(token, cost)
    let released = false
    return () => {
      if (released) return
      released = true
      this.pending.delete(token)
      this.drain()
    }
  }

  private drain(): void {
    // Strict head-of-line: a high-cost waiter at the front blocks cheaper
    // waiters behind it. Prevents starvation of expensive requests.
    while (this.waiters.length > 0 && this.canAdmit(this.waiters[0].cost)) {
      const w = this.waiters.shift()!
      w.resolve(this.reserve(w.cost))
    }
  }

  private onEvent(ev: ConcurrencyEvent): void {
    if (this.stopped) return
    if (typeof ev.used_cost === "number") this.remote.used_cost = ev.used_cost
    this.remote.limit = ev.limit === null || ev.limit === undefined ? Number.POSITIVE_INFINITY : Number(ev.limit)
    this.drain()
  }

  private buildLiveFeed(): FeedFactory {
    if (!this.opts.apiKey) {
      throw new Error("FeatherlessGate: provide either `feed` (for tests) or `apiKey` (for live SSE)")
    }
    const apiKey = this.opts.apiKey
    const baseURL = (this.opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    const reconnect = {
      initialMs: this.opts.reconnect?.initialMs ?? DEFAULT_RECONNECT_INITIAL_MS,
      maxMs: this.opts.reconnect?.maxMs ?? DEFAULT_RECONNECT_MAX_MS,
      factor: this.opts.reconnect?.factor ?? DEFAULT_RECONNECT_FACTOR,
    }

    return (sink) => {
      const abort = new AbortController()
      let cancelled = false

      const loop = async () => {
        let backoff = reconnect.initialMs
        while (!cancelled) {
          try {
            const res = await fetch(`${baseURL}/account/concurrency/stream`, {
              headers: { Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" },
              signal: abort.signal,
            })
            if (!res.ok || !res.body) {
              throw new Error(`SSE connect failed: ${res.status}`)
            }
            backoff = reconnect.initialMs
            const reader = res.body.getReader()
            const dec = new TextDecoder()
            let buf = ""
            while (!cancelled) {
              const { value, done } = await reader.read()
              if (done) break
              buf += dec.decode(value, { stream: true })
              let idx: number
              while ((idx = buf.indexOf("\n\n")) !== -1) {
                const block = buf.slice(0, idx)
                buf = buf.slice(idx + 2)
                for (const line of block.split("\n")) {
                  if (!line.startsWith("data:")) continue
                  const raw = line.slice(5).trim()
                  if (!raw) continue
                  try {
                    const parsed = JSON.parse(raw)
                    sink({
                      used_cost: typeof parsed.used_cost === "number" ? parsed.used_cost : 0,
                      limit:
                        parsed.limit === null || parsed.limit === undefined ? null : Number(parsed.limit),
                    })
                  } catch (err) {
                    log.warn("bad SSE payload", { error: String(err) })
                  }
                }
              }
            }
          } catch (err) {
            if (cancelled) return
            log.warn("SSE feed error, will reconnect", { error: String(err), backoffMs: backoff })
          }
          if (cancelled) return
          await sleep(backoff, abort.signal)
          backoff = Math.min(backoff * reconnect.factor, reconnect.maxMs)
        }
      }

      void loop()

      return {
        stop() {
          cancelled = true
          abort.abort()
        },
      }
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
