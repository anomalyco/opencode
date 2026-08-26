import { expect, test } from "@playwright/test"
import type { Locator } from "@playwright/test"

export { expect }

export const story = test.extend<{ mount: (id: string) => Promise<Locator> }>({
  mount: async ({ page }, use) => {
    await use(async (id) => {
      await page.goto(`/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`)
      const root = page.locator("#storybook-root")
      await expect(root).toBeVisible({ timeout: 30_000 })
      return root
    })
  },
})
