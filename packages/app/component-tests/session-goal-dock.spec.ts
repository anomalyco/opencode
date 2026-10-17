import { expect, story } from "../../storybook/playwright/story"

story("renders nothing without a goal", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--no-goal")
  await expect(component.locator('[data-component="session-goal-dock"]')).toHaveCount(0)
})

story("offers pause while the goal is active", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--active")
  const goal = component.locator('[data-component="session-goal-dock"]')
  await expect(goal).toHaveAttribute("data-phase", "active")
  await expect(goal).toContainText("Ship the goal indicator and todo dock")
  await expect(goal.locator('[data-slot="session-goal-elapsed"]')).toHaveText(/^\d+m \d+s$/)
  await expect(goal.getByRole("button", { name: "Pause goal" })).toBeVisible()
  await expect(goal.getByRole("button")).toHaveCount(1)
})

story("marks an active goal this process will not run", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--active-stopped")
  const goal = component.locator('[data-component="session-goal-dock"]')
  await expect(goal.locator('[data-slot="session-goal-status"]')).toHaveText("Stopped")
  await expect(goal.getByRole("button", { name: "Pause goal" })).toBeVisible()
})

story("offers resume, edit, and clear while paused", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--paused")
  const goal = component.locator('[data-component="session-goal-dock"]')
  await expect(goal).toHaveAttribute("data-phase", "paused")
  await expect(goal.locator('[data-slot="session-goal-status"]')).toHaveText("Paused")
  await expect(goal.getByRole("button", { name: "Resume goal" })).toBeVisible()
  await expect(goal.getByRole("button", { name: "Clear goal" })).toBeVisible()

  await goal.getByRole("button", { name: "Edit goal" }).click()
  const input = goal.getByRole("textbox", { name: "Edit goal" })
  await expect(input).toBeFocused()
  await input.fill("Ship the todo dock")
  await input.press("Enter")
  await expect(goal).toContainText("Ship the todo dock")
  await expect(goal.getByRole("textbox")).toHaveCount(0)
})

story("offers resume and clear while blocked", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--blocked")
  const goal = component.locator('[data-component="session-goal-dock"]')
  await expect(goal).toHaveAttribute("data-phase", "blocked")
  await expect(goal.locator('[data-slot="session-goal-blocked"]')).toHaveText("Reached the round limit")
  await expect(goal.getByRole("button", { name: "Resume goal" })).toBeVisible()
  await expect(goal.getByRole("button", { name: "Clear goal" })).toBeVisible()
  await expect(goal.getByRole("button")).toHaveCount(2)
})

story("offers clear when complete", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--complete")
  const goal = component.locator('[data-component="session-goal-dock"]')
  await expect(goal).toHaveAttribute("data-phase", "complete")
  await expect(goal.locator('[data-slot="session-goal-status"]')).toHaveText("Complete")
  await expect(goal.getByRole("button", { name: "Clear goal" })).toBeVisible()
  await expect(goal.getByRole("button")).toHaveCount(1)
})
