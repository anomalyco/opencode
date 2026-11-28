import { expect, story } from "../../stories/playwright/story"

story("keeps an open reasoning header visible while its text scrolls", async ({ mount }) => {
  const root = await mount("current-reasoning-part--sticky-header", { args: { height: "640" } })
  const scroller = root.locator('[data-story="sticky-reasoning-scroll"]')
  const header = root.locator('[data-component="reasoning-part"] [data-slot="collapsible-trigger"]')
  const first = root.getByText("Opening paragraph:", { exact: false })

  const top = (locator: typeof header) =>
    locator.evaluate((node) => {
      const scroller = node.closest('[data-story="sticky-reasoning-scroll"]')!

      return Math.round(node.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
    })

  await expect(header).toHaveAttribute("aria-expanded", "true")
  await expect(root.getByText("Paragraph 40:", { exact: false })).toBeVisible()
  await expect.poll(() => scroller.evaluate((node) => node.scrollHeight > node.clientHeight * 2)).toBe(true)
  await expect.poll(() => top(header)).toBe(48)

  await scroller.evaluate((node) => (node.scrollTop = 900))
  await expect.poll(() => top(first)).toBeLessThan(0)
  await expect.poll(() => top(header)).toBe(48)

  await header.click()
  await expect(header).toHaveAttribute("aria-expanded", "false")
})
