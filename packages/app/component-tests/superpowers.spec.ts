import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import type { Locator, Page, TestInfo } from "@playwright/test"
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

async function focusWithKeyboard(page: Page, target: Locator, limit = 100) {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error("keyboard focus never reached the target control")
}

async function captureFixtureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  const bytes = readFileSync(path)
  expect(bytes.byteLength).toBeGreaterThan(1_000)
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
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
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-testid="execution-graph"]')).toHaveCount(0)
  await page.getByRole("tab", { name: "Map", exact: true }).click()
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
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByTestId("review-state")).toHaveText("false")
})

story("execution shortcut never replies, prompts, or interrupts", async ({ page }) => {
  await openExecutionFixture(page, "permission-pending")
  await page.getByRole("button", { name: "Open execution overview", exact: true }).click()
  await page.getByRole("button", { name: "Review pending request", exact: true }).click()
  await page.getByRole("tab", { name: "Map", exact: true }).click()
  await page.getByRole("tab", { name: "Agents", exact: true }).click()
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
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true")
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

story("session execution badge reports bridge failures while the execution tab is closed", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-live")
  await expect(page.getByTestId("execution-tab-active")).toHaveText("review")
  await expect(page.getByTestId("execution-status-badge")).toHaveAttribute("data-attention", "failed")
})

story("home leaves ordinary sessions unchanged", async ({ page }) => {
  await openExecutionFixture(page, "home-mixed")
  await expect(page.getByTestId("home-root-tracked").getByText("1/2", { exact: true })).toBeVisible()
  await expect(page.getByTestId("home-root-ordinary").getByTestId("execution-summary")).toHaveCount(0)
  await expect(page.getByTestId("full-run-fetch-count")).toHaveText("0")
  await page.getByTestId("home-root-tracked").getByRole("button", { name: "Open execution overview" }).click()
  await expect(page.getByTestId("destination-session")).toHaveText("root-tracked")
  await expect(page.getByTestId("destination-subview")).toHaveText("agents")
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true")
})

story("home direct action selects the mobile execution view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "home-narrow")
  await page.getByTestId("home-root-tracked").getByRole("button", { name: "Open execution overview" }).click()
  await expect(page.getByTestId("destination-session")).toHaveText("root-tracked")
  await expect(page.getByTestId("destination-subview")).toHaveText("agents")
  await expect(page.getByTestId("destination-mobile-tab")).toHaveText("execution")
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "mobile")
})

story("home summary shows a cancelled run without hiding its fraction", async ({ page }) => {
  await openExecutionFixture(page, "home-cancelled")
  const summary = page.getByTestId("home-root-tracked").getByTestId("execution-summary")
  await expect(summary).toHaveAttribute("data-status", "cancelled")
  await expect(summary.getByText("1/2", { exact: true })).toBeVisible()
  await expect(summary.getByText("Cancelled", { exact: true })).toBeVisible()
  await expect(page.getByTestId("home-root-ordinary").getByTestId("execution-summary")).toHaveCount(0)
})

story("home keeps ordinary rows when the plugin is missing", async ({ page }) => {
  await openExecutionFixture(page, "home-missing-plugin")
  await expect(page.getByTestId("home-root-tracked")).toBeVisible()
  await expect(page.getByTestId("home-root-ordinary")).toBeVisible()
  await expect(page.getByTestId("execution-summary")).toHaveCount(0)
  await expect(page.getByTestId("full-run-fetch-count")).toHaveText("0")
})

story("home marks a summary stale when its refetch fails", async ({ page }) => {
  await openExecutionFixture(page, "home-mixed")
  const summary = page.getByTestId("home-root-tracked").getByTestId("execution-summary")
  await expect(summary).toHaveAttribute("data-stale", "false")
  await page.getByTestId("fail-summary").evaluate((element) => (element as HTMLElement).click())
  await expect(summary).toHaveAttribute("data-stale", "true")
  await expect(summary.getByText("Stale", { exact: true })).toBeVisible()
  await expect(summary.getByText("1/2", { exact: true })).toBeVisible()
})

story("home rows stay editable while summaries update", async ({ page }) => {
  await openExecutionFixture(page, "home-mixed")
  const row = page.getByTestId("home-root-tracked")
  await expect(row.getByText("1/2", { exact: true })).toBeVisible()
  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename" }).click()
  const editor = row.locator('[data-component="home-session-rename"]')
  await expect(editor).toBeVisible()
  await editor.fill("Renamed controller")
  await page.getByTestId("advance-summary").evaluate((element) => (element as HTMLElement).click())
  await expect(editor).toHaveValue("Renamed controller")
  await page.keyboard.press("Escape")
  await expect(row.getByText("2/2", { exact: true })).toBeVisible()
  await expect(row.getByTestId("execution-summary")).toBeVisible()
})

