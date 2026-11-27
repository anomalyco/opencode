// A GPU queue's watchdog (widgets-gpu.md, GPU hang). Submits finish in order, so only the oldest unfinished one is
// timed, from its submit or, if later, from when the one before it finished: still unfinished `GPU_HANG_MS` after
// that, it hangs and its `hang` runs; work queued behind it isn't blamed. Work that finishes while the device is
// current tells its run; at a device loss, each run with work still unfinished is told (`Strikes` decides the strike). Nothing waits on the GPU: one `onSubmittedWorkDone` per submit and one
// timer for the oldest. (Chromium settles `device.lost` before the work pending at the loss: unfinished work is seen.)

import { STRIKE_MS } from "./gpu-checks.js"
import { GPU_HANG_MS } from "./protocol.js"

/** The run a submit is for (the same object each time): its work finished, or was unfinished at a loss (once a loss). */
export interface Run {
  finished(): void
  strike(): void
}

interface Submit {
  hang: () => void
  run: Run
  start: number
  done: boolean
  hung: boolean
}

/** What the watchdog needs of a queue. */
export interface WorkQueue {
  onSubmittedWorkDone(): Promise<undefined>
}

export class Watchdog {
  private readonly submits: Submit[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private gone = false

  constructor(
    private readonly queue: WorkQueue,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /**
   * Work was just submitted for `run`: `hang` runs if it hangs; `run` hears when it finishes on this device, or that it
   * was unfinished when the device was lost. Resolves (or rejects) when the work is done.
   */
  submitted(hang: () => void, run: Run): Promise<undefined> {
    const submit: Submit = { hang, run, start: this.now(), done: false, hung: false }
    this.submits.push(submit)
    if (this.submits.length === 1) this.arm()
    const done = this.queue.onSubmittedWorkDone()
    const finish = () => {
      submit.done = true
      // Settled by the loss (after it): not work finished on the current device.
      if (this.gone) return
      run.finished()
      this.settle()
    }
    done.then(finish, finish)
    return done
  }

  /** The device was lost: each run with work unfinished is told, once; then none is left. */
  lost() {
    const runs = new Set(this.submits.filter((submit) => !submit.done).map((submit) => submit.run))
    this.stop()
    for (const run of runs) run.strike()
  }

  /** No more timing (the device or the widget is gone). */
  stop() {
    this.gone = true
    clearTimeout(this.timer)
    this.submits.length = 0
  }

  // The finished submits at the front go; the next one's clock starts when the one before it finished.
  private settle() {
    if (this.gone || !this.submits[0]?.done) return
    while (this.submits[0]?.done) this.submits.shift()
    const oldest = this.submits[0]
    if (oldest) oldest.start = Math.max(oldest.start, this.now())
    this.arm()
  }

  private arm() {
    clearTimeout(this.timer)
    const oldest = this.submits[0]
    if (!oldest || oldest.hung) return
    this.timer = setTimeout(
      () => {
        if (this.submits[0] === oldest && !oldest.done && !oldest.hung) this.blame(oldest)
      },
      Math.max(0, oldest.start + GPU_HANG_MS - this.now()),
    )
  }

  private blame(submit: Submit) {
    submit.hung = true
    submit.hang()
  }
}

/**
 * A run's strikes at device losses (widgets-gpu.md, Strikes). A loss with the run's work in flight is a strike only if
 * its work finished on a device since its last strike (or its start): losses in a row with none finished between are
 * one reset, one strike.
 */
export class Strikes {
  private last: number | undefined
  private finished = false

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** The run's GPU work finished on a device. */
  done() {
    this.finished = true
  }

  /** A loss with the run's work in flight: true when it is a strike, the second within `STRIKE_MS` (the run stops). */
  strike(): boolean {
    if (!this.finished) return false
    this.finished = false
    const now = this.now()
    const second = this.last !== undefined && now - this.last <= STRIKE_MS
    this.last = now
    return second
  }
}
