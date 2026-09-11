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
    destination: fixture.messages[fixture.targetID].map((message) => message.id),
    source: fixture.messages[fixture.sourceID].map((message) => message.id),
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

benchmark("loads only the selected restored tab's transcript", async ({ page, report }) => {
  const loaded = new Set<string>()
  await mockStressTimeline(page, {
    onMessages: (input) => {
      if (!input.before && input.phase === "start") loaded.add(input.sessionID)
    },
  })
  await installStressSessionTabs(page, {
    sessionIDs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })
  await installTimelineSettings(page)
  const attention = Promise.all(
    [fixture.targetID, fixture.childID].map((id) =>
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${id}/form`),
    ),
  )
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)

  await attention
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
  expect([...loaded]).toEqual([fixture.sourceID])
  report({ loaded: [...loaded] })
})