story("desktop summary composition opens agents", async ({ page }) => {
  await openExecutionFixture(page, "desktop-summary")
  await page.getByRole("button", { name: "2 background tasks running", exact: true }).click()
  await expect(page.getByRole("button", { name: "View all agents", exact: true })).toHaveCount(1)
  await page.getByRole("button", { name: "View all agents", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true")
})

story("desktop timeline summary opens agents", async ({ page }) => {
  await openExecutionFixture(page, "timeline-desktop")
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  await page.getByRole("button", { name: "2 background tasks running", exact: true }).click()
  await expect(page.getByRole("button", { name: "View all agents", exact: true })).toHaveCount(1)
  await page.getByRole("button", { name: "View all agents", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true")
})

story("progress distinguishes review, cancellation, and provenance", async ({ page }) => {
  await openExecutionFixture(page, "half-verified")
  await expect(page.getByTestId("execution-progress-count")).toHaveText("1/2")
  await page.getByRole("button", { name: "Progress information", exact: true }).click()
  await expect(page.getByText("Verification is reported by the controller.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Show cancelled fixture", exact: true }).click()
  await expect(page.getByTestId("execution-run-state")).toHaveText("Cancelled")
  await expect(page.getByTestId("execution-run-state")).not.toHaveText("Complete")
})

story("cancelled task progress keeps its historical fraction", async ({ page }) => {
  await openExecutionFixture(page, "half-verified")
  await page.getByRole("button", { name: "Show cancelled fixture", exact: true }).click()
  await expect(page.getByTestId("execution-run-state")).toHaveText("Cancelled")
  await expect(page.getByTestId("execution-progress-count")).toHaveText("1/2")
  await expect(page.getByText("Complete", { exact: true })).toHaveCount(0)
})

story("task progress is absent without a registered run", async ({ page }) => {
  await openExecutionFixture(page, "observer")
  await openExecutionFromMenu(page)
  await page.getByRole("tab", { name: "Tasks", exact: true }).click()
  await expect(page.getByTestId("execution-progress-count")).toHaveCount(0)
  await expect(page.getByTestId("execution-progress-percent")).toHaveCount(0)
  await expect(page.getByTestId("execution-progress-none")).toBeVisible()
})

story("task list shows every task state and filters without a fabricated percent field", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  const list = page.getByTestId("execution-tasks-list")
  await expect(list.getByRole("button", { name: /Pending work, Pending/ })).toBeVisible()
  await expect(list.getByRole("button", { name: /Blocked work, Blocked/ })).toBeVisible()
  await expect(list.getByRole("button", { name: /Verified work, Verified/ })).toBeVisible()
  await expect(list.getByRole("button", { name: /Failed work, Failed/ })).toBeVisible()
  await expect(list.getByRole("button", { name: /Skipped work, Skipped/ })).toBeVisible()
  await expect(page.getByTestId("execution-progress-skipped")).toHaveText("1 skipped task")
  await expect(page.getByTestId("execution-progress-count")).toHaveText("1/7")
  await expect(page.getByTestId("execution-plan-revision")).toHaveText("Plan revision 1")
  await page.getByRole("combobox", { name: "Filter by state", exact: true }).selectOption("blocked")
  await expect(list.getByRole("button", { name: /Blocked work/ })).toBeVisible()
  await expect(list.getByRole("button", { name: /Verified work/ })).toHaveCount(0)
  await page.getByRole("combobox", { name: "Filter by state", exact: true }).selectOption("all")
  await page.getByRole("searchbox", { name: "Search tasks", exact: true }).fill("final")
  await expect(list.getByRole("button", { name: /Final review/ })).toBeVisible()
  await expect(list.getByRole("button", { name: /Verified work/ })).toHaveCount(0)
})

story("task details show the blocked reason and unrun gates", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  await page.getByRole("button", { name: /Blocked work, Blocked/ }).click()
  await expect(page.getByTestId("execution-task-title")).toHaveText("Blocked work")
  await expect(page.getByTestId("execution-task-reason")).toHaveText("Waiting on a decision")
  await expect(page.getByTestId("execution-task-dependencies")).toContainText("Running work")
  await expect(page.getByTestId("execution-gate-tests")).toHaveAttribute("data-outcome", "unrun")
  await expect(page.getByTestId("execution-task-evidence-none")).toBeVisible()
})

story("task details separate current-attempt evidence from superseded attempts", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  await page.getByRole("button", { name: /Failed work, Failed/ }).click()
  await expect(page.getByTestId("execution-gate-tests")).toHaveAttribute("data-outcome", "failed")
  await expect(page.getByTestId("execution-task-evidence-current")).toContainText("Second attempt failed")
  await expect(page.getByTestId("execution-task-evidence-superseded")).toContainText("First attempt failed")
})

story("task evidence stays neutral until a deleted session lookup fails", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  await page.getByRole("button", { name: /Awaiting review, Awaiting review/ }).click()
  const evidence = page.getByTestId("execution-evidence-e-review-ghost")
  await expect(evidence).toHaveAttribute("data-available", "unknown")
  await expect(evidence).toContainText("Spec review reported from a deleted session")
  await evidence
    .getByRole("button", { name: /Open evidence from/ })
    .evaluate((element) => (element as HTMLElement).click())
  await expect(evidence).toHaveAttribute("data-available", "false")
  await expect(evidence).toContainText("Spec review reported from a deleted session")
  await expect(evidence.getByText("Reported evidence not found", { exact: true })).toBeVisible()
})

story("task evidence marks an unresolvable message unavailable only after lookup fails", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  await page.getByRole("button", { name: /Awaiting review, Awaiting review/ }).click()
  const evidence = page.getByTestId("execution-evidence-e-review-missing")
  await expect(evidence).toHaveAttribute("data-available", "unknown")
  await evidence
    .getByRole("button", { name: /Open evidence from/ })
    .evaluate((element) => (element as HTMLElement).click())
  await expect(evidence).toHaveAttribute("data-available", "false")
  await expect(evidence).toContainText("Spec review reported from an unloaded native message")
  await expect(evidence.getByText("Reported evidence not found", { exact: true })).toBeVisible()
})

story("task details use the latest ledger gate report", async ({ page }) => {
  await openExecutionFixture(page, "tasks-gate-order")
  await expect(page.getByTestId("execution-gate-tests")).toHaveAttribute("data-outcome", "failed")
  const current = page.getByTestId("execution-task-evidence-current")
  await expect(current.locator("li").first()).toContainText("Earlier pass appended first")
  await expect(current.locator("li").last()).toContainText("Later failure appended second")
})

story("task details count a reused child once and show an inline root assignment", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  await page.getByRole("button", { name: /Verified work, Verified/ }).click()
  await expect(page.getByTestId("execution-task-agent-count")).toHaveText("3 agents")
  await expect(page.getByTestId("execution-assignment-a-inline")).toHaveAttribute("data-session-id", "root")
  await expect(page.getByTestId("execution-assignment-a-impl")).toHaveAttribute("data-session-id", "child")
  await expect(page.getByTestId("execution-assignment-a-review")).toHaveAttribute("data-session-id", "child")
})

