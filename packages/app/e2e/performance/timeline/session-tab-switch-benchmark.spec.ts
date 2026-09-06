import type { Page } from "@playwright/test"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import { expected, messages, workload } from "./session-tab-switch.fixture"
import {
  createReviewDiffs,
  installStressSessionTabs,
  installTimelineSettings,
  stressSessionHref,
} from "./timeline-test-helpers"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"

const scenarios = [
  { cache: "cold", review: "closed" },
  { cache: "cold", review: "open" },
  { cache: "warm", review: "closed" },
  { cache: "warm", review: "open" },
  { cache: "warm", review: "resized" },
] as const

const viewport = { width: 1440, height: 900 }
const reviewDiffs = createReviewDiffs()
benchmark.use({ viewport, video: "off", trace: "off", serviceWorkers: "block", traceScope: "interaction" })

scenarios.forEach((scenario) => {
  benchmark(`tab switch: ${scenario.cache}, review ${scenario.review}`, async ({ page, report }, testInfo) => {
    const requests = await prepareSessionTabs(page)
    if (scenario.review === "open") await openReviewPane(page)
    if (scenario.cache === "warm") {
      await switchSession(page, fixture.targetID, fixture.expected.targetTitle)
      await expectReadyTimeline(page, fixture.targetID)
      await switchSession(page, fixture.sourceID, fixture.expected.sourceTitle)
    }
    if (scenario.review === "resized") await openReviewPane(page)
    await expectReadyTimeline(page, fixture.sourceID)
    await benchmarkDiagnostics(page).startTrace()
    const requestsBefore = requests.length

    const result = await measureSessionSwitch(page, {
      destinationIDs: messages[fixture.targetID].map((message) => message.id),
      sourceIDs: messages[fixture.sourceID].map((message) => message.id),
      lastID: expected[fixture.targetID].lastID,
      requiredPartID: expected[fixture.targetID].answerID,
      href: stressSessionHref(fixture.targetID),
      switch: () => switchSession(page, fixture.targetID, fixture.expected.targetTitle),
    })

    expect(result.firstCorrectObservedMs).not.toBeNull()
    expect(result.stableObservedMs).not.toBeNull()
    expect(requests).toHaveLength(requestsBefore + (scenario.cache === "cold" ? 1 : 0))
    await expectReadyTimeline(page, fixture.targetID)
    report(
      {
        ...result,
        messageRequestsDuringSwitch: requests.length - requestsBefore,
        rendererMemory:
          process.env.OPENCODE_PERFORMANCE_MEMORY === "1" ? await retainedRendererMemory(page) : undefined,
      },
      {
        ...scenario,
        ...workload,
        viewport,
        browserVersion: page.context().browser()!.version(),
        serviceWorkers: "blocked",
        reviewFiles: scenario.review === "closed" ? 0 : reviewDiffs.length,
        data: scenario.cache === "cold" ? "on-demand" : "cached",
        transport: process.env.OPENCODE_PERFORMANCE_HTTP_FIXTURE === "1" ? "http" : "playwright-route",
        inputEvent: "mousedown",
        requireReadyAnswer: true,
      },
    )
    if (testInfo.repeatEachIndex === 0) {
      await page.screenshot({ path: testInfo.outputPath("destination.png") })
      await testInfo.attach("destination", { path: testInfo.outputPath("destination.png"), contentType: "image/png" })
    }
  })
})

async function prepareSessionTabs(page: Page) {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "GET") return
    const match = new URL(request.url()).pathname.match(/^\/api\/session\/([^/]+)\/message$/)
    if (match) requests.push(decodeURIComponent(match[1]))
  })
  if (process.env.OPENCODE_PERFORMANCE_HTTP_FIXTURE !== "1")
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      // Return the full history so every scenario exercises a long loaded timeline.
      pageMessages: (sessionID) => ({ items: messages[sessionID] ?? [] }),
      vcsDiff: reviewDiffs,
    })
  await installTimelineSettings(page)
  await installStressSessionTabs(page)
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expectReadyTimeline(page, fixture.sourceID)
  await expect(page.locator(`[data-timeline-part-id="${expected[fixture.targetID].answerID}"]`)).toHaveCount(0)
  expect(requests).toEqual([fixture.sourceID])
  return requests
}

async function expectReadyTimeline(page: Page, sessionID: string) {
  const answer = page.locator(`[data-timeline-part-id="${expected[sessionID].answerID}"]`)
  await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
  await expect(answer.getByRole("table")).toHaveCount(1)
  await expect(answer.locator("pre")).toHaveCount(4)
  await expect
    .poll(() => answer.evaluate((element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })))
    .toBe(true)
  await waitForStableTimeline(page, expected[sessionID].lastID)
  await expect(page.locator('[data-timeline-key] [data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(
    0,
  )
}

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
  await page.locator('[data-slot="session-chat-panel"]').evaluate(async (panel) => {
    await Promise.all(panel.getAnimations().map((animation) => animation.finished))
  })
}

async function retainedRendererMemory(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send("HeapProfiler.collectGarbage")
    return {
      heap: await cdp.send("Runtime.getHeapUsage"),
      dom: await cdp.send("Memory.getDOMCounters"),
    }
  } finally {
    await cdp.detach()
  }
}
