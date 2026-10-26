import { expectSessionTitle } from "../../utils/waits"
import { benchmark, expect } from "../benchmark"
import { measureFirstNavigation } from "./first-navigation-probe"
import {
  fixture,
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
} from "../../utils/session-fixture"
import { draftHref, sessionHref } from "../../utils/app"
import { waitForStableTimeline } from "./session-tab-switch-probe"

const contentSelector = '[data-message-id], [data-component="composer-editor"]'

const draftID = "draft_first_navigation"

benchmark.describe("performance: first navigation paint", () => {
  benchmark("opens an unvisited session tab without a blank frame", async ({ page, report }) => {
    await setup(page)
    const href = sessionHref(fixture.targetID)

    const result = await measureFirstNavigation(page, {
      href,
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: messageSelector(fixture.expected.targetMessageIDs.at(-1)!),
      contentSelector,
      navigate: async () => {
        await page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first().click()
        await expectSessionTitle(page, fixture.expected.targetTitle)
      },
    })

    report(result)
    expect(result.summary.blankSamples).toBe(0)
    expect(result.summary.unknownSamples).toBe(0)
  })

  benchmark("opens the new session page before its lazy module is used", async ({ page, report }) => {
    await setup(page, draftID)
    const href = draftHref(draftID)

    const result = await measureFirstNavigation(page, {
      href,
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: '[data-component="composer-editor"]',
      contentSelector,
      navigate: async () => {
        await page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first().click()
        await expect(page.locator('[data-component="composer-editor"]')).toBeVisible()
      },
    })

    report(result)
    expect(result.summary.blankSamples).toBe(0)
    expect(result.summary.unknownSamples).toBe(0)
  })

  benchmark("opens a session from the new session page without a blank frame", async ({ page, report }) => {
    await mockStressTimeline(page)
    await installTimelineSettings(page)
    await installStressSessionTabs(page, { draftID })
    await page.goto("/")

    const draftLink = draftHref(draftID)
    const draftTab = page.locator(`[data-slot="titlebar-tabs"] a[href="${draftLink}"]`)
    await expect(draftTab).toHaveCount(1)
    await draftTab.click()
    await expect(page.locator('[data-component="new-session"]')).toBeVisible()

    const href = sessionHref(fixture.targetID)
    const sessionTab = page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`)
    await expect(sessionTab).toHaveCount(1)

    const result = await measureFirstNavigation(page, {
      href,
      destinationPath: href,
      sourceSelector: '[data-component="new-session"]',
      destinationSelector: messageSelector(fixture.expected.targetMessageIDs.at(-1)!),
      contentSelector,
      navigate: async () => {
        await sessionTab.click()
        await expectSessionTitle(page, fixture.expected.targetTitle)
      },
    })

    report(result)
    expect(result.summary.blankSamples).toBe(0)
    expect(result.summary.unknownSamples).toBe(0)
  })

  benchmark("opens a child session without a blank frame", async ({ page, report }) => {
    await setup(page)
    const href = sessionHref(fixture.childID)

    const result = await measureFirstNavigation(page, {
      href,
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: messageSelector(fixture.expected.childMessageIDs.at(-1)!),
      contentSelector,
      navigate: async () => {
        await page.locator(`a[href="${href}"]`, { has: page.locator('[data-component="task-tool-card"]') }).click()
        await expectSessionTitle(page, fixture.expected.childTitle)
      },
    })

    report(result)
    expect(result.summary.blankSamples).toBe(0)
    expect(result.summary.unknownSamples).toBe(0)
  })
})

async function setup(page: Parameters<typeof mockStressTimeline>[0], draft?: string) {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await installStressSessionTabs(page, draft ? { draftID: draft } : undefined)
  await page.goto(sessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
}

function messageSelector(id: string) {
  return `[data-message-id="${id}"]`
}
