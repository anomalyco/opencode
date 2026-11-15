import { expect, story } from "../../stories/playwright/story"

const playground = "timeline-playground--playground"

story("a subagent row leads with its status chip and spins only while the work runs", async ({ mount }) => {
  const timeline = await mount(playground, { args: { scenario: "Background work", activity: true } })
  const rows = timeline.locator('[data-component="timeline-subagent"] > [data-slot="timeline-event-item"]')

  await expect(rows.locator('[data-slot="timeline-event-item-status"]')).toHaveText([
    "Started",
    "Started",
    "Updated",
    "Completed",
    "Failed",
    "Started",
    "Started",
    "Completed",
    "Stopped",
  ])
  // Agent names are capitalized by CSS, so their text is as configured.
  await expect(rows.nth(3).locator("> *")).toHaveText(["Completed", "review Agent", "Review the theme store"])
  // Every subagent here has reported back, so no start spins.
  await expect(rows.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
})

story("a start whose subagent has not reported back spins", async ({ mount }) => {
  const timeline = await mount(playground, { args: { scenario: "Subagent between tools", activity: true } })
  const status = timeline.locator('[data-component="timeline-subagent"] [data-slot="timeline-event-item-status"]')

  await expect(status).toHaveText("Started")
  await expect(status.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(1)
})
