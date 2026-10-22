import { expect, sourceURL, story } from "../../stories/playwright/story"
import { writeFile } from "node:fs/promises"

const fixture = sourceURL(new URL("./timeline-virtualizer.fixture.tsx", import.meta.url))
const pretextFixture = sourceURL(new URL("./timeline-pretext.fixture.tsx", import.meta.url))

story("precomputes the full extent of 5000 rows before revealing or jumping", async ({ page }, testInfo) => {
  await page.evaluate(async (url) => {
    ;(await import(url)).mountLongTimeline()
  }, pretextFixture)
  const root = page.getByTestId("pretext-long-timeline")
  await expect(root.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
  const initial = await page.evaluate(async (url) => (await import(url)).longTimelineReport(), pretextFixture)
  await writeFile(testInfo.outputPath("long-initial.json"), JSON.stringify(initial, null, 2))
  expect(initial.count).toBeGreaterThan(5000)
  expect(initial.fallbacks).toBe(0)
  expect(Math.abs(initial.extent - initial.expected)).toBeLessThanOrEqual(1)
  expect(Math.abs(initial.offset - (initial.extent - initial.viewport))).toBeLessThanOrEqual(1)
  expect(initial.mounted).toBeLessThan(30)
  expect(initial.mismatches).toEqual([])
  for (const index of [0, 900, 1799, 451]) {
    const immediate = await page.evaluate(async ({ url, index }) => (await import(url)).jumpLongTimeline(index), {
      url: pretextFixture,
      index,
    })
    await expect(root.locator(`[data-timeline-key="user-message:long-user-${index}"]`)).toBeVisible()
    const painted = await page.evaluate(async (url) => (await import(url)).longTimelineReport(), pretextFixture)
    await writeFile(testInfo.outputPath(`jump-${index}.json`), JSON.stringify({ immediate, painted }, null, 2))
    expect(Math.abs(painted.extent - initial.extent)).toBeLessThanOrEqual(1)
    expect(Math.abs(painted.offset - immediate.offset)).toBeLessThanOrEqual(1)
    expect(painted.mismatches).toEqual([])
  }
})

story.beforeEach(async ({ mount }) => {
  await mount("ui-button--playground")
})

story("reveals mixed modeled and measured rows without starving input", async ({ page }) => {
  await page.evaluate(async (url) => {
    const { mountTimelineVirtualizer } = await import(url)
    mountTimelineVirtualizer({ count: 4, rowHeight: 44, modeled: 2, immediate: true })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
  await expect(root.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
  await root.getByRole("button", { name: "Hide viewport", exact: true }).click()
  await expect(root.locator("[data-scrollable]")).toBeHidden()
})

story("animates only the final screen when resuming from deep history", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.evaluate(async (url) => {
    const { mountTimelineVirtualizer } = await import(url)
    mountTimelineVirtualizer({ count: 1000, rowHeight: 64, modeled: 1000, viewportHeight: 300, immediate: true })
  }, fixture)
  const root = page.getByTestId("timeline-virtualizer-fixture")
  await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
  await expect(root.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
  const returnGap = await root.evaluate((host) => {
    const viewport = host.querySelector<HTMLElement>("[data-scrollable]")!
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -60000, bubbles: true }))
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event("scroll"))
    host.querySelector<HTMLButtonElement>('[data-testid="resume"]')!.click()
    return { gap: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop, viewport: viewport.clientHeight }
  })
  expect(returnGap.gap).toBeGreaterThan(0)
  expect(returnGap.gap).toBeLessThanOrEqual(returnGap.viewport + 1)
  await expect
    .poll(() =>
      root
        .locator("[data-scrollable]")
        .evaluate((viewport) => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop),
    )
    .toBeLessThanOrEqual(1)
})

