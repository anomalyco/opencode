import { expect, story } from "../../storybook/playwright/story"

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("renders current protocol notices in CLI order", async ({ mount, page }) => {
  const warnings: string[] = []
  page.on("console", (message) => {
    if (message.text().includes("computations created outside a `createRoot` or `render`"))
      warnings.push(message.text())
  })
  const timeline = await mount("current-session-timeline-rows--agent-activity-notices")
  const notices = timeline.locator('[data-slot="session-timeline-notice"]')
  await expect(notices).toHaveCount(4)
  await expect(notices.nth(0)).toContainText("Agent · explore")
  await expect(notices.nth(1)).toContainText("explore finished · Search code")
  await expect(notices.nth(2)).toContainText("Continuing after restart")
  await expect(notices.nth(3)).toContainText("Skill · Review")
  await expect(notices).toHaveClass([/text-text-weak/, /text-text-weak/, /text-text-weak/, /text-text-weak/])
  await expect(notices.locator(".text-text-strong")).toHaveCount(0)
  expect(warnings).toEqual([])
})

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("renders a compaction summary while it streams and after completion", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--compact-session")
  const compaction = timeline.locator('[data-component="session-compaction-message"]')
  await expect(compaction.getByText("Session compacted", { exact: true })).toBeVisible()
  await timeline.getByRole("button", { name: "Stream summary" }).click()
  await expect(compaction.getByRole("heading", { name: "Checkpoint" })).toBeVisible()
  await expect(compaction).toContainText("Streamed implementation details.")
  await timeline.getByRole("button", { name: "Complete summary" }).click()
  await expect(compaction).toContainText("Final implementation details.")
  await expect(compaction).not.toContainText("Streamed implementation details.")
})

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("updates running compactions to failed and cancelled boundaries", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--compact-session")
  await timeline.getByRole("button", { name: "Stream summary" }).click()
  await timeline.getByRole("button", { name: "Fail compaction" }).click()
  const compactions = timeline.locator('[data-component="session-compaction-message"]')
  const failed = compactions.filter({ hasText: "The provider rejected the summary." })
  await expect(failed.getByText("Session compacted", { exact: true })).toBeVisible()
  await expect(failed.getByText("ProviderError: The provider rejected the summary.", { exact: true })).toBeVisible()
  await expect(failed).not.toContainText("Streamed implementation details.")
  await timeline.getByRole("button", { name: "Cancel next compaction" }).click()
  await expect(compactions).toHaveCount(2)
  const cancelled = compactions.filter({ hasNotText: "The provider rejected the summary." })
  await expect(cancelled.getByText("Session compacted", { exact: true })).toBeVisible()
  await expect(cancelled).not.toContainText("Cancellation detail should stay hidden.")
})

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("shows a delegating row while subagent input streams", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--delegating-an-agent")
  const delegating = timeline.locator('[data-component="task-tool-delegating"]')
  await expect(delegating).toBeVisible()
  const shimmer = delegating.locator('[data-component="text-shimmer"]')
  await expect(shimmer).toHaveAttribute("aria-label", "Delegating agent...")
  await expect(shimmer).toHaveCSS("line-height", "16px")
  const icon = delegating.locator('[data-slot="icon-svg"]')
  await expect(icon.locator('use[href="#opencode-v2-icon-subagent"]')).toBeVisible()
  await expect(icon).toHaveCSS("color", "rgb(174, 174, 174)")
  await expect(timeline.locator('[data-component="task-tool-card"]')).toHaveCount(0)
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
})

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("waits for completion before labeling requested background work", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--starting-background-work")
  await expect(timeline.locator('[data-component="task-tool-card"]')).toContainText("Inspect code")
  await expect(timeline.locator('[data-component="task-tool-card"]')).not.toContainText("(background)")
})
