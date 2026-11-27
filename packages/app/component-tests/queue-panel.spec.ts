import type { Locator } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const rows = (root: Locator) => root.locator('[data-component="session-queue-row"]')

const expandButtons = (root: Locator) => root.locator('[data-action="session-queue-expand"]')

story("each queued message expands independently and keeps its own state", async ({ mount }) => {
  const root = await mount("session-queue-panel--short")
  const messages = expandButtons(root)

  await expect(messages).toHaveCount(3)
  await expect(messages.nth(0)).toHaveAttribute("aria-expanded", "false")
  await expect(messages.nth(1)).toHaveAttribute("aria-expanded", "false")
  await expect(messages.nth(2)).toHaveAttribute("aria-expanded", "false")

  await messages.nth(0).click()
  await expect(messages.nth(0)).toHaveAttribute("aria-expanded", "true")
  await expect(messages.nth(0)).toHaveAccessibleName("Collapse message")
  await expect(messages.nth(1)).toHaveAttribute("aria-expanded", "false")

  await messages.nth(1).click()
  await expect(messages.nth(0)).toHaveAttribute("aria-expanded", "true")
  await expect(messages.nth(1)).toHaveAttribute("aria-expanded", "true")
  await expect(messages.nth(2)).toHaveAttribute("aria-expanded", "false")

  await messages.nth(0).click()
  await expect(messages.nth(0)).toHaveAttribute("aria-expanded", "false")
  await expect(messages.nth(1)).toHaveAttribute("aria-expanded", "true")
})

story("Hide queue hides the whole queue and restores every message's expansion", async ({ mount }) => {
  const root = await mount("session-queue-panel--short")
  const messages = expandButtons(root)

  await messages.nth(1).click()
  await expect(messages.nth(1)).toHaveAttribute("aria-expanded", "true")

  await root.getByRole("button", { name: "Hide queue" }).click()
  await expect(rows(root)).toHaveCount(0)

  const collapsed = root.getByRole("button", { name: /3 queued/ })
  await expect(collapsed).toHaveAttribute("aria-expanded", "false")
  await expect(collapsed).toContainText("Show queue")
  await collapsed.click()

  await expect(rows(root)).toHaveCount(3)
  await expect(expandButtons(root).nth(0)).toHaveAttribute("aria-expanded", "false")
  await expect(expandButtons(root).nth(1)).toHaveAttribute("aria-expanded", "true")
  await expect(expandButtons(root).nth(2)).toHaveAttribute("aria-expanded", "false")
  await expect(root.getByRole("button", { name: "Hide queue" })).toBeVisible()
})

story("an expanded queue row keeps its state when the row before it is removed", async ({ mount }) => {
  const root = await mount("session-queue-panel--short")
  const second = root.locator('[data-component="session-queue-row"]').filter({ hasText: "Rename the Alpha export" })

  await second.locator('[data-action="session-queue-expand"]').click()
  await expect(second.locator('[data-action="session-queue-expand"]')).toHaveAttribute("aria-expanded", "true")

  const first = root.locator('[data-component="session-queue-row"]').filter({
    hasText: "Compare the Alpha and Beta fixtures",
  })

  await first.hover()
  await first.getByRole("button", { name: "Remove" }).click()

  await expect(rows(root)).toHaveCount(2)
  const renamed = root.locator('[data-component="session-queue-row"]').filter({ hasText: "Rename the Alpha export" })
  await expect(renamed.locator('[data-action="session-queue-expand"]')).toHaveAttribute("aria-expanded", "true")
})

story("expanded long messages wrap without horizontal overflow at narrow widths", async ({ mount, page }) => {
  const root = await mount("session-queue-panel--long")
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  for (const index of [0, 1]) await expandButtons(root).nth(index).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: document.documentElement.scrollWidth <= window.innerWidth,
        rows: [...document.querySelectorAll<HTMLElement>('[data-expanded] [data-action="session-queue-edit"]')].every(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      })),
    )
    .toEqual({ document: true, rows: true })

  const second = page.locator('[data-action="session-queue-edit"]').nth(1)
  await expect(second).toHaveCSS("white-space", "pre-wrap")
  await expect.poll(() => second.evaluate((element) => getComputedStyle(element).overflowWrap)).toBe("anywhere")

  const list = root.locator('[data-slot="session-queue-list"]')
  await expect.poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(true)
  await expect.poll(() => list.evaluate((element) => getComputedStyle(element).maskImage)).toContain("linear-gradient")
})
