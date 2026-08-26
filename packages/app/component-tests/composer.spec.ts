import { expect, story } from "../../storybook/playwright/story"

// Moved from packages/app/e2e/regression/prompt-thinking-level.spec.ts
story("shows the thinking level control while relevant", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--model-and-variant")
  const composer = component.locator('[data-component="composer"]')
  const input = composer.locator('[data-component="composer-editor"]')
  const control = composer.getByRole("button", { name: "Choose model variant" })

  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect(control).toBeVisible()

  await control.click()
  const high = page.getByRole("menuitemradio", { name: "high" })
  await expect(high).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toBeVisible()
  await expect(high).toBeVisible()
  await high.click()

  await input.focus()
  await expect(control).toBeVisible()
  await input.blur()
  await expect(control).toBeVisible()
})