story("task details separate native idle state from the reported outcome", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  await page.getByRole("button", { name: /Verified work, Verified/ }).click()
  await expect(page.getByTestId("execution-assignment-a-idle")).toHaveAttribute("data-native-state", "idle")
  await expect(page.getByTestId("execution-task-outcome")).toHaveText("Verified")
})

story("task details keep the final review pending", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  await page.getByRole("button", { name: /Final review, Pending/ }).click()
  await expect(page.getByTestId("execution-task-final-review")).toHaveText("Final review is still pending")
})

story("task progress marks a stale snapshot as stale while keeping counts", async ({ page }) => {
  await openExecutionFixture(page, "tasks-stale")
  await expect(page.getByTestId("execution-progress-stale")).toBeVisible()
  await expect(page.getByTestId("execution-progress-count")).toHaveText("1/2")
})

story("task evidence opens the specific message and part only on selection", async ({ page }) => {
  await openExecutionFixture(page, "half-verified")
  await expect(page.getByTestId("evidence-target")).toHaveText("")
  await page
    .getByRole("button", { name: /Open evidence from/ })
    .first()
    .evaluate((element) => (element as HTMLElement).click())
  await expect(page.getByTestId("evidence-target")).toHaveText("child#msg-api-1#part-api-1")
})

story("task evidence hands the message part to the destination session", async ({ page }) => {
  await openExecutionFixture(page, "half-verified")
  await page
    .getByRole("button", { name: /Open evidence from/ })
    .first()
    .evaluate((element) => (element as HTMLElement).click())
  await expect(page.getByTestId("evidence-target")).toHaveText("child#msg-api-1#part-api-1")
  await expect(page.getByTestId("revealed-target")).toHaveText("")
  await page.getByRole("button", { name: "Activate evidence destination", exact: true }).click()
  await expect(page.getByTestId("revealed-target")).toHaveText("msg-api-1#part-api-1")
})

story("production evidence selection reveals a part in an already-ready timeline", async ({ page }) => {
  await openExecutionFixture(page, "evidence-production")
  await expect(page.getByTestId("production-timeline-ready")).toHaveText("true")
  await expect(page.getByTestId("production-reveal-count")).toHaveText("0")
  await page
    .getByRole("button", { name: /Open evidence from/ })
    .first()
    .evaluate((element) => (element as HTMLElement).click())
  await expect(page.getByTestId("production-revealed-target")).toHaveText("msg-api-1#part-api-1")
  await expect(page.getByTestId("production-reveal-count")).toHaveText("1")
})

story("task progress shows a scope increase reducing the fraction", async ({ page }) => {
  await openExecutionFixture(page, "tasks-scope")
  await expect(page.getByTestId("execution-progress-count")).toHaveText("2/2")
  await expect(page.getByTestId("execution-plan-revision")).toHaveText("Plan revision 1")
  await page.getByRole("button", { name: "Show increased scope fixture", exact: true }).click()
  await expect(page.getByTestId("execution-progress-count")).toHaveText("2/4")
  await expect(page.getByTestId("execution-plan-revision")).toHaveText("Plan revision 2")
})

story("map renders dependency nodes, edges, and task facts", async ({ page }) => {
  await openExecutionFixture(page, "map")
  await expect(page.getByTestId("execution-map")).toBeVisible()
  await expect(page.getByTestId("execution-progress-count")).toHaveText("1/5")
  const schema = page.locator('[data-testid="execution-map-node"][data-task-id="schema"]')
  await expect(schema).toContainText("Implement storage schema")
  await expect(schema).toContainText("Implementation")
  await expect(schema).toContainText("Verified")
  await expect(schema).toContainText("1 assignment")
  const api = page.locator('[data-testid="execution-map-node"][data-task-id="api"]')
  await expect(api).toContainText("2 assignments")
  const edge = page.locator('[data-testid="execution-map-edge"][data-from="schema"][data-to="api"]')
  await expect(edge).toHaveCount(1)
  await expect(edge).toHaveAttribute("d", /^M /)
})

story("map selects a node with the keyboard", async ({ page }) => {
  await openExecutionFixture(page, "map")
  const api = page.locator('[data-testid="execution-map-node"][data-task-id="api"]')
  await api.focus()
  await page.keyboard.press("Enter")
  await expect(api).toHaveAttribute("aria-pressed", "true")
})

story("map mounts only while the Map subview is selected", async ({ page }) => {
  await openExecutionFixture(page, "map")
  await expect(page.getByTestId("execution-map")).toBeVisible()
  await page.getByRole("tab", { name: "Tasks", exact: true }).click()
  await expect(page.getByTestId("execution-map")).toHaveCount(0)
  await page.getByRole("tab", { name: "Map", exact: true }).click()
  await expect(page.getByTestId("execution-map")).toBeVisible()
})

story("map keeps zoom within the supported bounds", async ({ page }) => {
  await openExecutionFixture(page, "map")
  const viewport = page.getByTestId("execution-map-viewport")
  for (let index = 0; index < 10; index += 1) await page.getByTestId("execution-map-zoom-in").click()
  await expect(viewport).toHaveAttribute("data-zoom", "2")
  for (let index = 0; index < 20; index += 1) await page.getByTestId("execution-map-zoom-out").click()
  await expect(viewport).toHaveAttribute("data-zoom", "0.25")
})

story("map pans without activating a node", async ({ page }) => {
  await openExecutionFixture(page, "map")
  const viewport = page.getByTestId("execution-map-viewport")
  const api = page.locator('[data-testid="execution-map-node"][data-task-id="api"]')
  await expect(viewport).toHaveAttribute("data-pan-x", "0")
  const box = await api.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 40, { steps: 5 })
  await page.mouse.up()
  await expect(viewport).toHaveAttribute("data-pan-x", "60")
  await expect(api).toHaveAttribute("aria-pressed", "false")
})

story("map keeps the selected task when a filter hides it", async ({ page }) => {
  await openExecutionFixture(page, "map")
  const api = page.locator('[data-testid="execution-map-node"][data-task-id="api"]')
  await api.click()
  await expect(api).toHaveAttribute("aria-pressed", "true")
  await page.getByTestId("execution-map-phase").selectOption("Review")
  await expect(api).toHaveCount(0)
  await expect(page.locator('[data-testid="execution-map-node"][data-task-id="final-review"]')).toBeVisible()
  await page.getByTestId("execution-map-phase").selectOption("all")
  await expect(api).toHaveAttribute("aria-pressed", "true")
})

