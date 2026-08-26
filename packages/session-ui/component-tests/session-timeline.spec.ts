import { expect, story } from "../../storybook/playwright/story"

story("renders streamed reasoning without starting the app", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--streaming-reasoning-and-text")
  await expect(timeline.locator('[data-component="session-timeline"]')).toBeVisible()
  await expect(timeline.getByText("Checking the current contract", { exact: true })).toBeVisible()
})

// Moved from packages/app/e2e/regression/session-timeline-context-state.spec.ts
story("preserves a collapsed context group through count and status updates", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--explore-the-codebase")
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
  const timeline = await mount("current-session-terminal-work--collapsed-shell")
  const trigger = timeline.locator('[data-timeline-part-id="tool_terminal_passed"] [data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.focus()
  const before = await page.evaluate(() => window.scrollY)
  await trigger.press("Space")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
})

// Moved from packages/app/e2e/regression/session-timeline-file-projection.spec.ts
story("renders a completed write through the production file component", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--created-a-new-file")
  await expect(timeline.locator('[data-component="write-content"]')).toBeVisible()
})

// Moved from packages/app/e2e/regression/session-timeline-file-state.spec.ts
story("keeps patch file disclosures independent", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--patched-two-files")
  const files = timeline.locator('[data-scope="apply-patch"] button')
  await expect(files).toHaveCount(2)
  await expect(files.nth(0)).toHaveAttribute("aria-expanded", "false")
  await expect(files.nth(1)).toHaveAttribute("aria-expanded", "false")
  await files.nth(0).click()
  await expect(files.nth(0)).toHaveAttribute("aria-expanded", "true")
  await expect(files.nth(1)).toHaveAttribute("aria-expanded", "false")
  await files.nth(1).click()
  await expect(files.nth(0)).toHaveAttribute("aria-expanded", "true")
  await expect(files.nth(1)).toHaveAttribute("aria-expanded", "true")
})
