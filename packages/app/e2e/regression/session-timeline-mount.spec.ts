import { expect, test, type Page } from "@playwright/test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { expected, messages } from "../performance/timeline/session-tab-switch.fixture"
import { installTimelineSettings, stressSessionHref } from "../performance/timeline/timeline-test-helpers"

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" })

type Reveal = { pending: number; clipped: string[]; bottomError: number; tables: number; codeBlocks: number }

for (const width of [1440, 390]) {
  test(`reveals measured Markdown after the worker completes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const requested = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    await page.route(/markdown\.worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/, async (route) => {
      requested.resolve()
      await release.promise
      await route.continue()
    })
    await page.addInitScript((partID) => {
      const observer = new MutationObserver(() => {
        const answer = document.querySelector<HTMLElement>(`[data-timeline-part-id="${partID}"]`)
        const content = answer?.closest<HTMLElement>("[data-timeline-virtual-content]")
        const root = content?.closest<HTMLElement>(".scroll-view__viewport")
        if (!answer || !content || !root || !content.checkVisibility({ checkVisibilityCSS: true })) return
        const spacer = content.querySelector('[data-timeline-row="bottom-spacer"]')
        ;(window as Window & { __coldReveal?: Reveal }).__coldReveal = {
          pending: content.querySelectorAll('[data-component="markdown"]:not([data-markdown-ready])').length,
          clipped: [...content.querySelectorAll<HTMLElement>("[data-timeline-key]")].flatMap((row) =>
            (row.firstElementChild?.getBoundingClientRect().height ?? 0) > row.getBoundingClientRect().height + 1
              ? [row.dataset.timelineKey!]
              : [],
          ),
          bottomError: (spacer?.getBoundingClientRect().bottom ?? Infinity) - root.getBoundingClientRect().bottom,
          tables: answer.querySelectorAll("table").length,
          codeBlocks: answer.querySelectorAll("pre").length,
        }
        observer.disconnect()
      })
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] })
    }, expected[fixture.sourceID].answerID)
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      project: fixture.project,
      provider: fixture.provider,
      directory: fixture.directory,
      pageMessages: () => ({ items: messages[fixture.sourceID] }),
    })
    await installTimelineSettings(page)
    try {
      await page.goto(stressSessionHref(fixture.sourceID), { waitUntil: "domcontentloaded" })
      await requested.promise
      await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "hidden")
      release.resolve()
      await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
      const reveal = await page.evaluate(() => (window as Window & { __coldReveal?: Reveal }).__coldReveal)
      expect(reveal).toMatchObject({ pending: 0, clipped: [], tables: 1, codeBlocks: 4 })
      expect(Math.abs(reveal?.bottomError ?? Infinity)).toBeLessThanOrEqual(1)
    } finally {
      release.resolve()
    }
  })
}

test("scrolls within a long answer without mounting unrelated history", async ({ page }) => {
  await openTimeline(page, messages[fixture.sourceID])
  const answer = page.locator(`[data-timeline-part-id="${expected[fixture.sourceID].answerID}"]`)
  await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
  await expect(answer.getByRole("table")).toHaveCount(1)
  const scroller = page.locator(".scroll-view__viewport", { has: answer })
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  const rows = page.locator("[data-timeline-key]")
  const keys = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-timeline-key")),
  )
  const top = await answer.evaluate((element) => element.getBoundingClientRect().top)

  await scroller.hover()
  await page.mouse.wheel(0, -240)

  await expect.poll(() => answer.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(top + 240, 0)
  expect(
    await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-key"))),
  ).toEqual(keys)
  await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
})

test("fills a short cold transcript before revealing it", async ({ page }) => {
  const history = messages[fixture.sourceID].slice(-6).map((message, index) => {
    if (message.type === "user") return { ...message, text: `Prompt ${index}`, metadata: undefined }
    if (message.type === "assistant")
      return { ...message, content: [{ type: "text" as const, text: `**Answer ${index}**` }] }
    return message
  })
  await openTimeline(page, history)
  for (const message of history) {
    if (message.type === "user") {
      await expect(page.locator(`[data-timeline-row="UserMessage"][data-message-id="${message.id}"]`)).toBeInViewport()
    }
    if (message.type === "assistant") {
      const answer = page.locator(`[data-timeline-part-id="${message.id}:text:0"]`)
      await expect(answer).toBeInViewport()
      await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
    }
  }
})

async function openTimeline(page: Page, history: SessionMessageInfo[]) {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    project: fixture.project,
    provider: fixture.provider,
    directory: fixture.directory,
    pageMessages: () => ({ items: history }),
  })
  await installTimelineSettings(page)
  await page.goto(stressSessionHref(fixture.sourceID))
  await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
}
