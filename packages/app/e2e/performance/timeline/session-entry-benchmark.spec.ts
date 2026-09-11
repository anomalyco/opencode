import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import { measureNavigationMilestones } from "./navigation-milestones"
import { fixture } from "./session-timeline-stress.fixture"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"
import { installStressSessionTabs, mockStressTimeline, stressSessionHref } from "./timeline-test-helpers"

benchmark.use({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
  traceScope: "interaction",
  trace: "off",
  video: "off",
})

for (const entry of ["home", "session"] as const) {
  benchmark(`entry: new session from ${entry}`, async ({ page, report }) => {
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: entry === "home" ? [] : [fixture.sourceID] })
    await page.goto(entry === "home" ? "/" : stressSessionHref(fixture.sourceID))
    if (entry === "session") await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
    const trigger = entry === "home" ? '[data-action="home-new-session"]' : 'button[aria-label="New session"]'
    await expect(page.locator(trigger)).toBeVisible()
    await expect(page.locator('[data-component="new-session"]')).toHaveCount(0)
    const writes: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method()))
        writes.push(request.method())
    })
    await benchmarkDiagnostics(page).startTrace()
    const result = await measureNavigationMilestones(page, {
      triggerSelector: trigger,
      milestones: {
        editor: {
          selector: '[data-component="new-session"] [data-component="composer-editor"][contenteditable="true"]:focus',
        },
        model: { selector: '[data-component="new-session"] [data-action="composer-model"]', text: "Claude Opus 4.6" },
        project: { selector: '[data-component="new-session"] [data-action="prompt-project"]' },
        tab: { selector: '[data-titlebar-tab-link][href^="/new-session?draftId="]' },
      },
      navigate: () => page.locator(trigger).click(),
    })
    await benchmarkDiagnostics(page).stop()
    const editor = page.locator('[data-component="new-session"] [data-component="composer-editor"]')
    await expect(editor).toHaveText("")
    await page.keyboard.type("Draft input")
    await expect(editor).toHaveText("Draft input")
    expect(writes).toEqual([])
    report(
      {
        firstCorrectObservedMs: result.summary.all.firstObservedMs,
        stableObservedMs: result.summary.all.stableObservedMs,
        ...result,
      },
      { entry, data: "fixture", inputEvent: "mousedown" },
    )
  })
}

benchmark("entry: cold session from Home", async ({ page, report }) => {
  const requests: string[] = []
  await mockStressTimeline(page, {
    onMessages: (request) => {
      if (request.phase === "start") requests.push(request.sessionID)
    },
  })
  await installStressSessionTabs(page, { sessionIDs: [] })
  await page.goto("/")
  const selector = `[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"] [data-component="home-session-row"]`
  await expect(page.locator(selector)).toBeVisible()
  expect(requests).not.toContain(fixture.targetID)
  const href = stressSessionHref(fixture.targetID)
  await benchmarkDiagnostics(page).startTrace()
  const result = await measureSessionSwitch(page, {
    destinationIDs: fixture.messages[fixture.targetID].map((message) => message.id),
    sourceIDs: [],
    lastID: fixture.expected.targetMessageIDs.at(-1)!,
    requiredPartID: fixture.expected.targetPartIDs.at(-1)!,
    href,
    triggerSelector: selector,
    switch: async () => {
      await page.locator(selector).click()
      await waitForStableTimeline(page, fixture.expected.targetMessageIDs.at(-1)!)
    },
  })
  await benchmarkDiagnostics(page).stop()
  await expect(
    page.locator(`[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-link][href="${href}"]`),
  ).toHaveCount(1)
  expect(requests).toContain(fixture.targetID)
  report(result, { entry: "home", data: "cold paginated fixture", inputEvent: "mousedown" })
})
