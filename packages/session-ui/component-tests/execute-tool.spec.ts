import { expect, story } from "../../storybook/playwright/story"

story("shows Code Mode child calls and expands their inputs", async ({ mount }) => {
  const timeline = await mount("current-session-terminal-work--execute-code")
  const calls = timeline.locator('[data-component="execute-tool-call"]')
  await expect(calls).toHaveCount(3)

  const completed = calls.nth(0)
  const trigger = completed.getByRole("button")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toContainText("planetscale.planetscale_execute_write_query")
  await expect(trigger).toContainText("organization=anomalyco")

  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(completed.locator("dt")).toHaveText([
    "organization",
    "database",
    "branch",
    "confirm_destructive",
    "query",
  ])
  await expect(completed.locator("dd")).toContainText([
    "anomalyco",
    "opencode",
    "production",
    "true",
    "UPDATE workspace",
  ])
  await expect(calls.nth(2)).toHaveAttribute("data-status", "completed")
})
