import type { Page } from "@playwright/test"
import { benchmark, expect, withBenchmarkPage } from "../benchmark"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  setupTimelineBenchmark,
} from "./session-timeline-benchmark.fixture"

// Streams the same text with the timeline's motion on and with reduced motion, which draws no growth, follow, edge or
// word motion, and compares renderer main-thread CPU time. The ratio, not either duration, is the result.
benchmark.describe("performance: timeline motion CPU", () => {
  benchmark("streams with motion at a bounded CPU cost over still", async ({ browser, report }, testInfo) => {
    const rounds = Number(process.env.TIMELINE_MOTION_CPU_ROUNDS ?? 3)
    const deltaCount = Number(process.env.TIMELINE_DELTA_COUNT ?? 400)
    const budget = process.env.TIMELINE_MOTION_CPU_BUDGET ? Number(process.env.TIMELINE_MOTION_CPU_BUDGET) : undefined
    benchmark.setTimeout(rounds * 4 * 90_000)

    // SAFETY: widens the empty sample lists to their element type.
    const samples = { motion: [] as number[], still: [] as number[] }

    // ABBA, so drift in the machine's load lands on both variants alike.
    const order = Array.from({ length: rounds }, (_, round) =>
      round % 2 === 0
        ? (["motion", "still", "still", "motion"] as const)
        : (["still", "motion", "motion", "still"] as const),
    ).flat()

    for (const [index, variant] of order.entries())
      samples[variant].push(
        await withBenchmarkPage(
          browser,
          `timeline motion CPU ${variant} ${index}`,
          (page) => streamCpuMs(page, variant === "still", deltaCount),
          testInfo,
        ),
      )

    const ratio = median(samples.motion) / median(samples.still)
    report(
      { motionCpuMs: samples.motion, stillCpuMs: samples.still, ratio },
      { deltaCount, rounds, budget: budget ?? null },
    )

    expect(samples.motion.every((value) => value > 0) && samples.still.every((value) => value > 0)).toBe(true)

    // Only a quiet, dedicated machine measures a few percent reliably, so the gate is opt-in.
    if (budget !== undefined) expect(ratio).toBeLessThanOrEqual(1 + budget)
  })
})

async function streamCpuMs(page: Page, still: boolean, deltaCount: number) {
  await page.emulateMedia({ reducedMotion: still ? "reduce" : "no-preference" })
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 24, eventBatch: 1 })
  fixture.transport.enqueue(buildInitialStreamEvent(deltaCount))
  await expect(fixture.text).toContainText("Implementation plan")
  await fixture.scrollToBottom()
  await fixture.waitForStableGeometry()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")

  // CPU time of the renderer's main thread, so a busy machine's waits do not count as work.
  const cpuMs = async () =>
    ((await cdp.send("Performance.getMetrics")).metrics.find((metric) => metric.name === "ThreadTime")?.value ?? 0) *
    1000

  const start = await cpuMs()
  fixture.transport.enqueue(buildStreamDeltaEvents(deltaCount))
  await expect(fixture.text).toContainText("benchmark-complete", { timeout: 120_000 })
  await fixture.waitForStableGeometry()
  // Let the last growth settle, so both variants pay for all of their motion.
  await page.waitForTimeout(1500)
  const used = (await cpuMs()) - start
  await cdp.detach()

  return used
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
