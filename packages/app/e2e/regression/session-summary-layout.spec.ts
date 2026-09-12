import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { mockStressTimeline, stressSessionHref } from "../performance/timeline/timeline-test-helpers"

for (const theme of ["light", "dark"] as const) {
  test(`summary bounds long service lists in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await mockStressTimeline(page)
    await page.addInitScript((theme) => {
      localStorage.setItem("opencode-theme-id", "oc-2")
      localStorage.setItem("opencode-color-scheme", theme)
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: theme === "dark" ? "he" : "en" }))
    }, theme)
    await page.route("**/api/mcp**", (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback()
      return route.fulfill({
        json: {
          location: { directory: fixture.directory },
          data:
            new URL(route.request().url()).pathname === "/api/mcp/resource"
              ? { resources: [], templates: [] }
              : Array.from({ length: 30 }, (_, index) => ({
                  name: `server-${String(index).padStart(2, "0")}-בדיקה-${"long-name-".repeat(6)}`,
                  status: { status: "connected" },
                })),
        },
      })
    })
    await page.goto(stressSessionHref(fixture.targetID))
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", theme)
    await page.getByRole("button", { name: theme === "dark" ? "פרטי ההפעלה" : "Session details", exact: true }).click()
    const summary = page.locator('[data-component="session-summary-panel"]')
    await summary.getByRole("button", { name: "MCP", exact: true }).click()
    const menu = page.getByRole("dialog", { name: "MCP", exact: true })
    await expect(menu.getByRole("switch")).toHaveCount(30)
    await expect.poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect
      .poll(async () => {
        const bounds = await menu.boundingBox()
        return (
          !!bounds &&
          bounds.x >= 15 &&
          bounds.y >= 15 &&
          bounds.x + bounds.width <= 785 &&
          bounds.y + bounds.height <= 585
        )
      })
      .toBe(true)
    await testInfo.attach(`summary-${theme}-long-list`, { body: await page.screenshot(), contentType: "image/png" })
    await menu.getByRole("switch", { name: /^server-29-/ }).focus()
    await expect(menu.getByRole("switch", { name: /^server-29-/ })).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
    await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeFocused()
  })
}
