import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer } from "../utils/mock-server"

for (const direction of ["ltr", "rtl"] as const) {
  test(`session header groups controls and exposes server status in ${direction}`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory: fixture.directory,
      project: fixture.project,
      sessions: fixture.sessions,
      provider: fixture.provider,
      pageMessages,
    })
    await installStressSessionTabs(page)
    await page.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ ...settings, general: { ...settings.general, showStatus: true } }),
      )
    })
    await page.goto(stressSessionHref(fixture.targetID))
    const header = page.locator("[data-session-title]")
    const more = header.getByRole("button", { name: "More options", exact: true })
    const review = header.getByRole("button", { name: "Toggle review", exact: true })
    const details = header.getByRole("button", { name: "Session details", exact: true })
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)
    await page.evaluate((direction) => document.documentElement.setAttribute("dir", direction), direction)
    await expect(review).toBeVisible()
    await expect(details).toBeVisible()
    const status = page.locator('[data-slot="titlebar-v2"]').getByRole("button", { name: "Status" })
    await expect(status).toBeVisible()
    await expect
      .poll(async () => {
        const boxes = await Promise.all(
          [header.getByRole("heading"), more, review, details].map((button) => button.boundingBox()),
        )
        const [title, menu, sidebar, summary] = boxes
        if (!title || !menu || !sidebar || !summary) return false
        return direction === "ltr"
          ? Math.abs(title.x + title.width - menu.x) <= 1 &&
              menu.x + menu.width <= summary.x &&
              summary.x + summary.width <= sidebar.x
          : Math.abs(menu.x + menu.width - title.x) <= 1 &&
              sidebar.x + sidebar.width <= summary.x &&
              summary.x + summary.width <= menu.x
      })
      .toBe(true)

    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator("#review-panel")).toBeVisible()
    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "false")

    await more.click()
    await expect(page.getByRole("menuitem", { name: "Server status", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await status.click()
    const mcp = page.getByRole("tab", { name: "MCP", exact: true })
    const plugins = page.getByRole("tab", { name: "Plugins", exact: true })
    await expect(mcp).toHaveAttribute("aria-selected", "true")
    await plugins.click()
    await expect(plugins).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("Escape")
    await expect(mcp).toBeHidden()
  })
}
