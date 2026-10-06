import { expect, story } from "../../storybook/playwright/story"

story("spaces an error between a shell result and expanded updates", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--error-and-updates")
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
