import type { Page } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { benchmark, expect, withBenchmarkPage } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import {
  createReviewDiffs,
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./timeline-test-helpers"
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

benchmark(
  "benchmarks v2 session tab switching with and without the review pane",
  async ({ browser, report }, testInfo) => {
    benchmark.setTimeout(360_000)
    const runs = Number(process.env.SESSION_TAB_SWITCH_RUNS ?? 5)
    const results = {
      closed: { cold: [] as Result[], hot: [] as Result[] },
      open: { cold: [] as Result[], hot: [] as Result[] },
    }
    for (const reviewPane of ["closed", "open"] as const) {
      for (const mode of ["cold", "hot"] as const) {
        for (let run = 0; run < runs; run++) {
          results[reviewPane][mode].push(
            await withBenchmarkPage(
              browser,
              `session-tab-switch-v2-${reviewPane}-${mode}-${run}`,
              (page) => trial(page, mode, { newLayoutDesigns: true, reviewPane }),
              testInfo,
            ),
          )
        }
      }
    }
    report({ results, summary: summarizeReviewPane(results) }, { runs, reviewDiffs: createReviewDiffs().length })
  },
)

async function trial(
  page: Page,
  mode: "cold" | "hot",
  options?: { newLayoutDesigns?: boolean; reviewPane?: "closed" | "open" },
) {
  const reviewDiffs = options?.newLayoutDesigns ? createReviewDiffs() : undefined
  await mockStressTimeline(page, { vcsDiff: reviewDiffs })
  if (options?.newLayoutDesigns) await installTimelineSettings(page)
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
  if (options?.reviewPane === "open") {
    await openReviewPane(page)
    await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
  }

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

function summarizeReviewPane(results: Record<"closed" | "open", Record<"cold" | "hot", Result[]>>) {
  return Object.fromEntries(
    Object.entries(results).map(([reviewPane, values]) => [
      reviewPane,
      summarize(values as Record<"cold" | "hot", Result[]>),
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

async function openReviewPane(page: Page) {
  await page.getByRole("button", { name: "Toggle review" }).click()
  const panel = page.locator("#review-panel")
  await expect(panel).toBeVisible()
  // Text-based readiness works across review implementations; the legacy list mounts
  // diff viewers lazily while V2 mounts the active preview eagerly.
  await page.waitForFunction(() => {
    const panel = document.querySelector<HTMLElement>("#review-panel")
    const text = panel?.textContent ?? ""
    return text.includes("generated-000.ts") && text.includes("+3")
  })
}
