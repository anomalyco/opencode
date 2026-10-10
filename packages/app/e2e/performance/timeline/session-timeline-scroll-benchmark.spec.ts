import type { Locator, Page } from "@playwright/test"
import { benchmark, expect } from "../benchmark"
import { setupTimelineBenchmark } from "./session-timeline-benchmark.fixture"
import {
  collectTimelineScrollMetrics,
  installTimelineScrollProbe,
  startTimelineScrollProbe,
} from "./session-timeline-scroll-probe"

const historyTurns = Number(process.env.SCROLL_BENCH_HISTORY_TURNS ?? 320)
const upSteps = Number(process.env.SCROLL_BENCH_UP_STEPS ?? 24)
const upDelta = Number(process.env.SCROLL_BENCH_UP_DELTA ?? -900)
const fastSteps = Number(process.env.SCROLL_BENCH_FAST_STEPS ?? 8)
const fastDelta = Number(process.env.SCROLL_BENCH_FAST_DELTA ?? 2_600)

/**
 * Scroll-path pacing for a long Markdown session.
 *
 * The two scenarios bracket the cold tail settle: one scrolls as soon as the timeline mounts,
 * the other waits until the settle finished. Metrics are reported for before/after comparison
 * only; no timing or frame-rate threshold is asserted.
 */
benchmark.describe("performance: session timeline scrolling", () => {
  benchmark("scrolls a long session from the cold tail", async ({ page, report }) => {
    benchmark.setTimeout(300_000)
    report(await runTimelineScrollBenchmark(page, { waitForColdSettle: false }))
  })

  benchmark("scrolls a long session after the cold tail settled", async ({ page, report }) => {
    benchmark.setTimeout(300_000)
    report(await runTimelineScrollBenchmark(page, { waitForColdSettle: true }))
  })
})

async function runTimelineScrollBenchmark(page: Page, options: { waitForColdSettle: boolean }) {
  const fixture = await setupTimelineBenchmark(page, { historyTurns, eventBatch: 1 })

  // The settle removes the inline `visibility: hidden` from the virtual content once the cold
  // tail finished; the second scenario starts only after that gate is gone.
  if (options.waitForColdSettle)
    await expect
      .poll(
        () =>
          fixture.scroller.evaluate(
            () => document.querySelector<HTMLElement>("[data-timeline-virtual-content]")?.style.visibility === "hidden",
          ),
        { timeout: 120_000, intervals: [100, 250, 500] },
      )
      .toBe(false)

  const maxScroll = await fixture.scroller.evaluate((element) => element.scrollHeight - element.clientHeight)

  // Calibrate before measuring: a step that never reaches the scroller would otherwise surface
  // as an opaque progress timeout halfway through the run.
  const calibrated = await wheelThrough(fixture.scroller, 1, upDelta)
  expect(calibrated, "calibration step moves the timeline").toBeGreaterThan(0)

  await installTimelineScrollProbe(page)
  await startTimelineScrollProbe(page)

  const upScrolled = await wheelThrough(fixture.scroller, upSteps, upDelta)
  const fastScrolled = await wheelThrough(fixture.scroller, fastSteps, fastDelta)
  const metrics = await collectTimelineScrollMetrics(page)

  expect(metrics.frameCount).toBeGreaterThan(0)
  expect(metrics.frameGapMedianMs).not.toBeNull()
  expect(metrics.frameGapP95Ms).not.toBeNull()
  expect(upScrolled + fastScrolled).toBeGreaterThan(0)

  return {
    metrics: { ...metrics, upScrolled, fastScrolled, maxScroll },
    context: {
      historyTurns,
      upSteps,
      upDelta,
      fastSteps,
      fastDelta,
      waitedForColdSettle: options.waitForColdSettle,
      ...fixture.workload,
    },
  }
}

/**
 * Steps the scroller `steps` times so the scroll stays continuous instead of stalling between round
 * trips, then waits for the position to hold still. The burst ends early at either end of the
 * timeline, and the net movement is returned as-is: the cold tail pin can legitimately drag the
 * view back down.
 *
 * Assigns `scrollTop` rather than wheeling: a wheel burst makes this app navigate, which destroys
 * the execution context mid-measurement. The assignment still fires a real scroll event, so the
 * settle path under measurement runs unchanged.
 */
async function wheelThrough(scroller: Locator, steps: number, delta: number) {
  const start = await scroller.evaluate((element) => element.scrollTop)

  for (let step = 0; step < steps; step++) {
    const before = await scroller.evaluate((element) => element.scrollTop)
    const max = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight)

    if (delta < 0 ? before <= 0 : before >= max) break

    await scroller.evaluate((element, by) => {
      element.scrollTop = element.scrollTop + by
    }, delta)
  }

  await scroller.evaluate(waitForScrollToSettle, { stableFrames, settleFrameBudget })

  return Math.abs((await scroller.evaluate((element) => element.scrollTop)) - start)
}

const stableFrames = 3

const settleFrameBudget = 1_200

/**
 * Resolves once scrollTop repeats across consecutive frames, or once the frame budget runs out.
 *
 * The budget arrives as an argument: `evaluate` serializes only the function source, so a
 * module-scope constant would read as `undefined` in the page and the loop would never resolve.
 */
function waitForScrollToSettle(element: HTMLElement, budget: { stableFrames: number; settleFrameBudget: number }) {
  return new Promise<void>((resolve) => {
    let previous = -1
    let stable = 0
    let frames = 0

    const sample = () => {
      const top = element.scrollTop
      stable = top === previous ? stable + 1 : 0
      previous = top
      frames += 1

      if (stable >= budget.stableFrames || frames >= budget.settleFrameBudget) return resolve()
      requestAnimationFrame(sample)
    }

    requestAnimationFrame(sample)
  })
}
