import { expect, sourceURL, story } from "../../stories/playwright/story"
import { writeFile } from "node:fs/promises"

const layoutFixture = sourceURL(new URL("./timeline-layout.fixture.tsx", import.meta.url))

// Windows draws the mixed Japanese and emoji prompt with fallback fonts that canvas measures slightly narrower, so it
// can wrap one line later there; its row corrects on mount. Every other row must match to the pixel.
const fallbackWrap = new Set(process.platform === "win32" ? ["user-message:layout-user-3"] : [])

story("models row heights before mounting and after width changes", async ({ mount, page }, testInfo) => {
  page.on("pageerror", (error) => console.error(error.stack))
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text())
  })
  await mount("current-session-timeline-rows--agent-thinking")
  await page.evaluate(async (url) => {
    const fixture = await import(url)
    await fixture.mountTimelineLayout(680)
  }, layoutFixture)
  const fixture = page.getByTestId("timeline-layout-fixture")
  await expect(fixture.locator('[data-component="markdown"][data-markdown-ready]')).toHaveCount(6)

  for (const width of [680, 370]) {
    const report = await page.evaluate(
      async ({ url, width }) => {
        const fixture = await import(url)

        return fixture.timelineLayoutReport(width)
      },
      { url: layoutFixture, width },
    )

    await writeFile(testInfo.outputPath(`row-layout-${width}.json`), JSON.stringify(report, null, 2))
    expect(report.length).toBeGreaterThanOrEqual(8)
    expect(report.filter((row: { source: string }) => row.source === "dom")).toEqual([])

    for (const row of report)
      expect(Math.abs(row.actual - row.expected), JSON.stringify(row)).toBeLessThanOrEqual(
        fallbackWrap.has(row.key) ? 22 : 1,
      )
  }

  const chunks = [
    "A streaming paragraph with **emphasis",
    "A streaming paragraph with **emphasis** and additional words.\n\n```ts\nconst value = 1",
    "A streaming paragraph with **emphasis** and additional words.\n\n```ts\nconst value = 1\nconsole.log(value)\n```\n\nDone.",
    "A streaming paragraph with **emphasis** and additional words.\n\n```ts\nconst value = 1\nconsole.log(value)\n```\n\nDone.\n\n- First result\n- Second result",
  ]

  for (const [index, text] of [...chunks, chunks.at(-1)!].entries()) {
    const report = await page.evaluate(
      async ({ url, text, complete }) => {
        const fixture = await import(url)

        return fixture.streamTimelineLayout(text, complete)
      },
      { url: layoutFixture, text, complete: index === chunks.length },
    )

    await writeFile(testInfo.outputPath(`row-stream-${index}.json`), JSON.stringify(report, null, 2))
    expect(report.filter((row: { source: string }) => row.source === "dom")).toEqual([])

    for (const row of report)
      expect(Math.abs(row.actual - row.expected), JSON.stringify(row)).toBeLessThanOrEqual(
        fallbackWrap.has(row.key) ? 22 : 1,
      )
  }

  const reasoning = await page.evaluate(async (url) => {
    const fixture = await import(url)

    return fixture.reasonTimelineLayout(
      "Consider the constraints carefully. ".repeat(8) +
        "\n\n**The next step**\n\nInspect the source and decide what needs to change.",
    )
  }, layoutFixture)

  await writeFile(testInfo.outputPath("row-reasoning.json"), JSON.stringify(reasoning, null, 2))
  expect(reasoning.filter((row: { source: string }) => row.source === "dom")).toEqual([])

  for (const row of reasoning)
    expect(Math.abs(row.actual - row.expected), JSON.stringify(row)).toBeLessThanOrEqual(
      fallbackWrap.has(row.key) ? 22 : 1,
    )
})

story("spaces an error between a shell result and expanded updates", async ({ mount }) => {
  const timeline = await mount("current-session-error-spacing--error-and-updates")
  const shell = timeline.locator('[data-component="bash-output"]')
  const error = timeline.locator('[data-kind="session-error-card"]')
  const updates = timeline.locator('[data-component="collapsed-tool-group"] [data-slot="collapsible-trigger"]')
  const shellBox = (await shell.boundingBox())!
  const errorBox = (await error.boundingBox())!
  const updatesBox = (await updates.boundingBox())!
  expect(errorBox.y - (shellBox.y + shellBox.height)).toBe(24)
  expect(updatesBox.y - (errorBox.y + errorBox.height)).toBe(8)
  expect(updatesBox.x).toBe(errorBox.x)
  await updates.click()
  const notice = timeline.locator('[data-slot="session-timeline-notice"]')
  await expect(notice).toContainText("Instructions updated")
  const expandedBox = (await updates.boundingBox())!
  expect((await notice.boundingBox())!.y - (expandedBox.y + expandedBox.height)).toBe(0)
  expect((await notice.boundingBox())!.x - expandedBox.x).toBe(12)
  expect(expandedBox.height).toBe(28)
})

