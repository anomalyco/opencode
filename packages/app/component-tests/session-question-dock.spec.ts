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
