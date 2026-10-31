import type { Info } from "./service.js"
import { same } from "./service-probe.js"
import type { EnsureTiming } from "./service-timing.js"

/**
 * What one `ensure()` poll learned about the registered service. The caller owns the probe and the
 * process check; this module only decides when that evidence justifies replacing the service.
 */
export type Sample = {
  /** Monotonic timestamp (`performance.now()`): a wall-clock jump on resume must not close the window. */
  readonly now: number
  readonly info: Info | undefined
  readonly timedOut: boolean
  /** The deadline passed while nothing was running, so it is not evidence about the service. */
  readonly stalled: boolean
  /** The registered process still exists. */
  readonly alive: boolean
}

/**
 * Replace a live but silent service only after a continuous window of unanswered probes. A stalled
 * sample restarts the window, because the client rather than the service was suspended. A process
 * that is gone is not handled here: its registration no longer holds the port, so a contender
 * replaces it instead of waiting out a window that can never close.
 */
export function recoveryPolicy(timing: EnsureTiming) {
  let since: number | undefined
  let owner: Info | undefined
  return {
    /** Whether this sample completes the unresponsive window for the current owner. */
    observe(sample: Sample) {
      if (!sample.timedOut || sample.stalled || !sample.alive || sample.info === undefined) {
        since = undefined
        owner = undefined
        return false
      }
      if (since === undefined || owner === undefined || !same(owner, sample.info)) {
        since = sample.now
        owner = sample.info
        return false
      }
      return sample.now - since >= timing.unresponsiveAfter
    },
    /** The caller replaced the service, so the next owner starts a fresh window. */
    replaced() {
      since = undefined
      owner = undefined
    },
  }
}
