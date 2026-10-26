import type { Info } from "./service.js"
import { same } from "./service-probe.js"
import type { EnsureTiming } from "./service-timing.js"

type Sample = {
  readonly now: number
  readonly info: Info | undefined
  readonly timedOut: boolean
  readonly stalled: boolean
  readonly alive: boolean
}

/** Decide when a live owner has been silent long enough to abandon its registration. */
export function recoveryPolicy(timing: EnsureTiming) {
  let since: number | undefined
  let owner: Info | undefined
  return {
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
    replaced() {
      since = undefined
      owner = undefined
    },
  }
}
