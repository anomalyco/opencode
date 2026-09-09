import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./timeline-virtualizer.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story.beforeEach(async ({ mount }) => {
  const component = await mount("opencode-composer-flow--mixed-attachments")
  await expect(component.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible()
})

story("spaces the first mobile message without changing desktop spacing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async (fixture) => {
    const { mountTimelineVirtualizer } = await import(fixture)
    mountTimelineVirtualizer({ count: 1, rowHeight: 60, immediate: true })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
  const content = root.locator("[data-timeline-virtual-content]")
  await expect(content).toHaveCSS("visibility", "visible")
  const gap = () =>
    root.locator('[data-timeline-key="user-message:message-0"]').evaluate((element) => {
      const viewport = element.closest("[data-scrollable]")!
      return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    })
  await expect.poll(gap).toBe(16)
  await root.evaluate((element) => element.setAttribute("dir", "rtl"))
  await expect.poll(gap).toBe(16)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect.poll(gap).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(gap).toBe(16)
})

story("bounds the cheap suffix and reveals only ready measured rows", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountTimelineVirtualizer } = await import(fixture)
    mountTimelineVirtualizer({ count: 100, rowHeight: 60, immediate: true })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  const content = root.locator("[data-timeline-virtual-content]")
  await expect(root).toHaveAttribute("data-observed-height", "180")
  await expect(content).toHaveCSS("visibility", "hidden")
  await expect(content.locator("[data-timeline-key]")).toHaveCount(4)
  await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
  await expect(content).toHaveCSS("visibility", "visible")
  await expect(root).toHaveAttribute("data-first-reveal", /.+/)
  expect(await root.evaluate((element) => JSON.parse(element.dataset.firstReveal!))).toMatchObject({
    rows: [96, 97, 98, 99],
    pendingMarkdown: 0,
    clipped: [],
    viewportHeight: 180,
  })
})

for (const input of [
  { name: "offset-only", count: 1, rowHeight: 600 },
  { name: "zero-height", count: 4, rowHeight: 60 },
]) {
  story(`reveals ready measured rows after an ${input.name} reconnect`, async ({ page }) => {
    await page.evaluate(
      async ({ fixture, input }) => {
        const { mountTimelineVirtualizer } = await import(fixture)
        mountTimelineVirtualizer(input)
      },
      { fixture, input },
    )
    const root = page.getByTestId("timeline-virtualizer-fixture")
    const content = root.locator("[data-timeline-virtual-content]")
    await expect(root).toHaveAttribute("data-observed-height", "180")
    await expect(content).toHaveCSS("visibility", "hidden")
    await expect(content.locator("[data-timeline-key]")).toHaveCount(1)

    if (input.name === "offset-only") {
      await expect(root).toHaveAttribute("data-last-scroll-top", "484")
      await root.locator("[data-scrollable]").dispatchEvent("wheel", { deltaY: -1 })
      await expect(root.getByTestId("timeline-controls")).toHaveAttribute("data-pinned", "false")
    }
    if (input.name === "zero-height") {
      await root.getByRole("button", { name: "Hide viewport", exact: true }).click()
      // Wait for ResizeObserver to clear the actual range, not just for display:none.
      await expect(root).toHaveAttribute("data-observed-height", "0")
      await expect(content.locator("[data-timeline-key]")).toHaveCount(0)
    }
    await expect(root).not.toHaveAttribute("data-first-reveal")
    const resizes = await root.getAttribute("data-viewport-resizes")
    await root.getByRole("button", { name: "Reconnect ready rows", exact: true }).click()
    await expect(content).toHaveCSS("visibility", "visible")
    await expect(root).toHaveAttribute("data-first-reveal", /.+/)
    expect(await root.evaluate((element) => JSON.parse(element.dataset.firstReveal!))).toMatchObject({
      rows: input.count === 1 ? [0] : [0, 1, 2, 3],
      pendingMarkdown: 0,
      clipped: [],
      viewportHeight: 180,
      ...(input.name === "offset-only" ? { scrollTop: 0 } : {}),
    })
    if (input.name === "offset-only") {
      // This repair must not depend on another native scroll or resize delivery.
      await expect(root).toHaveAttribute("data-scrolls", "0")
      await expect(root).toHaveAttribute("data-viewport-resizes", resizes!)
    }
  })
}
