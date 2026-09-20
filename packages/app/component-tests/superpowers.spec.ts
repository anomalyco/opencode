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

story("agents activate the open action with the keyboard", async ({ page }) => {
  await openExecutionFixture(page, "agents")
  await page.getByRole("button", { name: "Expand Child implementer", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("treeitem", { name: /Grandchild worker/ })).toBeVisible()
  await page.getByRole("button", { name: "Open Grandchild worker session", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("navigation-target")).toHaveText("wsl/grandchild")
})

story("agents activate retry with the keyboard without collapsing the tree", async ({ page }) => {
  await openExecutionFixture(page, "agents-deleted")
  await page.getByRole("button", { name: "Expand Child implementer", exact: true }).click()
  const deleted = page.getByRole("treeitem", { name: /Deleted child/ })
  await expect(deleted).toBeVisible()
  await page.getByRole("button", { name: "Retry loading Deleted child", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("retry-target")).toHaveText("deleted-child")
  await expect(deleted).toBeVisible()
})

story("agents activate assignment history with the keyboard", async ({ page }) => {
  await openExecutionFixture(page, "agents-assignments")
  const toggle = page.getByRole("button", { name: "Show 1 earlier assignment", exact: true })
  await toggle.focus()
  await page.keyboard.press("Enter")
  const child = page.getByRole("treeitem", { name: /Child implementer/ })
  await expect(child.getByText("Earlier bootstrap", { exact: true })).toBeVisible()
})

story("agents virtualize more than one hundred rows with a tall row", async ({ page }) => {
  await openExecutionFixture(page, "agents-many")
  const controller = page.getByRole("treeitem", { name: /Many controller/ })
  await expect(controller).toBeVisible()
  const tall = page.getByRole("treeitem", { name: /Worker 001/ })
  await expect(tall).toBeVisible()
  const tallBox = await tall.boundingBox()
  const tallHeight = Math.round(tallBox?.height ?? 0)
  expect(tallHeight).toBeGreaterThan(44)

  const scroller = page.locator(".execution-agents__scroller")
  const expectedExtent = 120 * 44 + tallHeight
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight)).toBe(expectedExtent)

  await controller.focus()
  await page.keyboard.press("End")
  const last = page.getByRole("treeitem", { name: /Worker 120/ })
  await expect(last).toBeVisible()
  await expect(last).toBeFocused()
  await expect(page.getByRole("treeitem", { name: /Worker 001/ })).toHaveCount(0)
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight)).toBe(expectedExtent)
  const bottom = await scroller.evaluate((element) => element.scrollTop + element.clientHeight)
  expect(Math.abs(bottom - expectedExtent)).toBeLessThanOrEqual(2)

  await page.keyboard.press("Home")
  await expect(controller).toBeVisible()
  await expect(controller).toBeFocused()
})

story("execution shortcut preserves permission handling", async ({ page }) => {
  await openExecutionFixture(page, "permission-pending")
  await page.getByRole("button", { name: "Open execution overview", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review pending request", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Review pending request", exact: true }).click()
  await expect(page.getByTestId("native-request-region")).toBeFocused()
  await expect(page.getByTestId("permission-reply-count")).toHaveText("0")
})

story("execution shortcut reuses nested child requests for attention", async ({ page }) => {
  await openExecutionFixture(page, "nested-permission")
  await expect(page.getByTestId("execution-status-badge")).toHaveAttribute("data-attention", "needs_input")
  await expect(page.getByTestId("native-request-owner")).toHaveText("grandchild")
  await page.getByRole("button", { name: "Review pending request", exact: true }).click()
  await expect(page.getByTestId("native-request-region")).toBeFocused()
  await expect(page.getByTestId("permission-reply-count")).toHaveText("0")
})

story("execution shortcut surfaces question forms", async ({ page }) => {
  await openExecutionFixture(page, "question-pending")
  await expect(page.getByTestId("execution-status-label")).toHaveText("Waiting for your input")
  await page.getByRole("button", { name: "Review pending request", exact: true }).click()
  await expect(page.getByTestId("native-request-region")).toBeFocused()
  await expect(page.getByTestId("native-request-owner")).toHaveText("child")
  await expect(page.getByTestId("question-reply-count")).toHaveText("0")
})

story("execution shortcut prefers a stale connection before pending input", async ({ page }) => {
  await openExecutionFixture(page, "offline-pending")
  await expect(page.getByTestId("execution-status-badge")).toHaveAttribute("data-attention", "stale")
  await expect(page.getByTestId("execution-status-label")).toHaveText("Execution status stale")
})

