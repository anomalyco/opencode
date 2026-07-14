import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, shell, userMessage } from "../performance/timeline-stability/fixture"

test("space activates a focused timeline button instead of scrolling", async ({ page }) => {
  const shellID = "prt_space_button_shell"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([shell(shellID, "completed", lines(5))])],
    settings: { shellToolPartsExpanded: false },
    reducedMotion: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const trigger = page.locator(`[data-timeline-part-id="${shellID}"] [data-slot="collapsible-trigger"]`)
  await trigger.focus()
  const before = await scroller.evaluate((element) => element.scrollTop)
  await trigger.press("Space")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before)
})

test("keeps the context usage tooltip open while its sticky trigger remains hovered", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:tabsInfoPopup", JSON.stringify({ dismissed: true }))
  })
  await setupTimeline(page, {
    settings: { newLayoutDesigns: true },
    seedHistory: true,
    viewport: { width: 1200, height: 600 },
    reducedMotion: true,
  })

  const button = page.getByRole("button", { name: "View context usage" })
  const tooltip = page.locator('[data-component="tooltip-v2"]')
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })

  await button.hover()
  await expect(tooltip).toBeVisible()
  const before = await scroller.evaluate((element) => element.scrollTop)
  await scroller.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        element.addEventListener("scroll", () => resolve(), { once: true })
        element.scrollBy(0, -100)
      }),
  )

  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).not.toBe(before)
  await expect.poll(() => button.evaluate((element) => element.matches(":hover"))).toBe(true)
  await expect(tooltip).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(tooltip).toBeHidden()

  await page.mouse.move(0, 0)
  await button.hover()
  await expect(tooltip).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(tooltip).toBeHidden()
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