story("map does not recenter or relayout when a task status changes", async ({ page }) => {
  await openExecutionFixture(page, "map")
  const api = page.locator('[data-testid="execution-map-node"][data-task-id="api"]')
  await api.click()
  await page.getByTestId("execution-map-center").click()
  const viewport = page.getByTestId("execution-map-viewport")
  const panX = await viewport.getAttribute("data-pan-x")
  const panY = await viewport.getAttribute("data-pan-y")
  const position = await api.boundingBox()
  await page.getByRole("button", { name: "Advance task status", exact: true }).click()
  await expect(page.locator('[data-testid="execution-map-node"][data-task-id="schema"]')).toHaveAttribute(
    "data-state",
    "running",
  )
  await expect(viewport).toHaveAttribute("data-pan-x", panX ?? "")
  await expect(viewport).toHaveAttribute("data-pan-y", panY ?? "")
  await expect(viewport).toHaveAttribute("data-zoom", "1")
  const movedBox = await api.boundingBox()
  expect(movedBox!.x).toBe(position!.x)
  expect(movedBox!.y).toBe(position!.y)
})

story("map grows measured height for an expanded task title", async ({ page }) => {
  await openExecutionFixture(page, "map")
  const schema = await page.locator('[data-testid="execution-map-node"][data-task-id="schema"]').boundingBox()
  const cli = await page.locator('[data-testid="execution-map-node"][data-task-id="cli"]').boundingBox()
  expect(cli!.height).toBeGreaterThan(schema!.height)
})

story("map relayouts when accessibility text size increases", async ({ page }) => {
  await openExecutionFixture(page, "map")
  const cli = page.locator('[data-testid="execution-map-node"][data-task-id="cli"]')
  const before = await cli.boundingBox()
  await page.getByTestId("execution-map").evaluate((element) => {
    ;(element as HTMLElement).style.fontSize = "26px"
    window.dispatchEvent(new Event("resize"))
  })
  await expect.poll(async () => (await cli.boundingBox())?.height ?? 0).toBeGreaterThan(before!.height)
})

story("map groups more than 200 visible tasks without losing identity or counts", async ({ page }) => {
  await openExecutionFixture(page, "map-large")
  await expect(page.getByTestId("execution-map-grouped")).toBeVisible()
  await expect(page.getByTestId("execution-map-grouped-note")).toContainText("grouped list")
  const nodes = page.getByTestId("execution-map-grouped-node")
  await expect(nodes).toHaveCount(250)
  const ids = await nodes.evaluateAll((list) => list.map((element) => element.getAttribute("data-task-id")))
  expect(new Set(ids).size).toBe(250)
  await expect(page.getByTestId("execution-progress-count")).toHaveText("0/250")
  await page.getByTestId("execution-map-phase").selectOption("Verify")
  await expect(page.getByTestId("execution-map-viewport")).toBeVisible()
  await expect(page.getByTestId("execution-map-node")).toHaveCount(125)
  await expect(page.getByTestId("execution-progress-count")).toHaveText("0/250")
})

story("map controls stay reachable in a narrow panel", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await openExecutionFixture(page, "map")
  await expect(page.getByTestId("execution-map")).toBeVisible()
  await expect(page.getByTestId("execution-map-zoom-in")).toBeVisible()
  await expect(page.getByTestId("execution-map-phase")).toBeVisible()
  await expect(page.locator('[data-testid="execution-map-node"][data-task-id="schema"]')).toBeVisible()
  await page.getByTestId("execution-map-zoom-in").click()
  await expect(page.getByTestId("execution-map-viewport")).toHaveAttribute("data-zoom", "1.25")
})

story("activity lists retained report events with a truncation boundary", async ({ page }) => {
  await openExecutionFixture(page, "activity")
  await expect(page.getByTestId("execution-activity")).toBeVisible()
  const events = page.getByTestId("execution-activity-event")
  await expect(events).toHaveCount(100)
  await expect(events.first()).toHaveAttribute("data-revision", "1150")
  await expect(events.nth(99)).toHaveAttribute("data-revision", "1051")
  await expect(page.getByTestId("execution-activity-boundary")).toContainText("revision 1001")
  await page
    .getByTestId("execution-activity-more")
    .evaluate((element) => (element as HTMLElement).click())
  await expect(events).toHaveCount(150)
  await expect(page.getByTestId("execution-activity-more")).toHaveCount(0)
  await expect(page.getByTestId("execution-activity-boundary")).toBeVisible()
})

story("activity links report events to task details and referenced sessions", async ({ page }) => {
  await openExecutionFixture(page, "activity")
  await page.getByRole("button", { name: "Open task API contract", exact: true }).first().click()
  await expect(page.getByTestId("execution-task-title")).toHaveText("API contract")
  await expect(page.getByTestId("execution-activity")).toHaveCount(0)
  await page.getByRole("tab", { name: "Activity", exact: true }).click()
  await page.getByRole("button", { name: "Open session Child implementer", exact: true }).first().click()
  await expect(page.getByTestId("navigation-target")).toHaveText("wsl/child")
})

story("activity reports telemetry coverage from loaded sessions", async ({ page }) => {
  await openExecutionFixture(page, "activity")
  const usage = page.getByTestId("execution-activity-usage")
  await expect(usage).toHaveAttribute("data-coverage", "complete")
  await expect(usage).toContainText("Reported cost $2.50")
  await expect(usage).toContainText("Reported tokens 2,425")
  await expect(usage).toContainText("not a provider invoice")
})

story("agents show native usage telemetry only where the session reports it", async ({ page }) => {
  await openExecutionFixture(page, "agents-telemetry")
  const root = page.getByRole("treeitem", { name: /Root controller/ })
  await expect(root.getByTestId("execution-agent-usage")).toHaveText("$1.50 · 1,750 tokens")
  const idle = page.getByRole("treeitem", { name: /Idle reviewer/ })
  await expect(idle.getByTestId("execution-agent-usage")).toHaveCount(0)
})

