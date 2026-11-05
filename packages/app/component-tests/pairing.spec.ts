import { expect, story } from "../../stories/playwright/story"

story("a Keep screen active read that fails leaves the switch enabled, and flipping it tries again", async ({
  mount,
  page,
}) => {
  // The page reads three more times, 1, 2 and 4 seconds apart, before it shows the failure.
  await page.clock.install()
  const component = await mount("plugins-pairing--screen-setting-fails")
  const toggle = component.getByRole("switch", { name: "Keep screen active", exact: true })
  const error = component.getByRole("alert").filter({ hasText: "Could not update the screen activity setting." })

  await expect(toggle).toBeDisabled()
  await page.clock.runFor(8_000)
  await expect(error).toBeVisible()
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()

  await toggle.focus()
  await toggle.press("Space")
  await expect(toggle).toBeChecked()
  await expect(error).toHaveCount(0)
  await expect(toggle).toBeEnabled()
})
