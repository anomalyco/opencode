import { expect, story } from "../../stories/playwright/story"

story("shows the fallback glyph while an icon chunk fails and upgrades it when the retry loads", async ({
  mount,
  page,
}) => {
  // The first request fails; the retry waits until the fallback was seen, so the 2 s retry cannot race the check.
  const retry = Promise.withResolvers<void>()
  const requests: string[] = []
  await page.route("**/file-types/typescript.svg*", async (route) => {
    requests.push(route.request().url())

    if (requests.length === 1) return route.abort()
    await retry.promise
    await route.continue()
  })
  const root = await mount("components-file-icon--samples")
  const icon = root.locator("div").filter({ hasText: /^index\.ts$/ }).locator("use")

  await expect(icon).toHaveAttribute("href", "#file-icon-Document")
  await expect(page.locator("#file-icon-sprite > #file-icon-Document")).toHaveCount(1)
  await expect.poll(() => requests.length).toBe(2)

  retry.resolve()
  await expect(icon).toHaveAttribute("href", "#file-icon-Typescript")
  await expect(page.locator("#file-icon-sprite > #file-icon-Typescript")).toHaveCount(1)
})
