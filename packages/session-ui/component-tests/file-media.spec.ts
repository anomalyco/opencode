import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./file-media.fixture.tsx", import.meta.url))

story("keeps a loaded image when re-reading the same file fails", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountFileMedia(), fixture)
  const root = page.getByTestId("file-media-fixture")
  await expect(root.getByRole("img", { name: "diagram.png" })).toBeVisible()

  await page.evaluate(async (fixture) => (await import(fixture)).controls.refreshFailing(), fixture)
  await expect(root.getByRole("img", { name: "diagram.png" })).toBeVisible()
})
