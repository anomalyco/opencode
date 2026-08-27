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

const scenarios = [
  { cached: false, review: false, resized: false },
  { cached: false, review: true, resized: false },
  { cached: true, review: false, resized: false },
  { cached: true, review: true, resized: false },
  { cached: true, review: true, resized: true },
]

scenarios.forEach((scenario) => {
  const name = `tab switch: ${scenario.cached ? "cached" : "unmounted"}, review ${scenario.review ? "open" : "closed"}${scenario.resized ? ", resized" : ""}`
  benchmark(name, async ({ browser, report }, testInfo) => {
    const result = await withBenchmarkPage(
      browser,
      name,
      async (page) => {
        await mockStressTimeline(page, { vcsDiff: createReviewDiffs() })
        await installTimelineSettings(page)
        await installStressSessionTabs(page)
        await page.goto(stressSessionHref(fixture.sourceID))
        await expectSessionTitle(page, fixture.expected.sourceTitle)
        await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
        if (scenario.review && !scenario.resized) await openReviewPane(page)
        if (scenario.cached) {
          await switchSession(page, fixture.targetID, fixture.expected.targetTitle)
          const answer = page.locator(`[data-timeline-part-id="${fixture.expected.targetPartIDs.at(-1)}"]`)
          await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
          await expect
            .poll(() =>
              answer.evaluate((element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })),
            )
            .toBe(true)
          await waitForStableTimeline(page, fixture.expected.targetMessageIDs.at(-1)!)
          await switchSession(page, fixture.sourceID, fixture.expected.sourceTitle)
        }
        if (scenario.resized) await openReviewPane(page)
        await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)

        return measureSessionSwitch(page, {
          destinationIDs: fixture.messages[fixture.targetID].map((message) => message.id),
          sourceIDs: fixture.messages[fixture.sourceID].map((message) => message.id),
          lastID: fixture.expected.targetMessageIDs.at(-1)!,
          requiredPartID: fixture.expected.targetPartIDs.at(-1),
          href: stressSessionHref(fixture.targetID),
          switch: () => switchSession(page, fixture.targetID, fixture.expected.targetTitle),
        })
      },
      testInfo,
    )
    expect(result.unknownSamples).toBe(0)
    expect(result.wrongDestinationSamples).toBe(0)
    if (scenario.cached) expect(result.blankSamples).toBe(0)
    report(result, { ...scenario, inputEvent: "mousedown", requireReadyAnswer: true })
  })
})

async function switchSession(page: Page, sessionID: string, title: string) {
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(sessionID)}"]`)
  await expect(tab).toHaveCount(1)
  await tab.click()
  await expectSessionTitle(page, title)
}

async function openReviewPane(page: Page) {
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(page.locator("#review-panel")).toBeVisible()
  await page.waitForFunction(() => {
    const text = document.querySelector("#review-panel")?.textContent ?? ""
    return text.includes("generated-000.ts") && text.includes("+3")
  })
}
