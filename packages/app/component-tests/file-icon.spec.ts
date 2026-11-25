import { expect, story } from "../../stories/playwright/story"

story("shows the fallback glyph when an icon chunk fails to load", async ({ mount, page }) => {
  await page.route("**/file-types/typescript.svg*", (route) => route.abort())
  const root = await mount("components-file-icon--samples")

  await expect(
    root
      .locator("div")
      .filter({ hasText: /^index\.ts$/ })
      .locator("use"),
  ).toHaveAttribute("href", "#file-icon-Document")
  await expect(page.locator("#file-icon-sprite > #file-icon-Document")).toHaveCount(1)
})
