import { expect, story } from "../../storybook/playwright/story"

story("updates the timeline from the production slider and advanced settings", async ({ mount }) => {
  const component = await mount("app-real-timeline--preset-explorer")
  const slider = component.getByRole("slider", { name: "Timeline detail" })

  await expect(slider).toHaveAttribute("aria-valuetext", "Compact")
  await expect(component.getByText(/^Used 10 /)).toBeVisible()
  await slider.press("End")
  await expect(slider).toHaveAttribute("aria-valuetext", "Everything")
  await expect(component.getByText(/^Used 10 /)).toHaveCount(0)

  await component.getByRole("button", { name: "Advanced", exact: true }).click()
  const shellGrouped = component.getByRole("switch", { name: "Shell grouped", exact: true })
  await expect(shellGrouped).not.toBeChecked()
  await shellGrouped.press("Space")
  await expect(slider).toHaveAttribute("aria-valuetext", "Custom")
  await expect(component.getByText(/^Used /)).toHaveCount(2)
})

story("renders a representative session with the desktop compact preset", async ({ mount }) => {
  const component = await mount("app-real-timeline--representative-compact")

  await expect(
    component.getByText(/Used 10 Skill, Read, Grep, Glob, Execute, Shell, Web Search, Webfetch, Patch, Agent/),
  ).toBeVisible()
  await expect(component.getByRole("img", { name: "lorem-layout.png" })).toBeVisible()
  await expect(component.locator('[data-component="session-timeline"]')).toContainText("Lorem ipsum")
})

story("renders every server message family with the everything preset", async ({ mount }) => {
  const component = await mount("app-real-timeline--all-server-parts-everything")

  await expect(component.getByText("Build → Review", { exact: true })).toBeVisible()
  await expect(component.getByText("Switched to ipsum-3", { exact: true })).toBeVisible()
  await expect(component.getByText("/workspace/lorem/ipsum/dolor/sit/amet", { exact: true })).toBeVisible()
  await expect(component.getByText("Command timed out", { exact: true })).toBeVisible()
  await expect(component.getByText("Session compaction started", { exact: true })).toHaveCount(4)
})

story("keeps failures and required notices visible in text-only mode", async ({ mount }) => {
  const component = await mount("app-real-timeline--failures-text-only")

  await expect(component.getByText("Grep", { exact: true })).toBeVisible()
  await expect(component.getByText("todo", { exact: true })).toBeVisible()
  await expect(component.getByText("Shell finished · Background shell failed", { exact: true })).toBeVisible()
})