for (const streaming of [false, true]) {
  story(`renders Mermaid in the ${streaming ? "streaming" : "completed"} timeline`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    const root = await mount("current-session-mermaid--diagrams", { args: { streaming } })
    const timeline = root.locator('[data-component="session-timeline"]')
    const diagrams = timeline.locator('[data-component="markdown-mermaid"] > svg')
    await expect(diagrams).toHaveCount(2)
    await expect(diagrams.nth(0)).toBeVisible()
    await expect(diagrams.nth(0)).toContainText("Client")
    await expect(diagrams.nth(1)).toBeVisible()
    await expect(diagrams.nth(1)).toContainText("Send prompt")
    await expect(timeline.locator('[data-mermaid-ready="true"]')).toHaveCount(2)
    await expect(timeline.locator('[data-mermaid-ready="true"] > pre:visible')).toHaveCount(0)

    if (streaming) {
      await root.getByRole("button", { name: "Complete response" }).click()
      await expect(timeline.locator('[data-markdown-complete="true"]')).toHaveCount(2)
      await expect(diagrams).toHaveCount(2)
      await expect(diagrams.nth(0)).toBeVisible()
      await expect(diagrams.nth(1)).toBeVisible()
    }
  })
}

story("aligns the retry icon with the error label", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--provider-retry")
  const card = timeline.locator('[data-kind="session-retry-card"]')
  const icon = card.locator('[data-slot="icon-svg"]')
  const label = card.locator('[data-slot="session-turn-retry-message"]')
  await expect(icon).toBeVisible()
  await expect(label).toBeVisible()

  const [iconY, labelY] = await Promise.all([
    icon.evaluate((element) => element.getBoundingClientRect().y),
    label.evaluate((element) => element.getBoundingClientRect().y),
  ])

  expect(iconY).toBe(labelY)
})

story("centers the error icon on the first line of short and wrapped errors", async ({ mount }) => {
  const timeline = await mount("current-session-error-card--provider-errors")
  const cards = timeline.locator('[data-kind="session-error-card"]')

  await expect(cards).toHaveCount(2)

  const geometry = await cards.evaluateAll((elements) =>
    elements.map((card) => {
      const icon = card.querySelector('[data-slot="icon-svg"]')!.getBoundingClientRect()
      const message = card.querySelector('[data-slot="icon-svg"] + div')!
      const line = parseFloat(getComputedStyle(message).lineHeight)
      const box = message.getBoundingClientRect()

      return {
        lines: Math.round(box.height / line),
        offset: icon.top + icon.height / 2 - (box.top + line / 2),
      }
    }),
  )

  expect(geometry.map((card) => card.lines > 1)).toEqual([false, true])
  geometry.forEach((card) => expect(card.offset).toBeCloseTo(0, 0))
})

// Moved from packages/app/e2e/regression/session-timeline-context-state.spec.ts
story("preserves a collapsed context group through count and status updates", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "exploration" } })
  const group = timeline.locator('[data-timeline-part-ids="tool_context_read,tool_context_glob"]')
  const trigger = group.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.getByRole("button", { name: "Complete read" }).click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.getByRole("button", { name: "Complete glob" }).click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})

// Moved from packages/app/e2e/regression/session-timeline-file-projection.spec.ts
story("renders a completed write through the production file component", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--changing-files", { args: { scenario: "write" } })
  const write = timeline.locator('[data-timeline-part-id="prt_file_projection_write"]')
  const file = write.getByRole("button", { name: /write\.ts/ })
  await expect(file).toHaveAttribute("aria-expanded", "false")
  await file.click()
  await expect(write.locator('[data-component="file"]')).toContainText("export const written = true")
})

// Moved from packages/app/e2e/regression/session-timeline-file-state.spec.ts
story("keeps patch file disclosures independent", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--changing-files", { args: { scenario: "patch" } })
  const wrapper = timeline.locator('[data-timeline-part-id="prt_nested_patch"]')
  const modified = wrapper.locator('[data-scope="apply-patch"] [data-type="update"] button')
  const added = wrapper.locator('[data-scope="apply-patch"] [data-type="add"] button')
  const deleted = wrapper.locator('[data-scope="apply-patch"] [data-type="delete"] button')
  await expect(wrapper.locator('[data-scope="apply-patch"] [aria-expanded="false"]')).toHaveCount(3)
  await deleted.click()
  await expect(deleted).toHaveAttribute("aria-expanded", "true")
  await expect(modified).toHaveAttribute("aria-expanded", "false")
  await modified.click()
  await expect(modified).toHaveAttribute("aria-expanded", "true")
  await deleted.click()
  await expect(deleted).toHaveAttribute("aria-expanded", "false")
  await expect(modified).toHaveAttribute("aria-expanded", "true")
  await expect(added).toHaveAttribute("aria-expanded", "false")
  await added.click()
  await expect(added).toHaveAttribute("aria-expanded", "true")
  await expect(modified).toHaveAttribute("aria-expanded", "true")
  await expect(deleted).toHaveAttribute("aria-expanded", "false")
})