story("production session owner loads native telemetry for agents", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-agents")
  const root = page.getByRole("treeitem", { name: /Root controller/ })
  await expect(root.getByTestId("execution-agent-usage")).toHaveText("$1.50 · 1,750 tokens")
  const idle = page.getByRole("treeitem", { name: /Idle reviewer/ })
  await expect(idle.getByTestId("execution-agent-usage")).toHaveCount(0)
  const usage = page.getByTestId("execution-activity-usage")
  await expect(usage).toHaveAttribute("data-coverage", "partial")
  await expect(usage).toContainText("Reported cost $2.00")
  await expect(usage).toContainText("Reported tokens 2,350")
})

story("production session agents transition from running to idle without rehydration", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-agents")
  const root = page.getByRole("treeitem", { name: /Root controller/ })
  await expect(root.getByText("Running", { exact: true })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: /Idle reviewer/ })).toBeVisible()
  await page.getByRole("button", { name: "Set agents idle", exact: true }).click()
  await expect(root.getByText("Idle", { exact: true })).toBeVisible()
})

story("production session agents observe pending native requests without rehydration", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-agents")
  const root = page.getByRole("treeitem", { name: /Root controller/ })
  await expect(root.getByText("Running", { exact: true })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: /Idle reviewer/ })).toBeVisible()
  await page.getByRole("button", { name: "Show agent request", exact: true }).click()
  await expect(root.getByText("Needs input", { exact: true })).toBeVisible()
})

story("new native descendants do not collapse expanded execution", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-agents")
  await expect(page.getByRole("treeitem", { name: /Root controller/ })).toBeVisible()
  await page.getByRole("button", { name: "Expand execution state", exact: true }).click()
  await expect(page.getByTestId("live-execution-expanded")).toHaveText("true")
  await page.getByRole("button", { name: "Add descendant", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: /new-descendant/ })).toBeVisible()
  await expect(page.getByTestId("live-execution-expanded")).toHaveText("true")
})

story("native ancestry resolution retries after reconnect", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-offline")
  await expect(page.getByTestId("live-execution-root")).toHaveText("")
  await page.getByRole("button", { name: "Reconnect native transport", exact: true }).click()
  await expect(page.getByTestId("live-execution-root")).toHaveText("root")
  await expect(page.getByRole("treeitem", { name: /Root controller/ })).toBeVisible()
})

story("native ancestry resolution retries from the agent retry action", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-resolution-retry")
  await expect(page.getByTestId("live-execution-root")).toHaveText("")
  await page.getByRole("button", { name: "Recover native transport", exact: true }).click()
  await page.getByRole("button", { name: "Retry native agents", exact: true }).click()
  await expect(page.getByTestId("live-execution-root")).toHaveText("root")
})

story("hidden native agents do not drain queued transcript requests", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-activity")
  await expect(page.getByTestId("live-message-fetches")).toHaveText("4")
  await page.getByRole("button", { name: "Hide execution agents", exact: true }).click()
  await page.getByRole("button", { name: "Release transcript requests", exact: true }).click()
  await expect(page.getByTestId("live-message-fetches")).toHaveText("4")
})

story("disposed native agents do not drain queued transcript requests", async ({ page }) => {
  await openExecutionFixture(page, "session-execution-activity")
  await expect(page.getByTestId("live-message-fetches")).toHaveText("4")
  await page.getByRole("button", { name: "Dispose execution owner", exact: true }).click()
  await page.getByRole("button", { name: "Release transcript requests", exact: true }).click()
  await expect(page.getByTestId("live-message-fetches")).toHaveText("4")
})

story("expanded execution preserves task selection and restores focus", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await page.getByRole("button", { name: "Select API task", exact: true }).click()
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  await expect(page.getByTestId("selected-task")).toHaveText("api")
  await page.getByRole("button", { name: "Collapse execution", exact: true }).click()
  await expect(page.getByTestId("selected-task")).toHaveText("api")
  await expect(page.getByRole("button", { name: "Expand execution", exact: true })).toBeFocused()
})

story("expanded execution covers native panes with one graph and one reconciliation owner", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await expect(page.getByTestId("native-pane-hidden")).toHaveText("false")
  await expect(page.getByTestId("native-pane-overlay")).toBeVisible()
  await expect(page.getByTestId("execution-model-count")).toHaveText("1")
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toBeVisible()
  await expect(page.getByTestId("execution-panel")).toHaveCount(1)
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "expanded")
  await expect(page.getByTestId("execution-map")).toHaveCount(1)
  await expect(page.getByTestId("native-pane-hidden")).toHaveText("true")
  await expect(page.getByTestId("native-pane-overlay")).toBeHidden()
  await expect(page.getByTestId("execution-model-count")).toHaveText("1")
  await page.getByRole("button", { name: "Collapse execution", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toHaveCount(0)
  await expect(page.getByTestId("execution-panel")).toHaveCount(1)
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "panel")
  await expect(page.getByTestId("execution-map")).toHaveCount(1)
  await expect(page.getByTestId("native-pane-hidden")).toHaveText("false")
  await expect(page.getByTestId("native-pane-overlay")).toBeVisible()
  await expect(page.getByTestId("execution-model-count")).toHaveText("1")
})

story("expanded execution restores the active tab and panel width and survives an open terminal", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await expect(page.getByTestId("retained-terminal")).toHaveCount(1)
  await expect(page.getByTestId("active-tab")).toHaveText("file://a.ts")
  await expect(page.getByTestId("panel-width")).toHaveText("600")
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toBeVisible()
  await expect(page.getByTestId("retained-terminal")).toHaveCount(1)
  await page.getByRole("button", { name: "Switch tab while expanded", exact: true }).click()
  await page.getByRole("button", { name: "Resize panel while expanded", exact: true }).click()
  await expect(page.getByTestId("active-tab")).toHaveText("file://b.ts")
  await expect(page.getByTestId("panel-width")).toHaveText("900")
  await page.getByRole("button", { name: "Collapse execution", exact: true }).click()
  await expect(page.getByTestId("active-tab")).toHaveText("file://a.ts")
  await expect(page.getByTestId("panel-width")).toHaveText("600")
  await expect(page.getByTestId("retained-terminal")).toHaveCount(1)
})

