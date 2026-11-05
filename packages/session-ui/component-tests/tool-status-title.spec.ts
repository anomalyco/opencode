import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./tool-status-title.fixture.tsx", import.meta.url))

story("shows a title that finished in a hidden tab at once when the tab shows again", async ({ mount, page }) => {
  await mount("components-animated-count-list--completed")

  const width = await page.evaluate(async (fixture) => {
    const { mountToolStatusTitle } = await import(fixture)
    const title = mountToolStatusTitle()
    title.setHidden(true)
    title.setActive(false)
    // The title measures its new width on the next frame.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    title.setHidden(false)

    return document.querySelector<HTMLElement>(
      '[data-testid="tool-status-title-fixture"] [data-slot="tool-status-swap"]',
    )!.style.width
  }, fixture)

  // Before the machine, the hidden title measured 0px and kept that width, clipping "Explored" for 600 ms.
  expect(width).toBe("")
  const title = page.getByTestId("tool-status-title-fixture").locator('[data-component="tool-status-title"]')
  await expect(title).toHaveAttribute("data-ready", "false")
  await expect(title.getByText("Explored", { exact: true })).toBeVisible()
})
