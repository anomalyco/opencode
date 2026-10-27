import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./file-viewer.fixture.tsx", import.meta.url))

story("updates a text file in place when its props change", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(40), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="40"]')).toHaveCount(1)
  await page.evaluate(async (fixture) => (await import(fixture)).controls.keepHost(), fixture)

  await page.evaluate(async (fixture) => (await import(fixture)).controls.setOverflow("scroll"), fixture)
  await expect(root.locator('pre[data-overflow="scroll"]')).toHaveCount(1)
  await page.evaluate(async (fixture) => (await import(fixture)).controls.append("const appended = true\n"), fixture)
  await expect(root.locator('[data-line="41"]')).toContainText("appended")

  expect(await page.evaluate(async (fixture) => (await import(fixture)).controls.sameHost(), fixture)).toBe(true)
})

story("windows a medium text file and keeps selection and comment marks", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(480), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="1"]')).toBeInViewport()
  expect(await root.locator("[data-line]").count()).toBeLessThan(200)

  await page.evaluate(async (fixture) => {
    const { controls } = await import(fixture)
    controls.setSelected({ start: 3, end: 5 })
    controls.setCommented([{ start: 8, end: 8 }])
  }, fixture)
  await expect(root.locator("[data-line][data-selected-line]")).toHaveCount(3)
  await expect(root.locator('[data-line="8"][data-comment-selected]')).toHaveCount(1)

  // File links jump by setting the scroll offset from the line number; the window must follow it.
  await root.evaluate((element) => (element.scrollTop = (400 - 4) * 24))
  await expect(root.locator('[data-line="400"]')).toBeInViewport()
})

story("scrolls a virtualized diff to an off-screen selection", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountDiffViewer(480), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="1"]').first()).toBeVisible()
  await expect(root.locator('[data-line="400"]')).toHaveCount(0)

  await page.evaluate(
    async (fixture) => (await import(fixture)).controls.setSelected({ start: 400, end: 400, side: "additions" }),
    fixture,
  )
  await expect(root.locator('[data-line="400"][data-selected-line]').first()).toBeInViewport()
})
