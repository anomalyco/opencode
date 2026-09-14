import { expect, story } from "../../storybook/playwright/story"

story("keeps the comment options button pressed while its menu is open", async ({ mount, page }) => {
  const component = await mount("ui-line-comment--display")
  const trigger = component.locator('[data-slot="line-comment-v2-overflow"]')
  const rest = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor)

  await trigger.click()

  await expect(page.getByRole("menu")).toBeVisible()
  await expect(trigger).toHaveAttribute("data-expanded", "")
  await expect(trigger).not.toHaveCSS("background-color", rest)
})
