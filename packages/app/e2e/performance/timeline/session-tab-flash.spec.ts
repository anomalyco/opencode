import { benchmark, expect } from "../benchmark"
import { expectSessionTitle } from "../../utils/waits"
import { fixture } from "./session-timeline-stress.fixture"
import {
  collectCachedRepaintTrace,
  compressCachedRepaintTrace,
  installCachedRepaintProbe,
  waitForCachedRepaintWindow,
} from "./session-tab-repaint-probe"
import { waitForStableTimeline } from "./session-tab-switch-probe"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./timeline-test-helpers"

benchmark("samples cached session repaint after the click", async ({ page, report }) => {
  benchmark.setTimeout(120_000)
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  await installTimelineSettings(page)
  await page.goto(stressSessionHref(fixture.targetID))
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await waitForStableTimeline(page, fixture.expected.targetMessageIDs.at(-1)!)
  await page
    .locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.sourceID)}"]`)
    .first()
    .click()
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)

  await installCachedRepaintProbe(page, {
    targetHref: stressSessionHref(fixture.targetID),
    destination: fixture.messages[fixture.targetID].map((message) => message.info.id),
    source: fixture.messages[fixture.sourceID].map((message) => message.info.id),
    last: fixture.expected.targetMessageIDs.at(-1)!,
    windowMs: 1_000,
  })

  await page
    .locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.targetID)}"]`)
    .first()
    .click()
  await Promise.all([expectSessionTitle(page, fixture.expected.targetTitle), waitForCachedRepaintWindow(page, 1_000)])
  const result = await collectCachedRepaintTrace(page)
  report(compressCachedRepaintTrace(result))
  expect(result.samples.length).toBeGreaterThan(0)
})

benchmark("prefetches every open session tab", async ({ page, report }) => {
  const prefetched = new Set<string>()
  await mockStressTimeline(page, {
    onMessages: (input) => {
      if (!input.before && input.phase === "start") prefetched.add(input.sessionID)
    },
  })
  await installStressSessionTabs(page, {
    sessionIDs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })
  await installTimelineSettings(page)
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)

  await expect.poll(() => prefetched.has(fixture.childID)).toBe(true)
  report({ prefetched: [...prefetched] })
})
