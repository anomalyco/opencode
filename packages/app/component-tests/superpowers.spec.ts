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

story("agents retain idle and nested sessions", async ({ page }) => {
  await openExecutionFixture(page, "agents")
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("treeitem", { name: /Idle reviewer/ })).toBeVisible()
  await page.getByRole("button", { name: "Expand Child implementer", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: /Grandchild worker/ })).toBeVisible()
  await expect(page.getByText("100%", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Open Grandchild worker session", exact: true }).click()
  await expect(page.getByTestId("navigation-target")).toHaveText("wsl/grandchild")
})

story("agents expand and collapse with the keyboard", async ({ page }) => {
  await openExecutionFixture(page, "agents")
  await expect(page.getByRole("treeitem", { name: /Child implementer/ })).toBeVisible()
  await page.getByRole("treeitem", { name: /Child implementer/ }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("treeitem", { name: /Grandchild worker/ })).toBeVisible()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("treeitem", { name: /Grandchild worker/ })).toHaveCount(0)
})

story("agents show an unknown model instead of the parent model", async ({ page }) => {
  await openExecutionFixture(page, "agents-missing-model")
  await page.getByRole("button", { name: "Expand Child implementer", exact: true }).click()
  const grandchild = page.getByRole("treeitem", { name: /Grandchild worker/ })
  await expect(grandchild.getByText("Model unknown", { exact: true })).toBeVisible()
  await expect(grandchild.getByText("gpt-5-codex", { exact: true })).toHaveCount(0)
})

story("agents include a foreground subagent", async ({ page }) => {
  await openExecutionFixture(page, "agents-foreground")
  const foreground = page.getByRole("treeitem", { name: /Foreground subagent/ })
  await expect(foreground).toBeVisible()
  await expect(foreground.getByText("Running", { exact: true })).toBeVisible()
  await expect(foreground.getByText("Editing src/api.ts", { exact: true })).toBeVisible()
})

story("agents mark a deleted child and keep the tree partial", async ({ page }) => {
  await openExecutionFixture(page, "agents-deleted")
  await expect(page.getByTestId("execution-agents-partial")).toBeVisible()
  await page.getByRole("button", { name: "Expand Child implementer", exact: true }).click()
  const deleted = page.getByRole("treeitem", { name: /Deleted child/ })
  await expect(deleted).toBeVisible()
  await expect(deleted.getByText("Session not found", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Retry loading Deleted child", exact: true }).click()
  await expect(page.getByTestId("retry-target")).toHaveText("deleted-child")
})

story("agents preserve the root key while navigating a child", async ({ page }) => {
  await openExecutionFixture(page, "agents")
  await expect(page.getByTestId("execution-scope-root")).toHaveText("root")
  await page.getByRole("button", { name: "Expand Child implementer", exact: true }).click()
  await page.getByRole("button", { name: "Open Grandchild worker session", exact: true }).click()
  await expect(page.getByTestId("navigation-target")).toHaveText("wsl/grandchild")
  await expect(page.getByTestId("navigation-href")).toContainText("/session/grandchild")
  await expect(page.getByTestId("execution-scope-root")).toHaveText("root")
})

story("agents separate current assignments from history", async ({ page }) => {
  await openExecutionFixture(page, "agents-assignments")
  const child = page.getByRole("treeitem", { name: /Child implementer/ })
  await expect(page.getByRole("treeitem", { name: /Child implementer/ })).toHaveCount(1)
  await expect(child.getByText("API contract", { exact: true })).toBeVisible()
  await expect(child.getByText("Verification", { exact: true })).toBeVisible()
  await expect(child.getByText("Earlier bootstrap", { exact: true })).toHaveCount(0)
  await child.getByRole("button", { name: "Show 1 earlier assignment", exact: true }).click()
  await expect(child.getByText("Earlier bootstrap", { exact: true })).toBeVisible()
})