story("expanded execution closes on escape unless an inner menu owns escape", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toBeVisible()
  await page.getByTestId("inner-menu").focus()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("execution-expanded")).toBeVisible()
  await page.getByTestId("execution-expanded").click({ position: { x: 6, y: 6 } })
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("execution-expanded")).toHaveCount(0)
})

story("expanded execution returns to the request area without acknowledging", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await page.getByRole("button", { name: "Show pending question", exact: true }).click()
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  const banner = page.getByTestId("execution-pending-banner")
  await expect(banner).toBeVisible()
  await expect(page.getByTestId("question-reply-count")).toHaveText("0")
  await banner.getByRole("button", { name: "Return to request", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toHaveCount(0)
  await expect(page.getByTestId("native-request-region")).toBeFocused()
  await expect(page.getByTestId("question-reply-count")).toHaveText("0")
})

story("expanded execution falls back when the saved focus target is disposed", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await page.getByRole("button", { name: "Expand from a disposed target", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toBeVisible()
  await page.getByRole("button", { name: "Collapse execution", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Expand execution", exact: true })).toBeFocused()
})

story("expanded execution resets on a root switch without leaking the old transient state", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await page.getByRole("button", { name: "Select API task", exact: true }).click()
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  await expect(page.getByTestId("selected-task")).toHaveText("api")
  await page.getByRole("button", { name: "Switch root", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toHaveCount(0)
  await expect(page.getByTestId("execution-scope-root")).toHaveText("other-root")
  await expect(page.getByTestId("selected-task")).toHaveText("")
  await expect(page.getByTestId("active-tab")).toHaveText("file://a.ts")
  await page.getByRole("button", { name: "Switch root", exact: true }).click()
  await expect(page.getByTestId("execution-scope-root")).toHaveText("root")
  await expect(page.getByTestId("selected-task")).toHaveText("api")
})

story("production session owner persists execution preferences per identity", async ({ page }) => {
  await openExecutionFixture(page, "evidence-production")
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem("opencode.global.dat:execution") ?? ""
          return raw.includes("run-1") && raw.includes("task-api")
        }),
      { timeout: 10_000 },
    )
    .toBe(true)
})

story("mobile execution view is selectable and defaults to the task list at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "tracked")
  await expect(page.getByTestId("execution-mobile-composition")).toBeVisible()
  await expect(page.getByTestId("execution-desktop-composition")).toHaveCount(0)
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "mobile")
  await expect(page.getByTestId("execution-tasks-list")).toBeVisible()
  await expect(page.getByTestId("execution-map")).toHaveCount(0)
  await expect(page.getByTestId("execution-model-count")).toHaveText("1")
})

story("mobile execution returns to a pending request without replying", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "session-screen-mobile-pending")
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  const banner = page.getByTestId("execution-pending-banner")
  await expect(banner).toBeVisible()
  await banner.getByRole("button", { name: "Return to request", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeFocused()
  await expect(page.getByTestId("production-native-replies")).toHaveText("0")
})

story("execution presentation switches at the 768 px boundary and expands at 1440 px", async ({ page }) => {
  await page.setViewportSize({ width: 767, height: 760 })
  await openExecutionFixture(page, "tracked")
  await expect(page.getByTestId("execution-mobile-composition")).toBeVisible()
  await page.setViewportSize({ width: 768, height: 760 })
  await expect(page.getByTestId("execution-desktop-composition")).toBeVisible()
  await expect(page.getByTestId("execution-mobile-composition")).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  await expect(page.getByTestId("execution-expanded")).toBeVisible()
  await expect(page.getByTestId("execution-model-count")).toHaveText("1")
})

story("mobile execution controls stay reachable at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 195, height: 380 })
  await openExecutionFixture(page, "tracked")
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "mobile")
  for (const name of ["Map", "Agents", "Tasks", "Activity"]) {
    const control = page.getByRole("tab", { name, exact: true })
    await expect(control).toBeVisible()
    const box = await control.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(195)
  }
  await page.getByRole("tab", { name: "Tasks", exact: true }).click()
  await expect(page.getByTestId("execution-tasks-list")).toBeVisible()
  const search = page.getByRole("searchbox", { name: "Search tasks", exact: true })
  await expect(search).toBeVisible()
  await expect(page.getByLabel("Filter by state")).toBeVisible()
  await expect(page.getByLabel("Filter by phase")).toBeVisible()
  await search.fill("schema")
  await expect(page.getByTestId("execution-tasks-list").locator("li")).toHaveCount(1)
  await page
    .getByRole("button", { name: /Storage schema/ })
    .evaluate((element) => (element as HTMLElement).click())
  await expect(page.getByTestId("selected-task")).toHaveText("schema")
})

story("mobile execution adopts a run that arrives after the view opens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "tracked-late")
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "mobile")
  await expect(page.getByTestId("execution-tasks-list")).toHaveCount(0)
  await expect(page.getByRole("tree", { name: "Agent tree" })).toBeVisible()
  await page.getByRole("button", { name: "Register run", exact: true }).click()
  await expect(page.getByTestId("execution-tasks-list")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Tasks", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tree", { name: "Agent tree" })).toHaveCount(0)
})

story("mobile execution keeps one panel and works in rtl", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "tracked-rtl")
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toHaveCount(1)
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "mobile")
  await expect(page.getByTestId("execution-tasks-list")).toBeVisible()
  await expect(page.getByTestId("native-pane-hidden")).toHaveText("false")
})

