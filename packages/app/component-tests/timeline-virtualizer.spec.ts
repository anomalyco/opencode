import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./timeline-virtualizer.fixture.tsx", import.meta.url))

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

story("treats the reachable end as the end under page zoom", async ({ page }) => {
  // At 110% the browser stops scrolling more than a pixel short of scrollHeight - clientHeight. A mount that waited
  // for that distance to close stayed blank, or froze the renderer in a microtask loop, and scrolling back down to
  // the bottom never resumed following.
  await page.evaluate(async (fixture) => {
    document.documentElement.style.zoom = "1.1"
    const { mountTimelineVirtualizer } = await import(fixture)
    mountTimelineVirtualizer({ count: 4, rowHeight: 59.3, immediate: true, viewportHeight: 200.5 })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  const content = root.locator("[data-timeline-virtual-content]")
  await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
  await expect(content).toHaveCSS("visibility", "visible")
  const viewport = root.locator("[data-scrollable]")
  expect(
    await viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
  ).toBeGreaterThan(1)

  const controls = root.getByTestId("timeline-controls")
  await viewport.dispatchEvent("wheel", { deltaY: -1 })
  await expect(controls).toHaveAttribute("data-pinned", "false")

  for (const top of [40, Number.MAX_SAFE_INTEGER])
    await viewport.evaluate(
      (element, top) =>
        new Promise((resolve) => {
          element.addEventListener("scroll", resolve, { once: true })
          element.scrollTop = top
        }),
      top,
    )
  await expect(controls).toHaveAttribute("data-pinned", "true")
})

for (const input of [
  { name: "offset-only", count: 1, rowHeight: 600, reveal: { scrollTop: 0 } },
  { name: "zero-height", count: 4, rowHeight: 60, reveal: {} },
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
      // Pinned to the end: the 600px row and the virtualizer's 86px tail, less the 180px viewport.
      await expect(root).toHaveAttribute("data-last-scroll-top", "506")
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
      ...input.reveal,
    })

    if (input.name === "offset-only") {
      // This repair must not depend on another native scroll or resize delivery.
      await expect(root).toHaveAttribute("data-scrolls", "0")
      await expect(root).toHaveAttribute("data-viewport-resizes", resizes!)
    }
  })
}
