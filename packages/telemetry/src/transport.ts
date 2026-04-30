import type { PlausibleEvent } from "./types.ts"

/**
 * Tiny telemetry transport.
 *
 * Behavior summary (matches design §6 + §8 + risk R-7):
 *  - Buffer events in memory.
 *  - Flush when EITHER (a) buffer reaches `maxBufferSize` (20)
 *                     OR (b) `flushIntervalMs` (5 min) has elapsed since last flush
 *                     OR (c) `flush()` is called explicitly.
 *  - Each POST has a 5-second timeout.
 *  - Up to 3 retries with exponential backoff (1s, 2s, 4s).
 *  - **Never** throws out of `enqueue` / `flush`. Telemetry must not break the host.
 *  - When `enabled=false`, all methods short-circuit.
 *
 * Note: Plausible's `/api/event` handles one event per request. We don't batch
 * into one request — instead "buffer" means we hold them in memory and emit
 * them in a tight loop on flush. The 20-event threshold is mostly a safety net
 * for shells that exit quickly without calling `flush()`.
 */

export interface TransportOptions {
  endpoint: string
  enabled: boolean
  /** Default user agent; transport will set this header on every request. */
  userAgent: string
  /** Custom props attached to every event (e.g. `version`, `install_id`). */
  baseProps: Record<string, string | number | boolean>
  /** Bun / Node fetch implementation. Injectable for tests. */
  fetchImpl?: typeof fetch
  /** Max events held in buffer before auto-flushing. Default 20. */
  maxBufferSize?: number
  /** Auto-flush interval in milliseconds. Default 5 * 60 * 1000. */
  flushIntervalMs?: number
  /** Per-request timeout in ms. Default 5000. */
  requestTimeoutMs?: number
  /** Max retry attempts. Default 3. */
  maxRetries?: number
  /** Initial backoff delay in ms. Default 1000 (then doubles each retry). */
  initialBackoffMs?: number
  /** Optional callback for tests / observability — fires on every send result. */
  onSendResult?: (ok: boolean, event: PlausibleEvent, attempts: number) => void
}

interface QueuedEvent {
  event: PlausibleEvent
}

export class Transport {
  private readonly endpoint: string
  private readonly enabled: boolean
  private readonly userAgent: string
  private readonly baseProps: Record<string, string | number | boolean>
  private readonly fetchImpl: typeof fetch
  private readonly maxBufferSize: number
  private readonly flushIntervalMs: number
  private readonly requestTimeoutMs: number
  private readonly maxRetries: number
  private readonly initialBackoffMs: number
  private readonly onSendResult: TransportOptions["onSendResult"]

  private buffer: QueuedEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  // We coalesce concurrent flush() calls onto a single in-flight promise
  // so that callers can `await flush()` safely.
  private flushInFlight: Promise<void> | null = null

  constructor(opts: TransportOptions) {
    this.endpoint = opts.endpoint
    this.enabled = opts.enabled
    this.userAgent = opts.userAgent
    this.baseProps = opts.baseProps
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch
    this.maxBufferSize = opts.maxBufferSize ?? 20
    this.flushIntervalMs = opts.flushIntervalMs ?? 5 * 60 * 1000
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 5_000
    this.maxRetries = opts.maxRetries ?? 3
    this.initialBackoffMs = opts.initialBackoffMs ?? 1_000
    this.onSendResult = opts.onSendResult
  }

  /** Add an event to the buffer. Triggers an auto-flush if the size threshold is hit. */
  enqueue(event: PlausibleEvent): void {
    if (!this.enabled) return
    this.buffer.push({ event })

    // Reach size threshold → flush immediately (fire and forget; we don't await).
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush()
      return
    }

    // Else, ensure the time-based flush timer is armed.
    this.armTimer()
  }

  /**
   * Drain the buffer. Resolves when all currently-queued events have been
   * sent (or have exhausted their retries). Never throws.
   */
  flush(): Promise<void> {
    if (!this.enabled) return Promise.resolve()
    if (this.flushInFlight) return this.flushInFlight

    this.cancelTimer()

    const pending = this.buffer
    this.buffer = []
    if (pending.length === 0) return Promise.resolve()

    const p = (async () => {
      // Send each event independently — Plausible API is per-event.
      // We don't run them in parallel because we don't want to spike the
      // remote endpoint or our own connection pool.
      for (const item of pending) {
        await this.sendOne(item.event)
      }
    })()
      .catch(() => {
        // sendOne already swallows; this is a safety net for any unexpected throw.
      })
      .finally(() => {
        this.flushInFlight = null
      })

    this.flushInFlight = p
    return p
  }

  /** Cancel the auto-flush timer (used by callers that are about to exit). */
  cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Returns the number of buffered (unsent) events. Used by tests. */
  bufferSize(): number {
    return this.buffer.length
  }

  // ---------- internals ----------

  private armTimer(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.flushIntervalMs)
    // Don't keep the event loop alive just to flush telemetry —
    // matters for short-lived CLI processes.
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      ;(this.timer as { unref: () => void }).unref()
    }
  }

  private async sendOne(event: PlausibleEvent): Promise<void> {
    const body = JSON.stringify({
      name: event.name,
      url: event.url,
      domain: event.domain,
      props: { ...this.baseProps, ...event.props },
    })

    let attempts = 0
    let delay = this.initialBackoffMs
    while (attempts < this.maxRetries) {
      attempts++
      const ok = await this.singleAttempt(body)
      if (ok) {
        this.onSendResult?.(true, event, attempts)
        return
      }
      if (attempts >= this.maxRetries) break
      await sleep(delay)
      delay *= 2
    }
    // All retries exhausted — fire-and-forget means we just report and move on.
    this.onSendResult?.(false, event, attempts)
  }

  private async singleAttempt(body: string): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": this.userAgent,
        },
        body,
        signal: controller.signal,
      })
      // Plausible returns 202 on accepted events. Treat 2xx as success.
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}

function sleep(ms: number): Promise<void> {
  // We deliberately do *not* call .unref() on this timer: the awaiter is
  // suspended waiting on this promise, and on some Bun/Windows builds an
  // unref'd timer can prevent the event loop from advancing here.
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
