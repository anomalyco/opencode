import { expect, story } from "../../stories/playwright/story"

story("opens a component from the standalone catalog and previews its states", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("tree")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: /Search components/ }).click()

  const search = page.getByPlaceholder("Search components")

  await search.fill("Composer docks")
  await search.press("Enter")
  await page.getByText("Queue Three", { exact: true }).click()
  await expect(page.getByText("Rename the Alpha export", { exact: true })).toBeVisible()
})

story("edits a story's state argument from the inspector", async ({ page }) => {
  await page.goto("/?story=../../app/src/composer/composer-touch.stories.tsx")
  await page
    .getByRole("region", { name: "components-lab controls" })
    .getByRole("button", { name: "state", exact: true })
    .click()
  await page.getByRole("menuitemradio", { name: "shell", exact: true }).click()
  await expect(page.getByLabel("Composer state", { exact: true })).toHaveValue("shell")
})
