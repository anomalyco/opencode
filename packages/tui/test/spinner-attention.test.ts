import { describe, expect, test } from "bun:test"
import { createRoot, createSignal, type Setter } from "solid-js"
import {
  SPINNER_ATTENTION_OFFSETS,
  SPINNER_ATTENTION_STEP_MS,
  createSpinnerAttentionFrame,
  resolveSpinnerAttention,
  type SpinnerAttentionScheduler,
} from "../src/component/spinner"

type Job = {
  callback: () => void
  delay: number
  cancelled: boolean
}

function createScheduler() {
  const jobs: Job[] = []
  const scheduler: SpinnerAttentionScheduler = {
    setTimeout(callback, delay) {
      const job = { callback, delay, cancelled: false }
      jobs.push(job)
      return job
    },
    clearTimeout(handle) {
      ;(handle as Job).cancelled = true
    },
  }
  return {
    scheduler,
    pending() {
      return jobs.filter((job) => !job.cancelled)
    },
    run(delay: number) {
      const job = jobs.find((item) => !item.cancelled && item.delay === delay)
      if (!job) throw new Error(`missing timer at ${delay}ms`)
      job.cancelled = true
      job.callback()
    },
  }
}

describe("spinner attention visual state", () => {
  test("uses the approved five-position sequence", () => {
    expect(SPINNER_ATTENTION_OFFSETS).toEqual([-1, 1, -1, 1, 0])
    expect(SPINNER_ATTENTION_STEP_MS).toBe(60)
    expect(resolveSpinnerAttention(0, true)).toEqual({ left: -1, emphasized: false })
    expect(resolveSpinnerAttention(1, true)).toEqual({ left: 1, emphasized: false })
    expect(resolveSpinnerAttention(2, true)).toEqual({ left: -1, emphasized: false })
    expect(resolveSpinnerAttention(3, true)).toEqual({ left: 1, emphasized: false })
    expect(resolveSpinnerAttention(4, true)).toEqual({ left: 0, emphasized: false })
  })

  test("uses static emphasis when animations are disabled", () => {
    expect(resolveSpinnerAttention(0, false)).toEqual({ left: 0, emphasized: true })
    expect(resolveSpinnerAttention(undefined, false)).toEqual({ left: 0, emphasized: false })
  })

  test("remains visually idle when attention is omitted", () => {
    expect(resolveSpinnerAttention(undefined, true)).toEqual({ left: 0, emphasized: false })
    expect(resolveSpinnerAttention(undefined, false)).toEqual({ left: 0, emphasized: false })
  })
})

test("attention completes the deterministic timeline, restarts, and cancels timers on cleanup", async () => {
  const clock = createScheduler()
  let dispose = () => {}
  let setAttention!: Setter<number>
  let frame!: () => number | undefined

  createRoot((disposeRoot) => {
    dispose = disposeRoot
    const [attention, set] = createSignal(0)
    setAttention = set
    frame = createSpinnerAttentionFrame(attention, clock.scheduler)
  })
  await Promise.resolve()

  expect(frame()).toBeUndefined()
  expect(clock.pending()).toHaveLength(0)

  setAttention(1)
  expect(frame()).toBe(0)
  expect(clock.pending()).toHaveLength(4)

  clock.run(60)
  expect(frame()).toBe(1)

  clock.run(120)
  expect(frame()).toBe(2)

  clock.run(180)
  expect(frame()).toBe(3)

  clock.run(240)
  expect(frame()).toBeUndefined()
  expect(clock.pending()).toHaveLength(0)

  setAttention(2)
  expect(frame()).toBe(0)
  expect(clock.pending()).toHaveLength(4)

  clock.run(60)
  expect(frame()).toBe(1)

  dispose()
  expect(clock.pending()).toHaveLength(0)
})
