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
  await expect(goal.locator('[data-slot="session-goal-todos"]')).toHaveCount(0)
  await expect(goal.getByRole("button", { name: "Pause goal" })).toBeVisible()
  await expect(goal.getByRole("button")).toHaveCount(1)
})

story("shows the elapsed time only while the goal is active", async ({ mount }) => {
  const active = await mount("app-session-goal-dock--active")
  await expect(active.locator('[data-slot="session-goal-elapsed"]')).toHaveText(/^\d+m \d+s$/)

  // A stopped goal has no durable phase-change time, so it shows its phase and no duration
  // instead of a number that would be reconstructed per browser.
  const paused = await mount("app-session-goal-dock--paused")
  await expect(paused.locator('[data-slot="session-goal-elapsed"]')).toHaveCount(0)

  const complete = await mount("app-session-goal-dock--complete")
  await expect(complete.locator('[data-slot="session-goal-elapsed"]')).toHaveCount(0)

  const blocked = await mount("app-session-goal-dock--blocked")
  await expect(blocked.locator('[data-slot="session-goal-elapsed"]')).toHaveCount(0)
})

story("formats an hour or more as hours and minutes", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--active-long-running")
  await expect(component.locator('[data-slot="session-goal-elapsed"]')).toHaveText("1h 35m")
})

story("surfaces the still-active notice after an interruption", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--active-interrupted")
  const goal = component.locator('[data-component="session-goal-dock"]')
  const hint = goal.locator('[data-slot="session-goal-hint"]')
  await expect(hint).toContainText(
    "Goal still active; it continues after your next message. /goal pause to stop.",
  )

  await component.getByRole("button", { name: "Dismiss goal notice" }).click()
  await expect(hint).toHaveCount(0)
})

story("stays quiet for an active goal this process is armed for", async ({ mount }) => {
  const armed = await mount("app-session-goal-dock--active")
  await expect(armed.locator('[data-slot="session-goal-hint"]')).toHaveCount(0)

  const stopped = await mount("app-session-goal-dock--active-stopped")
  await expect(stopped.locator('[data-slot="session-goal-hint"]')).toHaveCount(0)
})

story("renders the goal todo list", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--todos")
  const goal = component.locator('[data-component="session-goal-dock"]')
  const todos = goal.locator('[data-slot="session-goal-todo"]')
  await expect(todos).toHaveCount(4)
  await expect(todos.nth(0)).toHaveAttribute("data-status", "completed")
  await expect(todos.nth(1)).toHaveAttribute("data-status", "in_progress")
  await expect(goal.getByRole("listitem", { name: "Completed: Wire the goal store" })).toBeVisible()
  await expect(goal.getByRole("listitem", { name: "In progress: Render the todo list" })).toBeVisible()
  await expect(goal.getByRole("listitem", { name: "Pending: Ship the PR" })).toBeVisible()
  await expect(goal.getByRole("listitem", { name: "Cancelled: Write the changelog" })).toBeVisible()
})

story("caps the todo list at five rows", async ({ mount }) => {
  const component = await mount("app-session-goal-dock--todos-overflow")
  const goal = component.locator('[data-component="session-goal-dock"]')
  await expect(goal.locator('[data-slot="session-goal-todo"]')).toHaveCount(5)
  await expect(goal.locator('[data-slot="session-goal-todo-more"]')).toHaveText("+2 more")
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
