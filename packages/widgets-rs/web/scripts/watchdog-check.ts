#!/usr/bin/env bun
// The GPU hang watchdog (src/watchdog.ts; widgets-gpu.md, GPU hang) on a queue whose work finishes when a check says
// so, in order as a GPU's does, and strikes on a clock the check sets: no GPU, no timing margins beyond the 250 ms rule.
//
//   bun scripts/watchdog-check.ts

import { Strikes, Watchdog } from "../src/watchdog.ts"
import { STRIKE_MS } from "../src/gpu-checks.ts"
import { GPU_HANG_MS } from "../src/protocol.ts"

/** A queue whose submits finish when `finish()` is called, oldest first. */
function queue() {
  const waiting: Array<() => void> = []
  return {
    onSubmittedWorkDone: () => new Promise<undefined>((r) => waiting.push(() => r(undefined))),
    finish: () => waiting.shift()?.(),
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const none = { finished: () => {}, strike: () => {} }

let failed = 0
const check = (ok: boolean, name: string, detail?: unknown) => {
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`)
}

{
  // Work done in time: nothing hangs.
  const q = queue()
  const dog = new Watchdog(q)
  const hung: string[] = []
  dog.submitted(() => hung.push("a"), none)
  await sleep(GPU_HANG_MS / 2)
  q.finish()
  await sleep(GPU_HANG_MS)
  check(hung.length === 0, "work done within 250 ms doesn't hang", hung)
  dog.stop()
}
{
  // The oldest hangs; the work queued behind it isn't blamed, though it too is unfinished 250 ms after its submit.
  const q = queue()
  const dog = new Watchdog(q)
  const hung: string[] = []
  dog.submitted(() => hung.push("a"), none)
  await sleep(20)
  dog.submitted(() => hung.push("b"), none)
  await sleep(GPU_HANG_MS + 150)
  check(hung.join() === "a", "the oldest unfinished submit hangs; work queued behind it isn't blamed", hung)
  dog.stop()
}
{
  // A submit is timed from when the one before it finished: b, queued behind a slow a, has its own 250 ms.
  const q = queue()
  const dog = new Watchdog(q)
  const hung: string[] = []
  dog.submitted(() => hung.push("a"), none)
  dog.submitted(() => hung.push("b"), none)
  await sleep(GPU_HANG_MS - 50)
  q.finish()
  await sleep(150)
  check(hung.length === 0, "the next submit's clock starts when the one before it finished (not at its submit)", hung)
  await sleep(GPU_HANG_MS)
  check(hung.join() === "b", "it hangs 250 ms after that", hung)
  dog.stop()
}
{
  // At a loss: each run with work unfinished is told once, however many of its submits were; one whose work finished
  // isn't; nothing is timed after; and work settled by the loss isn't work finished on the device.
  const q = queue()
  const dog = new Watchdog(q)
  const told: string[] = []
  const hung: string[] = []
  const run = { finished: () => told.push("run finished"), strike: () => told.push("run struck") }
  const done = { finished: () => told.push("done finished"), strike: () => told.push("done struck") }
  dog.submitted(() => hung.push("done"), done)
  dog.submitted(() => hung.push("run"), run)
  dog.submitted(() => hung.push("run"), run)
  q.finish()
  await sleep(10)
  dog.lost()
  q.finish()
  q.finish()
  await sleep(GPU_HANG_MS + 50)
  check(told.join() === "done finished,run struck", "work finished on the device tells its run; a loss tells each run with work unfinished, once; work settled after the loss isn't finished", told)
  check(hung.length === 0, "a loss is no GPU hang by itself: no 250 ms rule at a loss, no timer after it", hung)
}
{
  // Strikes: only with the run's work finished since its last strike (or its start); two within 30 s stop.
  const clock = { t: 0 }
  const strikes = new Strikes(() => clock.t)
  const got: boolean[] = []
  got.push(strikes.strike())
  strikes.done()
  got.push(strikes.strike())
  got.push(strikes.strike())
  got.push(strikes.strike())
  clock.t = 1000
  strikes.done()
  got.push(strikes.strike())
  check(
    got.join() === "false,false,false,false,true",
    "a loss is a strike only after work finished since the last strike: losses in a row with none between are one strike; the second strike within 30 s stops",
    got,
  )
  const apart = new Strikes(() => clock.t)
  clock.t = 0
  apart.done()
  const far = [apart.strike()]
  clock.t = STRIKE_MS + 1
  apart.done()
  far.push(apart.strike())
  clock.t += STRIKE_MS
  apart.done()
  far.push(apart.strike())
  check(far.join() === "false,false,true", "strikes over 30 s apart don't stop; 30 s or less do", far)
}

console.log(failed === 0 ? "watchdog: all checks pass" : `watchdog: ${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
