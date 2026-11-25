import { expect, story } from "../../stories/playwright/story"

story("reports a rejected async load instead of no results", async ({ mount }) => {
  const root = await mount("components-list--load-failed")

  await expect(root.locator('[data-slot="list-message"]')).toHaveText("Failed to load results")
})