story("execution keyboard path reaches tasks and returns to chat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "tracked")
  await page.getByRole("tab", { name: "Execution", exact: true }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("tab", { name: "Tasks", exact: true }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("button", { name: "Select API task", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("selected-task")).toHaveText("api")
  await page.getByRole("button", { name: "Return to conversation", exact: true }).click()
  await expect(page.getByTestId("native-composer").locator('[data-component="composer-editor"]')).toBeFocused()
})

story("returning to chat focuses the real composer editor rather than its scroll viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "tracked")
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  await page.getByRole("button", { name: "Return to conversation", exact: true }).click()
  const composer = page.getByTestId("native-composer")
  const editor = composer.locator('[data-component="composer-editor"]')
  await expect(editor).toBeFocused()
  await expect(editor).toHaveAttribute("contenteditable", "true")
  await expect(editor).toHaveAttribute("role", "textbox")
  const viewportFocused = await composer.evaluate((element) => {
    const viewport = element.querySelector('[data-component="composer-scroll"] [tabindex]')
    return viewport !== null && viewport === document.activeElement
  })
  expect(viewportFocused).toBe(false)
})

story("execution subview toolbar follows the tabs pattern", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  const tablist = page.getByRole("tablist", { name: "Execution views", exact: true })
  await expect(tablist).toBeVisible()
  await expect(tablist.getByRole("tab")).toHaveCount(4)
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("tab", { name: "Map", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toBeFocused()
  await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "false")
  await page.keyboard.press("End")
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeFocused()
  await page.keyboard.press("Home")
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByTestId("execution-activity")).toBeVisible()
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "execution-subview-tab-activity")
})

story("execution subview tabs keep a roving tab stop in both directions", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  const map = page.getByRole("tab", { name: "Map", exact: true })
  const agents = page.getByRole("tab", { name: "Agents", exact: true })
  const activity = page.getByRole("tab", { name: "Activity", exact: true })
  await expect(map).toHaveAttribute("tabindex", "0")
  await expect(agents).toHaveAttribute("tabindex", "-1")
  await map.focus()
  await page.keyboard.press("ArrowRight")
  await expect(agents).toBeFocused()
  await expect(agents).toHaveAttribute("tabindex", "0")
  await expect(map).toHaveAttribute("tabindex", "-1")
  await page.keyboard.press("End")
  await expect(activity).toBeFocused()
  await expect(activity).toHaveAttribute("tabindex", "0")
  await expect(agents).toHaveAttribute("tabindex", "-1")
  await page.keyboard.press("Home")
  await expect(map).toBeFocused()
  await expect(map).toHaveAttribute("tabindex", "0")

  await openExecutionFixture(page, "tracked-rtl")
  const rtlMap = page.getByRole("tab", { name: "Map", exact: true })
  const rtlAgents = page.getByRole("tab", { name: "Agents", exact: true })
  const rtlActivity = page.getByRole("tab", { name: "Activity", exact: true })
  await rtlMap.focus()
  await page.keyboard.press("ArrowRight")
  await expect(rtlActivity).toBeFocused()
  await expect(rtlActivity).toHaveAttribute("tabindex", "0")
  await expect(rtlMap).toHaveAttribute("tabindex", "-1")
  await page.keyboard.press("ArrowLeft")
  await expect(rtlMap).toBeFocused()
  await expect(rtlMap).toHaveAttribute("tabindex", "0")
  await expect(rtlAgents).toHaveAttribute("tabindex", "-1")
})

story("execution controls show focus for keyboard users", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  const subview = page.getByRole("tab", { name: "Map", exact: true })
  await focusWithKeyboard(page, subview)
  const outline = await subview.evaluate((element) => {
    const style = getComputedStyle(element)
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
  })
  expect(outline.style).not.toBe("none")
  expect(outline.width).toBeGreaterThanOrEqual(2)
})

story("expanded execution never traps keyboard focus", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  const expanded = page.getByTestId("execution-expanded")
  await expect(expanded).toBeVisible()
  await page.getByTestId("execution-collapse").focus()
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab")
    const trapped = await expanded.evaluate((element) => element.contains(document.activeElement))
    if (!trapped) return
  }
  throw new Error("focus stayed trapped inside the expanded execution overlay")
})

story("execution status states pair text with an icon and a stable live message", async ({ page }) => {
  const attentionStates = [
    ["observer", "2 active agents", ""],
    ["offline-pending", "Execution status stale", "Execution status stale"],
    ["permission-pending", "Waiting for your input", "Waiting for your input"],
    ["blocked-pending", "Execution blocked", "Execution blocked"],
  ] as const
  for (const [scenario, label, live] of attentionStates) {
    await openExecutionFixture(page, scenario)
    await expect(page.getByTestId("execution-status-label")).toHaveText(label)
    await expect(page.getByTestId("execution-status-icon")).toBeVisible()
    await expect(page.getByTestId("execution-status-live")).toHaveText(live)
  }
  await openExecutionFixture(page, "tracked-progress")
  await expect(page.getByTestId("execution-status-label")).toHaveText("3 of 5 verified")
  await expect(page.getByTestId("execution-status-live")).toHaveText("")
})

story("execution surfaces render localized copy without missing keys", async ({ page }) => {
  for (const scenario of ["observer", "tracked", "tasks-detailed", "map-large", "activity", "permission-pending"]) {
    await openExecutionFixture(page, scenario)
    if (scenario === "observer" || scenario === "permission-pending") {
      await page.getByRole("button", { name: "Open execution overview", exact: true }).click()
    }
    const fixture = page.getByTestId("execution-fixture")
    const text = await fixture.innerText()
    expect(text).not.toMatch(/execution\.[a-z]/)
    expect(text).not.toContain("{{")
    const attributes = await fixture.evaluate((element) =>
      [...element.querySelectorAll("*")].flatMap((node) =>
        ["aria-label", "title", "placeholder", "alt"].flatMap((name) => {
          const value = node.getAttribute(name)
          return value ? [`${name}=${value}`] : []
        }),
      ),
    )
    for (const attribute of attributes) {
      expect(attribute).not.toMatch(/execution\.[a-z]/)
      expect(attribute).not.toContain("{{")
    }
  }
})

