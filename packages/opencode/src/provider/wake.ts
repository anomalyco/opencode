// Detect resume from system sleep/suspend and abort stale in-flight network
// reads so the retry policy reconnects immediately, instead of waiting for the
// per-chunk idle timeout (see DEFAULT_CHUNK_TIMEOUT_MS).
//
// During suspend the monotonic clock (and the event loop) is frozen, so a timer
// scheduled for POLL_MS that fires after a much larger wall-clock gap means the
// machine slept. Sockets opened before the sleep are stale on wake; aborting
// them surfaces a retryable network error and the existing retry reconnects.

const POLL_MS = 10_000
const GAP_MS = 30_000

const active = new Set<AbortController>()
let timer: ReturnType<typeof setInterval> | undefined
let last = Date.now()

function ensureWatcher() {
  if (timer) return
  last = Date.now()
  timer = setInterval(() => {
    const now = Date.now()
    const drift = now - last - POLL_MS
    last = now
    if (drift > GAP_MS) handleWake()
  }, POLL_MS)
  timer.unref?.()
}

// Register an in-flight stream's abort controller. Returns an unregister fn to
// call when the stream ends.
export function register(ctl: AbortController) {
  active.add(ctl)
  ensureWatcher()
  return () => active.delete(ctl)
}

// Abort every in-flight stream with a retryable network reason. Invoked by the
// watcher on detected wake; exported for tests.
export function handleWake() {
  const err = new Error("connection reset (resumed from sleep)")
  for (const ctl of active) ctl.abort(err)
  active.clear()
}

export function size() {
  return active.size
}

export * as WakeWatch from "./wake"
