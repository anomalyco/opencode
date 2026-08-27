import { expect, story } from "../../storybook/playwright/story"

story("renders streamed reasoning without starting the app", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--streaming-reasoning-and-text")
  await expect(timeline.locator('[data-component="session-timeline"]')).toBeVisible()
  await timeline.locator('[data-component="reasoning-part"] [data-slot="collapsible-trigger"]').click()
  await expect(timeline.getByText("Checking the current contract", { exact: true })).toBeVisible()
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

// Moved from packages/app/e2e/regression/session-timeline-accessibility.spec.ts
story("space activates a focused timeline button instead of scrolling", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 800, height: 240 })
  const timeline = await mount("current-session-terminal-work--terminal-commands", { args: { scenario: "collapsed" } })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(0)
  const trigger = timeline.getByRole("button", { name: "Used 1 Shell", exact: true })
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.focus()
  const before = await page.evaluate(() => window.scrollY)
  await trigger.press("Space")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
})

// Moved from packages/app/e2e/regression/session-timeline-file-projection.spec.ts
story("renders a completed write through the production file component", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--changing-files", { args: { scenario: "write" } })
  await expect(
    timeline.locator('[data-timeline-part-id="prt_file_projection_write"] [data-component="write-content"]'),
  ).toBeVisible()
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
