import { expect, test } from "@playwright/test"
import { openSettings } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 } })

test("an unknown path renders Home instead of crashing", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await openSettings(page, { name: "Routes", seed: { tabs: [] } })

  await page.goto("/foo")

  await expect(page.locator('[data-slot="home-panel"]')).toBeVisible()
  expect(errors).toEqual([])
})
