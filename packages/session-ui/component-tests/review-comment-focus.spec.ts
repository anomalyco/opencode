import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./review-comment-focus.fixture.tsx", import.meta.url))

story("keeps typing in a draft comment when the file changes", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountReview(), fixture)
  const root = page.getByTestId("review-fixture")
  await root.locator('[data-line-type="change-addition"] [data-diff-span]').first().click()
  const textbox = root.getByRole("textbox")
  await expect(textbox).toBeFocused()
  await page.keyboard.type("Keep this")

  await page.evaluate(async (fixture) => (await import(fixture)).controls.edit(), fixture)
  await expect(root.locator('[data-line="2"][data-line-type="change-addition"]')).toContainText("after 1")
  await expect(textbox).toBeFocused()
  await page.keyboard.type(" name")
  await expect(textbox).toHaveValue("Keep this name")
})

story("leaves focus where the user moved it when the file changes", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountReview(), fixture)
  const root = page.getByTestId("review-fixture")
  await root.locator('[data-line-type="change-addition"] [data-diff-span]').first().click()
  const textbox = root.getByRole("textbox")
  await expect(textbox).toBeFocused()
  await page.mouse.click(780, 700)
  await expect(textbox).not.toBeFocused()

  await page.evaluate(async (fixture) => (await import(fixture)).controls.edit(), fixture)
  await expect(root.locator('[data-line="2"][data-line-type="change-addition"]')).toContainText("after 1")
  await expect(textbox).not.toBeFocused()
})
