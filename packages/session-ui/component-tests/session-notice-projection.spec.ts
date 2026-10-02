import { expect, story } from "../../storybook/playwright/story"

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("shows a delegating row while subagent input streams", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "delegation" } })
  const delegating = timeline.locator('[data-component="task-tool-delegating"]')
  await expect(delegating).toBeVisible()
  const shimmer = delegating.locator('[data-component="text-shimmer"]')
  await expect(shimmer).toHaveAttribute("aria-label", "Delegating agent…")
  await expect(shimmer).toHaveCSS("line-height", "16px")
  await expect(timeline.locator('[data-component="task-tool-card"]')).toHaveCount(0)
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
})

// Moved from packages/app/e2e/regression/session-timeline-notices.spec.ts
story("waits for completion before labeling requested background work", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "background" } })
  await expect(timeline.locator('[data-component="task-tool-card"]')).toContainText("Inspect code")
  await expect(timeline.locator('[data-component="task-tool-card"]')).not.toContainText("(background)")
})
