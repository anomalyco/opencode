import { expect, story } from "../../stories/playwright/story"

story.use({ viewport: { width: 1000, height: 400 } })

story("fork search anchors filtering and keyboard scrolling", async ({ mount, page }) => {
  await mount("app-dialog-fork-session--default")
  const dialog = page.getByRole("dialog", { name: "Fork from message", exact: true })
  const input = dialog.getByRole("searchbox", { name: "Search", exact: true })
  const container = page.locator('[data-component="dialog-v2"] [data-slot="dialog-container"]')

  const geometry = () =>
    container.evaluate((element) => {
      const field = element.querySelector('input[type="search"]')!.getBoundingClientRect()

      return {
        height: element.getBoundingClientRect().height,
        inputTop: field.top,
        inputBottom: field.bottom,
        instructionTop: element.querySelector('[data-slot="dialog-description"]')!.getBoundingClientRect().top,
      }
    })

  await expect(input).toBeFocused()
  await expect(dialog.getByRole("option")).toHaveCount(8)
  await expect(dialog).toHaveAccessibleDescription("Choose a message to fork from")
  await expect(dialog.getByText("Choose a message to fork from", { exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await input.hover()
  const initial = await geometry()
  expect(initial.instructionTop).toBeGreaterThanOrEqual(initial.inputBottom)

  await input.fill("keyboard navigation")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await expect.poll(async () => (await geometry()).height).toBeLessThan(initial.height - 100)
  await expect.poll(async () => (await geometry()).inputTop).toBeCloseTo(initial.inputTop, 0)

  await input.clear()
  await expect(dialog.getByRole("option")).toHaveCount(8)
  const scroll = dialog.locator("[data-scrollable]")

  await expect.poll(() => scroll.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
  await input.press("ArrowUp")

  const oldest = dialog.getByRole("option", {
    name: /^Investigate how the command palette handles keyboard navigation\./,
  })

  await expect(oldest).toHaveAttribute("aria-selected", "true")
  await expect(oldest).toBeInViewport()
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect.poll(async () => (await geometry()).inputTop).toBeCloseTo(initial.inputTop, 0)
  await expect(input).toBeFocused()
  await input.press("Enter")
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("status")).toHaveText("story-message-0")

  await page.getByRole("button", { name: "Open fork session dialog", exact: true }).click()
  await expect(input).toBeFocused()
  await input.press("Escape")
  await expect(dialog).toBeHidden()
})