story("execution compact copy keeps the shared line height", async ({ page }) => {
  await openExecutionFixture(page, "tasks-detailed")
  const violations = await page.getByTestId("execution-panel").evaluate((element) =>
    [...element.querySelectorAll<HTMLElement>("*")].flatMap((node) => {
      const size = Number.parseFloat(getComputedStyle(node).fontSize)
      const line = Number.parseFloat(getComputedStyle(node).lineHeight)
      if (!Number.isFinite(size) || !Number.isFinite(line)) return []
      if (size <= 13 && line + 0.01 < 16) return [node.getAttribute("class") ?? node.tagName]
      return []
    }),
  )
  expect(violations).toEqual([])
  await openExecutionFixture(page, "map")
  const mapMetrics = await page.getByTestId("execution-map").evaluate((element) => {
    const style = getComputedStyle(element)
    return { fontSize: style.fontSize, lineHeight: style.lineHeight }
  })
  expect(mapMetrics.fontSize).toBe("13px")
  expect(mapMetrics.lineHeight).toBe("16px")
})

story("execution agent indentation follows the document direction", async ({ page }) => {
  await openExecutionFixture(page, "agents-assignments")
  const assignments = page.getByTestId("execution-agents").locator(".execution-agent__assignments").first()
  await expect(assignments).toBeVisible()
  const ltr = await assignments.evaluate((element) => {
    const style = getComputedStyle(element)
    return { left: style.paddingLeft, right: style.paddingRight }
  })
  expect(ltr.left).toBe("24px")
  expect(ltr.right).toBe("0px")
  await page.getByTestId("execution-fixture").evaluate((element) => {
    element.setAttribute("dir", "rtl")
  })
  const rtl = await assignments.evaluate((element) => {
    const style = getComputedStyle(element)
    return { left: style.paddingLeft, right: style.paddingRight, direction: style.direction }
  })
  expect(rtl.right).toBe("24px")
  expect(rtl.left).toBe("0px")
  expect(rtl.direction).toBe("rtl")
})

story("execution surfaces respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await openExecutionFixture(page, "home-mixed")
  const summary = page.getByTestId("home-root-tracked").getByTestId("execution-summary")
  await expect(summary).toBeVisible()
  expect(await summary.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("none")
  await openExecutionFixture(page, "tracked")
  await page.getByRole("button", { name: "Expand execution", exact: true }).click()
  const animated = await page.getByTestId("execution-expanded").evaluate(
    (element) =>
      [...element.querySelectorAll("*")].filter((node) => {
        const style = getComputedStyle(node)
        return style.animationName !== "none" && style.animationDuration !== "0s"
      }).length,
  )
  expect(animated).toBe(0)
})

story("execution surfaces avoid horizontal overflow at 200 percent zoom", async ({ page }) => {
  await page.setViewportSize({ width: 195, height: 380 })
  await openExecutionFixture(page, "tracked")
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  const panel = page.getByTestId("execution-panel")
  await expect(panel).toHaveAttribute("data-presentation", "mobile")
  expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  for (const name of ["Map", "Agents", "Tasks", "Activity"]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible()
  }
  await page.getByRole("tab", { name: "Tasks", exact: true }).click()
  await expect(page.getByTestId("execution-tasks-list")).toBeVisible()
})

story("execution panel renders in light and dark color schemes", async ({ page }) => {
  await openExecutionFixture(page, "tracked")
  const host = page.getByTestId("execution-fixture")
  const panel = page.getByTestId("execution-panel")
  await host.evaluate((element) => {
    element.setAttribute("data-color-scheme", "dark")
  })
  const dark = await panel.evaluate((element) => getComputedStyle(element).backgroundColor)
  await host.evaluate((element) => {
    element.setAttribute("data-color-scheme", "light")
  })
  const light = await panel.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(dark).toMatch(/^rgb/)
  expect(light).toMatch(/^rgb/)
  expect(dark).not.toBe(light)
})

story("execution visual fixture captures the observer surface", async ({ page }, testInfo) => {
  await openExecutionFixture(page, "observer")
  await page.getByRole("button", { name: "Open execution overview", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toBeVisible()
  await captureFixtureScreenshot(page, testInfo, "observer")
})

story("execution visual fixture captures an active run", async ({ page }, testInfo) => {
  await openExecutionFixture(page, "tracked")
  await expect(page.getByTestId("execution-map")).toBeVisible()
  await captureFixtureScreenshot(page, testInfo, "active-run")
})

story("execution visual fixture captures a failed bridge", async ({ page }, testInfo) => {
  await openExecutionFixture(page, "session-execution-live")
  await expect(page.getByTestId("execution-status-badge")).toHaveAttribute("data-attention", "failed")
  await captureFixtureScreenshot(page, testInfo, "error")
})

story("execution visual fixture captures a stale snapshot", async ({ page }, testInfo) => {
  await openExecutionFixture(page, "tasks-stale")
  await expect(page.getByTestId("execution-progress-stale")).toBeVisible()
  await captureFixtureScreenshot(page, testInfo, "stale")
})

story("execution visual fixture captures a pending permission", async ({ page }, testInfo) => {
  await openExecutionFixture(page, "permission-pending")
  await page.getByRole("button", { name: "Open execution overview", exact: true }).click()
  await expect(page.getByTestId("execution-status-badge")).toHaveAttribute("data-attention", "needs_input")
  await captureFixtureScreenshot(page, testInfo, "permission-pending")
})

story("execution visual fixture captures the grouped large graph", async ({ page }, testInfo) => {
  await openExecutionFixture(page, "map-large")
  await expect(page.getByTestId("execution-map-grouped")).toBeVisible()
  await captureFixtureScreenshot(page, testInfo, "large-graph")
})

story("execution visual fixture captures the mobile presentation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExecutionFixture(page, "tracked")
  await page.getByRole("tab", { name: "Execution", exact: true }).click()
  await expect(page.getByTestId("execution-panel")).toHaveAttribute("data-presentation", "mobile")
  await captureFixtureScreenshot(page, testInfo, "mobile")
})
