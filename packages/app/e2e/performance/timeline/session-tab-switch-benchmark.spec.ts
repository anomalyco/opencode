import type { Page } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { benchmark, expect, withBenchmarkPage } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import { installStressSessionTabs, mockStressTimeline, stressSessionHref } from "./timeline-test-helpers"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"

type Result = Awaited<ReturnType<typeof measureSessionSwitch>>

benchmark("benchmarks cold and hot session tab switching", async ({ browser, report }, testInfo) => {
  benchmark.setTimeout(180_000)
  const results = { cold: [] as Result[], hot: [] as Result[] }
  for (const mode of ["cold", "hot"] as const) {
    for (let run = 0; run < 5; run++) {
      results[mode].push(
        await withBenchmarkPage(browser, `session-tab-switch-${mode}-${run}`, (page) => trial(page, mode), testInfo),
      )
    }
  }
  report({ results, summary: summarize(results) })
})

async function trial(page: Page, mode: "cold" | "hot") {
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  if (mode === "hot") {
    await page.goto(stressSessionHref(fixture.targetID))
    await expectSessionTitle(page, fixture.expected.targetTitle)
    await waitForStableTimeline(page, fixture.expected.targetMessageIDs.at(-1)!)
    await switchSession(page, fixture.sourceID, fixture.expected.sourceTitle)
  } else {
    await page.goto(stressSessionHref(fixture.sourceID))
    await expectSessionTitle(page, fixture.expected.sourceTitle)
  }
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)

  const destinationIDs = fixture.messages[fixture.targetID].map((message) => message.info.id)
  const sourceIDs = fixture.messages[fixture.sourceID].map((message) => message.info.id)
  const lastID = fixture.expected.targetMessageIDs.at(-1)!
  const href = stressSessionHref(fixture.targetID)
  const result = await measureSessionSwitch(page, {
    destinationIDs,
    sourceIDs,
    lastID,
    href,
    switch: () => switchSession(page, fixture.targetID, fixture.expected.targetTitle),
  })
  return result
}

function summarize(results: Record<"cold" | "hot", Result[]>) {
  const stats = (values: (number | null)[]) => {
    const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b)
    return {
      min: sorted[0] ?? null,
      median: sorted[Math.floor(sorted.length / 2)] ?? null,
      max: sorted.at(-1) ?? null,
      missing: values.length - sorted.length,
    }
  }
  return Object.fromEntries(
    Object.entries(results).map(([mode, values]) => [
      mode,
      {
        firstDestinationObservedMs: stats(values.map((value) => value.firstDestinationObservedMs)),
        firstCorrectObservedMs: stats(values.map((value) => value.firstCorrectObservedMs)),
        stableObservedMs: stats(values.map((value) => value.stableObservedMs)),
      },
    ]),
  )
}

async function switchSession(page: Page, sessionID: string, title: string) {
  const href = stressSessionHref(sessionID)
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first()
  await expect(tab).toBeVisible()
  await tab.click()
  await expectSessionTitle(page, title)
}