story("execution shortcut keeps an accessible name when narrow", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 })
  await openExecutionFixture(page, "narrow-header")
  await expect(page.getByTestId("execution-status-label")).toBeHidden()
  await expect(page.getByRole("button", { name: "Open execution overview", exact: true })).toBeVisible()
})

story("execution shortcut mirrors the icon before the label in rtl", async ({ page }) => {
  await openExecutionFixture(page, "rtl")
  const badge = page.getByTestId("execution-status-badge")
  await expect(badge).toHaveCSS("direction", "rtl")
  const icon = await page.getByTestId("execution-status-icon").boundingBox()
  const label = await page.getByTestId("execution-status-label").boundingBox()
  expect(icon!.x).toBeGreaterThan(label!.x)
})

story("execution shortcut opens execution while review stays closed", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  await expect(page.getByTestId("review-state")).toHaveText("false")
  await page.getByRole("button", { name: "Open execution overview", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("review-state")).toHaveText("false")
})

story("execution shortcut never replies, prompts, or interrupts", async ({ page }) => {
  await openExecutionFixture(page, "permission-pending")
  await page.getByRole("button", { name: "Open execution overview", exact: true }).click()
  await page.getByRole("button", { name: "Review pending request", exact: true }).click()
  await page.getByRole("button", { name: "Map", exact: true }).click()
  await page.getByRole("button", { name: "Agents", exact: true }).click()
  await expect(page.getByTestId("permission-reply-count")).toHaveText("0")
  await expect(page.getByTestId("question-reply-count")).toHaveText("0")
  await expect(page.getByTestId("prompt-count")).toHaveText("0")
  await expect(page.getByTestId("subagent-count")).toHaveText("0")
  await expect(page.getByTestId("interrupt-count")).toHaveText("0")
})

story("background summary keeps shell jobs and adds one view all agents action", async ({ page }) => {
  await openExecutionFixture(page, "background-tasks")
  await page.getByRole("button", { name: "2 background tasks running", exact: true }).click()
  await expect(page.getByText("bun run test:components", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "View all agents", exact: true })).toHaveCount(1)
  await page.getByRole("button", { name: "View all agents", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true")
})

story("background summary stays empty without running work", async ({ page }) => {
  await openExecutionFixture(page, "background-empty")
  await expect(page.locator('[data-component="session-background-summary"]')).toHaveCount(0)
  await expect(page.getByRole("button", { name: "View all agents", exact: true })).toHaveCount(0)
})

story("execution shortcut shows reported verification progress", async ({ page }) => {
  await openExecutionFixture(page, "tracked-progress")
  await expect(page.getByTestId("execution-status-label")).toHaveText("3 of 5 verified")
})

story("execution shortcut shows the active agent count", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  await expect(page.getByTestId("execution-status-label")).toHaveText("2 active agents")
})

story("execution shortcut names blocked work", async ({ page }) => {
  await openExecutionFixture(page, "blocked-pending")
  await expect(page.getByTestId("execution-status-badge")).toHaveAttribute("data-attention", "blocked")
  await expect(page.getByTestId("execution-status-label")).toHaveText("Execution blocked")
})

story("execution shortcut tooltip preserves full detail", async ({ page }) => {
  await openExecutionFixture(page, "tracked-progress")
  await page.getByTestId("execution-status-badge").hover()
  const detail = page.getByTestId("execution-status-detail")
  await expect(detail).toBeVisible()
  await expect(detail).toContainText("Execution detail")
  await expect(detail).toContainText("Connection: live")
  await expect(detail).toContainText("Pending input: 0")
  await expect(detail).toContainText("Verified: 3 of 5")
  await expect(detail).toContainText("Active agents: 2")
})

story("desktop summary composition opens agents", async ({ page }) => {
  await openExecutionFixture(page, "desktop-summary")
  await page.getByRole("button", { name: "2 background tasks running", exact: true }).click()
  await expect(page.getByRole("button", { name: "View all agents", exact: true })).toHaveCount(1)
  await page.getByRole("button", { name: "View all agents", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true")
})

story("desktop timeline summary opens agents", async ({ page }) => {
  await openExecutionFixture(page, "timeline-desktop")
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  await page.getByRole("button", { name: "2 background tasks running", exact: true }).click()
  await expect(page.getByRole("button", { name: "View all agents", exact: true })).toHaveCount(1)
  await page.getByRole("button", { name: "View all agents", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true")
})
