import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "../performance/timeline/timeline-test-helpers"

test("keeps tabs vertically stable when session actions mount", async ({ page }) => {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await installStressSessionTabs(page)
  await page.goto("/")

  const href = stressSessionHref(fixture.sourceID)
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first()
  await expect(tab).toBeVisible()
  const top = () =>
    tab.evaluate((element) => {
      const item = element.closest("[data-titlebar-tab]")
      if (!(item instanceof HTMLElement)) throw new Error("Titlebar tab item not found")
      return item.getBoundingClientRect().top
    })
  const before = await top()

  await tab.click()
  await expect(page).toHaveURL(href)
  await expect(page.getByText(fixture.expected.sourceTitle).last()).toBeVisible()

  await expect.poll(top).toBe(before)
})
