import { expect, sourceURL, story } from "../../stories/playwright/story"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=",
  "base64",
)

const fixture = sourceURL(new URL("./markdown.fixture.tsx", import.meta.url))

story.beforeEach(async ({ mount }) => {
  const root = await mount("components-markdown--complete-response")
  await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
})

story("navigates a gallery and restores the clicked image on close", async ({ page }) => {
  await page.route("**/api/fs/read/**", (route) => route.fulfill({ contentType: "image/png", body: png }))
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({
      images: true,
      text: '<img src="one.png" alt="One">\n\n<img src="two.png" alt="Two">',
    })
  }, fixture)

  const harness = page.getByTestId("markdown-fixture").last()
  const images = harness.locator("img[data-local-image]")
  await expect(images).toHaveCount(2)

  for (const image of [images.nth(0), images.nth(1)]) {
    await expect
      .poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1)
  }

  await images.nth(0).click()
  const dialog = page.locator('[data-component="image-preview"]')
  const counter = dialog.locator('[data-slot="image-preview-counter"]')
  await expect(dialog).toBeVisible()
  await expect(counter).toHaveText("1 of 2")
  await expect(images.nth(0)).toHaveAttribute("data-image-preview-origin", "")

  await page.keyboard.press("ArrowRight")
  await expect(counter).toHaveText("2 of 2")
  await expect(images.nth(0)).not.toHaveAttribute("data-image-preview-origin", "")
  await expect(images.nth(1)).toHaveAttribute("data-image-preview-origin", "")

  await dialog.locator('[data-slot="image-preview-close"]').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator("[data-image-preview-origin]")).toHaveCount(0)
})

story("does not swallow arrow keys for a single image", async ({ page }) => {
  await page.route("**/api/fs/read/**", (route) => route.fulfill({ contentType: "image/png", body: png }))
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ images: true, text: '<img src="one.png" alt="One">' })
  }, fixture)

  const harness = page.getByTestId("markdown-fixture").last()
  const image = harness.locator("img[data-local-image]")
  await expect
    .poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1)
  await image.click()

  const dialog = page.locator('[data-component="image-preview"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-slot="image-preview-counter"]')).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })
      document.dispatchEvent(event)

      return event.defaultPrevented
    }),
  ).toBe(false)
})
