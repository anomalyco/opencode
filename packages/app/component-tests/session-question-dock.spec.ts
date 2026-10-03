import { expect, story } from "../../storybook/playwright/story"

story("shows question navigation shortcuts", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const shortcut = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘⏎" : "Ctrl+⏎"))
  const next = component.getByRole("button", { name: "Next", exact: true })
  await expect(next.locator('[data-slot="question-submit-shortcut"]')).toHaveText(shortcut)
  await next.click()
  await expect(component.getByRole("button", { name: "Submit", exact: true })).toContainText(shortcut)
  const back = component.getByRole("button", { name: "Back", exact: true })
  const backShortcut = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘[" : "Alt+←"))
  await expect(back).toHaveText("Back")
  await back.hover()
  await expect(page.getByRole("tooltip")).toContainText(backShortcut)
  await page.keyboard.press(
    await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Meta+[" : "Alt+ArrowLeft")),
  )
  await expect(next).toBeVisible()
})

story.describe("mobile questions", () => {
  story.use({ isMobile: true, hasTouch: true })

  for (const viewport of [
    { width: 393, height: 852 },
    { width: 393, height: 640 },
    { width: 852, height: 393 },
  ]) {
    story(`scrolls long questions and options at ${viewport.width}x${viewport.height}`, async ({ mount, page }) => {
      await page.setViewportSize(viewport)
      const component = await mount("app-current-session-surface--long-question-request")
      const content = component.locator('[data-slot="question-content"]')
      const footer = component.locator('[data-slot="question-footer"]')
      const next = component.getByRole("button", { name: "Next", exact: true })
      await expect(footer).toBeInViewport({ ratio: 1 })
      await expect(next).toBeInViewport({ ratio: 1 })

      await content.evaluate((element) => element.scrollTo(0, element.scrollHeight))
      const option = component.getByRole("radio", { name: /^Approach 12:/ })
      await expect(option).toBeInViewport({ ratio: 1 })
      await option.tap()
      await expect(option).toBeChecked()
      await expect(footer).toBeInViewport({ ratio: 1 })
      await next.tap()

      const submit = component.getByRole("button", { name: "Submit", exact: true })
      await expect(submit).toBeInViewport({ ratio: 1 })
      await content.evaluate((element) => element.scrollTo(0, 0))
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0)
      await expect(footer).toBeInViewport({ ratio: 1 })
      await content.evaluate((element) => element.scrollTo(0, element.scrollHeight))
      const portrait = component.getByRole("checkbox", { name: "Portrait", exact: true })
      await expect(portrait).toBeInViewport({ ratio: 1 })
      await portrait.tap()
      await expect(portrait).toBeChecked()

      await component.getByRole("button", { name: "Back", exact: true }).tap()
      await expect(option).toBeChecked()
      await next.tap()
      await expect(portrait).toBeChecked()
      await expect(submit).toBeInViewport({ ratio: 1 })
      await submit.tap()
      await expect(component.getByRole("status")).toHaveText("Submitted the answer locally")
    })
  }
})
