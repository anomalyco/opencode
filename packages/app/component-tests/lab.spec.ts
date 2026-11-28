import { expect, story } from "../../stories/playwright/story"

story("opens a page from the standalone Lab and previews its states", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("tree")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: /Search pages/ }).click()

  const search = page.getByPlaceholder("Search pages")

  await search.fill("Composer docks")
  await search.press("Enter")
  await page.getByText("Queue Three", { exact: true }).click()
  await expect(page.getByText("Rename the Alpha export", { exact: true })).toBeVisible()
})

story("edits a page's state argument from the inspector", async ({ page }) => {
  await page.goto("/?page=../../app/src/composer/composer-touch.lab.tsx")
  await page
    .getByRole("region", { name: "lab controls" })
    .getByRole("button", { name: "state", exact: true })
    .click()
  await page.getByRole("menuitemradio", { name: "shell", exact: true }).click()
  await expect(page.getByLabel("Composer state", { exact: true })).toHaveValue("shell")
})
