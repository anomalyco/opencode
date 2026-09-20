import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./superpowers.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

export async function openExecutionFixture(page: Page, scenario = "observer") {
  await page.goto("/iframe.html?id=opencode-composer-flow--mixed-attachments&viewMode=story")
  await expect(page.locator("#storybook-root")).toBeVisible({ timeout: 30_000 })
  await page.evaluate(
    async ({ fixture, scenario }) => {
      const { mountExecutionFixture } = await import(fixture)
      await mountExecutionFixture({ scenario })
    },
    { fixture, scenario },
  )
  await expect(page.getByTestId("execution-fixture")).toBeVisible()
}

story("execution tab opens without loading a file", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  const root = page.getByTestId("execution-fixture")
  await root.getByRole("button", { name: "Open File A", exact: true }).click()
  await expect(page.getByTestId("execution-load-log")).toHaveText("a.ts")
  await root.getByRole("button", { name: "Open Execution", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByTestId("execution-load-log")).toHaveText("a.ts")
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("file://a.ts,execution")
})

story("execution tab keeps the existing file tab when it closes", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  const root = page.getByTestId("execution-fixture")
  await root.getByRole("button", { name: "Open File A", exact: true }).click()
  await root.getByRole("button", { name: "Open Execution", exact: true }).click()
  await expect(page.getByTestId("execution-file-tab")).toHaveText("")
  await root.getByRole("button", { name: "Close Execution", exact: true }).click()
  await expect(page.getByTestId("execution-file-tab")).toHaveText("file://a.ts")
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("file://a.ts")
})

story("execution tab mounts the graph only while open", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  const root = page.getByTestId("execution-fixture")
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(0)
  await root.getByRole("button", { name: "Open Execution", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Map", exact: true }).click()
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(1)
  await expect(page.getByText("Tracking not connected", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Close Execution", exact: true }).click()
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(0)
})
