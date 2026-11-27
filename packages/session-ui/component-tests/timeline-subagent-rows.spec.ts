import { expect, test } from "../../lab/playwright/test"

const playground = "timeline-playground--playground"

test("a subagent row leads with its status", async ({ mount }) => {
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
})

// The timeline is a list of events: a start stays a plain status even while its subagent has not reported back.
test("a started subagent never spins", async ({ mount }) => {
  const timeline = await mount(playground, { args: { scenario: "Subagent between tools", activity: true } })
  const status = timeline.locator('[data-component="timeline-subagent"] [data-slot="timeline-event-item-status"]')

  await expect(status).toHaveText("Started")
  await expect(status).toHaveAttribute("data-state", "started")
  await expect(status.locator("svg")).toHaveCount(0)
  await expect(status.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
})
