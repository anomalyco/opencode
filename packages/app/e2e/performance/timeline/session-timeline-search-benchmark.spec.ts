import { benchmark, expect } from "../benchmark"
import { buildInitialStreamEvent, setupTimelineBenchmark, textPartID } from "./session-timeline-benchmark.fixture"
import {
  collectTimelineSearchMetrics,
  installTimelineSearchProbe,
  waitForStableTimelineSearch,
} from "./session-timeline-search-probe"

benchmark("searches a large virtualized session and reveals the first result", async ({ page, report }) => {
  benchmark.setTimeout(180_000)
  const historyTurns = Number(process.env.TIMELINE_SEARCH_HISTORY_TURNS ?? 320)
  const completionTimeout = Number(process.env.TIMELINE_SEARCH_COMPLETION_TIMEOUT_MS ?? 60_000)
  const query = "Historical prompt"
  const targetPartID = "msg_0000_0000_a_user:text:0"
  const expectedCounter = `1/${historyTurns}`
  const fixture = await setupTimelineBenchmark(page, {
    historyTurns,
    eventBatch: 1,
  })

  fixture.transport.enqueue(buildInitialStreamEvent(1))
  await expect(fixture.text).toContainText("Implementation plan")
  await fixture.scrollToBottom()
  await fixture.waitForStableGeometry()
  // Chromium reserves the physical shortcut for its native find overlay, so request the same controller path directly.
  await page.evaluate(() => document.dispatchEvent(new Event("opencode:timeline-search-open")))

  const search = page.locator('[data-component="timeline-search-bar"]')
  const field = search.getByRole("searchbox", { name: "Find..." })
  const count = search.locator('[data-slot="timeline-search-count"]')
  const target = page.locator(`[data-timeline-part-id="${targetPartID}"]`)
  await expect(field).toBeVisible()
  await expect(field).toBeFocused()
  await installTimelineSearchProbe(page, { targetPartID })

  await field.fill(query)
  await expect(count).toHaveText(expectedCounter)
  await expect(target).toBeVisible({ timeout: completionTimeout })
  await waitForStableTimelineSearch(page, { counter: expectedCounter, targetPartID, timeout: completionTimeout })
  const metrics = await collectTimelineSearchMetrics(page, { counter: expectedCounter, targetPartID })

  expect(metrics.summary.handlerDurationMs).toBeDefined()
  expect(metrics.summary.firstCountObservedMs).toBeDefined()
  expect(metrics.summary.firstTargetVisibleMs).toBeDefined()
  expect(metrics.summary.firstActiveHighlightObservedMs).toBeDefined()
  expect(metrics.summary.stableResultObservedMs).toBeDefined()
  expect(metrics.summary.activeHighlightRanges).toBe(1)
  report(metrics, { historyTurns, query, expectedMatches: historyTurns })

  // Check navigation and the V2 assistant content IDs outside the measured interval.
  await field.press("Enter")
  await expect(count).toHaveText(`2/${historyTurns}`)
  await field.press("Shift+Enter")
  await expect(count).toHaveText(expectedCounter)
  await field.fill("Implementation plan")
  await expect(count).toHaveText("1/1")
  await expect(fixture.text).toBeInViewport()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = [...(CSS.highlights.get("timeline-search-hit-active") ?? [])][0]
        return range?.startContainer.parentElement?.closest<HTMLElement>("[data-timeline-part-id]")?.dataset
          .timelinePartId
      }),
    )
    .toBe(textPartID)
  await field.press("Escape")
  await expect(search).toBeHidden()
})