for (const action of ["wheel", "resume", "resume-removal", "follow", "backlog", "unpinned"] as const) {
  story(`keeps in-flight row growth continuous during ${action}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.evaluate(
      async ({ url, action }) => {
        const { mountTimelineVirtualizer } = await import(url)
        mountTimelineVirtualizer({
          count: 10,
          rowHeight: 64,
          viewportHeight: 300,
          growthRows: action === "backlog" ? 3 : 1,
        })
      },
      { url: fixture, action },
    )
    const root = page.getByTestId("timeline-virtualizer-fixture")
    await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
    await expect(root.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    const growing = root.locator('[data-timeline-key="user-message:message-8"]')
    await expect(growing).toHaveCSS("height", "64px")
    const change = await root.evaluate(async (host, action) => {
      const viewport = host.querySelector<HTMLElement>("[data-scrollable]")!
      const row = host.querySelector<HTMLElement>('[data-timeline-key="user-message:message-8"]')!
      const next = host.querySelector<HTMLElement>('[data-timeline-key="user-message:message-9"]')!
      const content = host.querySelector<HTMLElement>("[data-timeline-virtual-content]")!
      return new Promise<{
        before: { height: number; top: number; extent: number }
        after: { height: number; top: number; extent: number }
        rise: number
      }>((resolve) => {
        let change:
          | {
              before: { height: number; top: number; extent: number }
              after: { height: number; top: number; extent: number }
              rise: number
            }
          | undefined
        const observer = new ResizeObserver(() => {
          if (row.getBoundingClientRect().height <= 64) return
          if (change) {
            change.rise = Math.max(change.rise, next.getBoundingClientRect().top - change.after.top)
            if (row.getBoundingClientRect().height < 184) return
            observer.disconnect()
            resolve(change)
            return
          }
          if (action === "resume-removal" || action === "follow") {
            viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -90, bubbles: true }))
            viewport.scrollTop -= 90
            viewport.dispatchEvent(new Event("scroll"))
          }
          const before = {
            height: row.getBoundingClientRect().height,
            top: next.getBoundingClientRect().top,
            extent: content.getBoundingClientRect().height,
          }
          if (action !== "backlog" && action !== "resume-removal" && action !== "follow")
            viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -90, bubbles: true }))
          if (action.startsWith("resume")) host.querySelector<HTMLButtonElement>('[data-testid="resume"]')!.click()
          if (action === "follow") host.querySelector<HTMLButtonElement>('[data-testid="follow"]')!.click()
          if (action === "resume-removal") host.querySelector<HTMLButtonElement>('[data-testid="remove-row"]')!.click()
          change = {
            before,
            after: {
              height: row.getBoundingClientRect().height,
              top: next.getBoundingClientRect().top,
              extent: content.getBoundingClientRect().height,
            },
            rise: 0,
          }
          if (action.startsWith("resume") && change.after.height < 184) return
          observer.disconnect()
          resolve(change)
        })
        observer.observe(row)
        if (action === "unpinned") viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -90, bubbles: true }))
        host.querySelector<HTMLButtonElement>('[data-testid="grow-row"]')!.click()
      })
    }, action)
    expect(change.before.height).toBeLessThan(184)
    expect(Math.abs(change.after.height - change.before.height)).toBeLessThanOrEqual(1 / 64)
    expect(Math.abs(change.after.top - change.before.top)).toBeLessThanOrEqual(1 / 64)
    expect(Math.abs(change.after.extent - change.before.extent)).toBeLessThanOrEqual(1 / 64)
    expect(change.rise).toBeLessThanOrEqual(1 / 64)
    await expect(root.getByTestId("timeline-controls")).toHaveAttribute(
      "data-pinned",
      String(action !== "wheel" && action !== "unpinned"),
    )
    await expect(growing).toHaveCSS("height", "184px")
  })
}

for (const height of [64, 512]) {
  story(`starts new unpinned ${height}px rows at zero height before their first measurement`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.evaluate(
      async ({ url, height }) => {
        const { mountTimelineVirtualizer } = await import(url)
        mountTimelineVirtualizer({ count: 10, rowHeight: 64, modeled: 11, viewportHeight: 300, insertedHeight: height })
      },
      { url: fixture, height },
    )
    const root = page.getByTestId("timeline-virtualizer-fixture")
    await root.getByRole("button", { name: "Complete Markdown", exact: true }).click()
    await expect(root.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    const first = await root.evaluate((host) => {
      const viewport = host.querySelector<HTMLElement>("[data-scrollable]")!
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }))
      const next = host.querySelector<HTMLElement>('[data-timeline-key="user-message:message-9"]')!
      const top = next.getBoundingClientRect().top
      host.querySelector<HTMLButtonElement>('[data-testid="insert-row"]')!.click()
      const row = host.querySelector<HTMLElement>('[data-timeline-key="user-message:inserted"]')!
      return { height: row.getBoundingClientRect().height, travel: next.getBoundingClientRect().top - top }
    })
    expect(first.height).toBe(0)
    expect(Math.abs(first.travel)).toBeLessThanOrEqual(1 / 64)
    await expect(root.locator('[data-timeline-key="user-message:inserted"]')).toHaveCSS("height", `${height}px`)
    await expect(root.locator('[data-timeline-key="user-message:inserted"]')).toHaveCSS("opacity", "1")
  })
}

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
  { name: "offset-only", count: 1, rowHeight: 600, reveal: { scrollTop: 0 } },
  { name: "zero-height", count: 4, rowHeight: 60, reveal: {} },
]) {
  story(
    `reveals ready measured rows after an ${input.name} reconnect${input.name === "offset-only" ? " @quarantine" : ""}`,
    async ({ page }) => {
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
        await expect(root).toHaveAttribute("data-last-scroll-top", "502")
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
    },
  )
}
