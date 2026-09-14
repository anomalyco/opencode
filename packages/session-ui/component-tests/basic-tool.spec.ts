import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./basic-tool.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story("does not render completed reasoning until it is opened", async ({ mount, page }) => {
  const root = await mount("current-session-timeline-rows--conversation", {
    args: { scenario: "reasoning", mode: "compact", text: "Response after reasoning" },
  })
  const reasoning = root.locator('[data-timeline-part-id="msg_projection_assistant:reasoning:0"]')
  const trigger = reasoning.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(reasoning.locator('[data-component="markdown"]')).toHaveCount(0)
  const cached = () =>
    page.evaluate(async (fixture) => {
      const { getCachedMarkdown } = await import(fixture)
      return !!getCachedMarkdown("msg_projection_assistant:reasoning:0:0:full")
    }, fixture)
  expect(await cached()).toBe(false)
  await trigger.click()
  await expect(
    reasoning.getByText("I will inspect the timeline before changing its state.", { exact: true }),
  ).toBeVisible()
  expect(await cached()).toBe(true)
})

story("constructs declared tool details lazily and keeps trigger contracts reactive", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => {
    const { mountBasicTool } = await import(fixture)
    mountBasicTool()
  }, fixture)
  const root = page.getByTestId("basic-tool-fixture")
  await expect(root.getByRole("button", { name: "Initial title", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(root.getByTestId("detail-mounts")).toHaveText("0")
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")

  await root.getByLabel("Trigger label").fill("Updated title")
  await expect(root.getByTitle("Updated title", { exact: true })).toHaveText("Updated title")
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")
  await expect(root.getByRole("button", { name: /Tool subtitle/ })).toHaveAccessibleName(
    /Updated title\s*Tool subtitle\s*path=src/,
  )
  await root.getByRole("button", { name: "Updated title", exact: true }).click()
  await expect(root.getByText("Tool details", { exact: true })).toBeVisible()
  await expect(root.getByTestId("detail-mounts")).toHaveText("1")

  await root.getByRole("button", { name: "Function: closed", exact: true }).click()
  await expect(root.getByText("Function details", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Function: open", exact: true }).click()
  await expect(root.getByText("Function details", { exact: true })).toBeHidden()
  await expect(root.getByRole("button", { name: "Function: closed", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(root.getByTestId("trigger-constructions")).toHaveText("1")
})
