import { expect, test, type Page } from "@playwright/test"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref, draftHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"

for (const direction of ["ltr", "rtl"] as const) {
  test(`bottom mobile navigation adds no extra top panel gutter in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockStressTimeline(page)
    await page.addInitScript(() => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { mobileTitlebarPosition: "bottom" } }))
    })
    await openWithDirection(page, "/", direction)
    const panel = page.locator('[data-slot="home-panel"]')
    await expect(panel).toHaveCSS("--shell-top-inset", "0px")
    await expect
      .poll(async () => {
        const titlebar = await page.locator('[data-slot="titlebar-v2"]').boundingBox()
        const main = await page.getByRole("main").boundingBox()

        return titlebar && main && titlebar.y >= main.y + main.height
      })
      .toBe(true)
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox()
        const main = await page.getByRole("main").boundingBox()

        return bounds && main && bounds.y - main.y
      })
      .toBe(0)
  })

  for (const screen of [
    { name: "home", href: () => "/", panel: (page: Page) => page.locator('[data-slot="home-panel"]') },
    {
      name: "new-session",
      href: () => draftHref("shell-spacing-draft"),
      panel: (page: Page) => page.locator('[data-component="new-session"]'),
    },
    {
      name: "session",
      href: () => sessionHref(fixture.targetID),
      panel: (page: Page) => page.locator('[data-slot="session-chat-panel"]'),
    },
    { name: "settings", href: () => "/settings", panel: (page: Page) => page.getByTestId("settings-screen") },
  ]) {
    test(`${screen.name} keeps an 8px top gutter and only inline border clearance on mobile in ${direction}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await mockStressTimeline(page)

      if (screen.name === "new-session") await installStressSessionTabs(page, { draftID: "shell-spacing-draft" })
      await openWithDirection(page, screen.href(), direction)
      await expect(page.locator("html")).toHaveAttribute("dir", direction)

      const panel = screen.panel(page)

      await expect(panel).toBeVisible()
      await expect(panel).toHaveCSS("--shell-top-inset", "8px")
      await expect
        .poll(async () => {
          const bounds = await panel.boundingBox()
          const main = await page.getByRole("main").boundingBox()

          return bounds && main && bounds.y - main.y
        })
        .toBe(8)
      await expect
        .poll(async () => {
          const bounds = await panel.boundingBox()
          const main = await page.getByRole("main").boundingBox()

          return bounds && main && { x: bounds.x - main.x, width: main.width - bounds.width }
        })
        .toEqual({ x: 1, width: 2 })

      // The existing desktop gutter must return at the responsive breakpoint.
      await page.setViewportSize({ width: 768, height: 900 })
      await expect(panel).toHaveCSS("--shell-inline-inset", "8px")
      await expect(panel).toHaveCSS("--shell-top-inset", "8px")

      if (screen.name === "session") return
      await expect
        .poll(async () => {
          const bounds = await panel.boundingBox()
          const main = await page.getByRole("main").boundingBox()

          return bounds && main && { x: bounds.x - main.x, width: main.width - bounds.width }
        })
        .toEqual({ x: 8, width: 16 })
    })
  }
}
