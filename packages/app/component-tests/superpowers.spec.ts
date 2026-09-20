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

async function openAddTabMenu(page: Page) {
  await page.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(page.getByRole("menu")).toBeVisible()
}

async function openFileFromMenu(page: Page) {
  await openAddTabMenu(page)
  await page.getByRole("menuitem", { name: /Open file/ }).click()
}

async function openExecutionFromMenu(page: Page) {
  await openAddTabMenu(page)
  await page.getByRole("menuitem", { name: /Execution/ }).click()
}

story("execution tab opens from the add-tab control without loading a file", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  await expect(page.getByTestId("execution-browser-available")).toHaveText("false")
  await openAddTabMenu(page)
  await expect(page.getByRole("menuitem", { name: /Execution/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /Browser/ })).toHaveCount(0)
  await page.getByRole("menuitem", { name: /Open file/ }).click()
  await expect(page.getByTestId("execution-load-log")).toHaveText("a.ts")
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("file://a.ts")
  await openExecutionFromMenu(page)
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByTestId("execution-load-log")).toHaveText("a.ts")
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("file://a.ts,execution")
})

story("execution tab is offered with files and browser when browser support is available", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  await page.getByRole("button", { name: "Toggle browser support", exact: true }).click()
  await expect(page.getByTestId("execution-browser-available")).toHaveText("true")
  await openAddTabMenu(page)
  await expect(page.getByRole("menuitem", { name: /Open file/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /Browser/ })).toBeVisible()
  await page.getByRole("menuitem", { name: /Execution/ }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("execution")
})

story("execution tab keeps the existing file tab when it closes", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  await openFileFromMenu(page)
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("file://a.ts")
  await openExecutionFromMenu(page)
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("file://a.ts,execution")
  await expect(page.getByTestId("execution-file-tab")).toHaveText("")
  await page.getByRole("button", { name: "Close Execution", exact: true }).click()
  await expect(page.getByTestId("execution-file-tab")).toHaveText("file://a.ts")
  await expect(page.getByTestId("execution-open-tabs")).toHaveText("file://a.ts")
  await expect(page.getByTestId("execution-load-log")).toHaveText("a.ts")
})

story("execution tab mounts the graph only while open", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(0)
  await openExecutionFromMenu(page)
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Map", exact: true }).click()
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(1)
  await expect(page.getByText("Tracking not connected", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Close Execution", exact: true }).click()
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(0)
})
