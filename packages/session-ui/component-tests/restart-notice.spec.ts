import { expect, story } from "../../stories/playwright/story"

for (const scenario of ["shutdown", "crash", "user", "declined", "legacy"]) {
  story(`shows the recorded interruption cause: ${scenario}`, async ({ mount }) => {
    const timeline = await mount("current-session-timeline-rows--restart-notice", { args: { scenario } })
    const restarted = scenario === "shutdown" || scenario === "crash"
    await expect(
      timeline
        .locator('[data-timeline-row="TurnDivider"]')
        .getByText(restarted ? "Server restarted" : "Interrupted", { exact: true }),
    ).toHaveCount(1)
    await expect(timeline.getByText(restarted ? "Interrupted" : "Server restarted", { exact: true })).toHaveCount(0)
    await expect(timeline.getByText("General cancelled", { exact: true })).toBeVisible()
  })
}
