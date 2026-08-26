import { expect, story } from "../../storybook/playwright/story"

story("stops background shell progress and polling while the parent stays busy", async ({ mount, page }) => {
  await page.clock.install()
  const timeline = await mount("current-session-terminal-work--background-command")
  const shell = timeline.locator('[data-timeline-part-id="tool_background_shell"]')
  const shimmer = shell.locator('[data-component="text-shimmer"]')
  await expect(shimmer).toHaveAttribute("data-active", "true")
  await expect(shell).toContainText("Installing packages")
  const reads = timeline.getByLabel("Output reads")
  const before = Number(await reads.textContent())
  await page.clock.runFor(2_000)
  await expect(reads).toHaveText(String(before + 2))
  await timeline.getByRole("button", { name: "Complete command", exact: true }).click()
  await expect(shimmer).toHaveAttribute("data-active", "false")
  await expect(shell.locator('[data-slot="bash-result"]')).toHaveText("Installing packages\n2528 packages installed\n")
  const completed = await reads.textContent()
  await page.clock.runFor(3_000)
  await expect(reads).toHaveText(completed!)
  await timeline.getByRole("button", { name: "Remount command", exact: true }).click()
  await expect(shimmer).toHaveAttribute("data-active", "false")
  await expect(shell).toContainText("2528 packages installed")
})

story("loads an already finished background shell without showing progress", async ({ mount, page }) => {
  await page.clock.install()
  const timeline = await mount("current-session-terminal-work--background-command", { args: { completed: true } })
  const shell = timeline.locator('[data-timeline-part-id="tool_background_shell"]')
  await expect(shell.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "false")
  await expect(shell).toContainText("2528 packages installed")
  const reads = timeline.getByLabel("Output reads")
  await expect(reads).toHaveText("1")
  await page.clock.runFor(3_000)
  await expect(reads).toHaveText("1")
})

story("drains all finished output pages without repeating captured output", async ({ mount, page }) => {
  await page.clock.install()
  const timeline = await mount("current-session-terminal-work--background-command", {
    args: { completed: true, paged: true },
  })
  const shell = timeline.locator('[data-timeline-part-id="tool_background_shell"]')
  await expect(shell.locator('[data-slot="bash-result"]')).toHaveText("Installing packages\n2528 packages installed\n")
  await expect(timeline.getByLabel("Output reads")).toHaveText("2")
  await page.clock.runFor(3_000)
  await expect(timeline.getByLabel("Output reads")).toHaveText("2")
})

story("does not show model-facing background instructions as shell output", async ({ mount, page }) => {
  await page.clock.install()
  const timeline = await mount("current-session-terminal-work--background-command", {
    args: { completed: true, empty: true },
  })
  const shell = timeline.locator('[data-timeline-part-id="tool_background_shell"]')
  await expect(timeline.getByLabel("Output reads")).toHaveText("1")
  await expect(shell.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "false")
  await expect(shell.locator('[data-slot="bash-result"]')).toHaveCount(0)
  await expect(shell).not.toContainText("moved to the background")
})
