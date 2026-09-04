import { expect, test } from "@playwright/test"
import type { Locator } from "@playwright/test"

export { expect }

export const story = test.extend<{
  mount: (
    id: string,
    options?: { args?: Record<string, string | boolean>; globals?: Record<string, string> },
  ) => Promise<Locator>
}>({
  mount: async ({ page }, use) => {
    await use(async (id, options) => {
      const query = new URLSearchParams({ id, viewMode: "story" })
      if (options?.args) {
        query.set(
          "args",
          Object.entries(options.args)
            .map(([key, value]) => `${key}:${value}`)
            .join(";"),
        )
      }
      if (options?.globals) {
        query.set(
          "globals",
          Object.entries(options.globals)
            .map(([key, value]) => `${key}:${value}`)
            .join(";"),
        )
      }
      await page.goto(`/iframe.html?${query}`)
      const root = page.locator("#storybook-root")
      await expect(root).toBeVisible({ timeout: 30_000 })
      return root
    })
  },
})
