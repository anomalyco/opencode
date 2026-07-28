import { test, expect } from "@playwright/test"

test("TitlebarTabStrip story renders with tab titles visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(
    "http://localhost:6007/iframe.html?id=app-titlebar-tab-strip--many-tabs-mobile-scroll&viewMode=story",
    { waitUntil: "networkidle", timeout: 15_000 },
  )

  // Wait for the scroll container to render.
  const scroll = page.locator("[data-titlebar-tab-scroll]")
  await expect(scroll).toBeVisible({ timeout: 10_000 })

  // All 8 tab titles must render.
  const titles = page.locator("[data-testid=tab-title]")
  await expect(titles).toHaveCount(8)

  // Each title must contain visible text.
  for (const text of await titles.allTextContents()) {
    expect(text.length).toBeGreaterThan(0)
  }

  // The scroll container must overflow horizontally.
  const overflow = await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(overflow).toBe(true)

  // Every tab slot must maintain a width >= 200px (shrink-0 keeps them at ~224px).
  const slots = page.locator("[data-titlebar-tab-slot]")
  const count = await slots.count()
  for (let i = 0; i < count; i++) {
    const box = await slots.nth(i).boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(200)
  }
})
