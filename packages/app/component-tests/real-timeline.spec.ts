import { expect, story } from "../../storybook/playwright/story"

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
