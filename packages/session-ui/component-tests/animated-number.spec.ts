import { expect, story } from "../../storybook/playwright/story"

story("exposes a multi-digit value once, in reading order", async ({ mount }) => {
  const root = await mount("ui-animated-number--basic")
  const value = root.locator('[data-component="animated-number"]')

  await expect(value).toBeVisible()
  await expect(value).toMatchAriaSnapshot('- text: "12"')
})

story("keeps the digit strip out of the accessibility tree while a digit animates", async ({ mount }) => {
  const root = await mount("ui-animated-number--updating")
  const value = root.locator('[data-component="animated-number"]')
  const digit = value.locator('[data-slot="animated-number-digit"]').first()

  await expect(value).toMatchAriaSnapshot('- text: "5"')

  await root.getByRole("button", { name: "Increment" }).click()
  await expect(digit).toHaveAttribute("data-animating", "true")

  expect(await value.ariaSnapshot()).toBe('- text: "6"')
})
