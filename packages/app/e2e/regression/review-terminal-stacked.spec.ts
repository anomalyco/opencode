import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewTerminalStacked"
const projectID = "proj_review_terminal_stacked"
const sessionID = "ses_review_terminal_stacked"
const title = "Review terminal stacked"
const branchDiffs = [
  fileDiff(".github/actions/setup-bun/action.yml", 7),
  ...Array.from({ length: 2_739 }, (_, index) =>
    fileDiff(
      `src/branch/d${String(Math.floor(index / 100)).padStart(5, "0")}/generated-${String(index).padStart(4, "0")}.ts`,
      100,
      false,
    ),
  ),
]

test("keeps the review tree and terminal sized when both panels are open", async ({ page }) => {
  test.setTimeout(120_000)
  const events: Array<{ directory: string; payload: Record<string, unknown> }> = []
  let detailVersion = 1
  let detailFailures = 1
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "review-terminal-stacked",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "review-terminal-stacked",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    sessionStatus: { [sessionID]: { type: "idle" } },
    pageMessages: () => ({ items: [] }),
    events: () => events.splice(0, 1),
    eventRetry: 16,
  })
  await page.route(/\/vcs(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ branch: "review-pane-performance", default_branch: "dev" }),
    }),
  )
  await page.route("**/vcs/diff**", (route) => {
    const url = new URL(route.request().url())
    const scope = url.searchParams.get("directory")?.replaceAll("\\", "/")
    const detail = scope?.endsWith("/src/branch/d00027")
    if (detail && detailFailures-- > 0) return route.fulfill({ status: 500, body: "retry detail" })
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        url.searchParams.get("mode") === "branch"
          ? detail
            ? branchDiffs
                .filter((diff) => diff.file.startsWith("src/branch/d00027/"))
                .map((diff) => fileDiff(diff.file, diff.additions, true, detailVersion))
            : branchDiffs
          : Array.from({ length: 7 }, (_, index) => fileDiff(`src/git-${index}.ts`, 1)),
      ),
    })
  })
  await page.route("**/pty", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "pty_review_terminal", title: "Terminal 1" }),
    }),
  )
  await page.route("**/pty/pty_review_terminal", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  )
  await page.routeWebSocket("**/pty/pty_review_terminal/connect", () => undefined)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:layout",
      JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
    )
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expect(page.locator("#review-panel")).toBeVisible()
  await expectTree(page, 8, "git-0.ts")

  await selectMode(page, "Git changes", "Branch changes")
  await expect(page.locator("#session-side-panel-review-tab")).toHaveText("Files Changed 2740")
  await page.keyboard.press("Control+Backquote")
  await expect(page.locator("#terminal-panel")).toBeVisible()
  await expectTree(page, 2_773, "action.yml")
  await expectStackGeometry(page)

  const treeViewport = page.locator('#review-panel [data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await treeViewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect
    .poll(() => treeViewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  const lastFile = page.getByRole("button", { name: "generated-2738.ts" })
  await expect(lastFile).toBeVisible()
  const bottomGap = await lastFile.evaluate((element) => {
    const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!.getBoundingClientRect()
    return viewport.bottom - element.getBoundingClientRect().bottom
  })
  expect(bottomGap).toBeGreaterThanOrEqual(0)
  expect(bottomGap).toBeLessThanOrEqual(16)
  const lazyDiff = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return (
      url.pathname === "/vcs/diff" &&
      url.searchParams.get("directory")?.replaceAll("\\", "/").endsWith("/src/branch/d00027") === true
    )
  })
  await lastFile.click()
  await lazyDiff
  const preview = page.locator('[data-slot="session-review-v2-diff-scroll"]')
  await expect(preview).toContainText("after-1")
  detailVersion = 2
  events.push(statusEvent("busy"))
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
  const refreshedDiff = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return (
      url.pathname === "/vcs/diff" &&
      url.searchParams.get("directory")?.replaceAll("\\", "/").endsWith("/src/branch/d00027") === true
    )
  })
  events.push(statusEvent("idle"))
  await refreshedDiff
  await expect(preview).toContainText("after-2")
  await selectMode(page, "Branch changes", "Git changes")
  await expectTree(page, 8, "git-0.ts")
  await page.getByRole("button", { name: "git-0.ts" }).click()
  await selectMode(page, "Git changes", "Branch changes")
  await expectTree(page, 2_773, "action.yml")

  const filter = page.getByRole("searchbox", { name: "Filter files" })
  await filter.fill("generated-2738")
  await expectTree(page, 1, "generated-2738.ts")
  await filter.fill("")
  await expectTree(page, 2_773, "action.yml")

  await page.getByRole("button", { name: "Toggle file tree" }).click()
  await expect(page.locator('[data-slot="session-review-v2-sidebar"]')).toHaveCount(0)
  await expect(page.locator('#review-panel [data-component="file-tree-v2"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Toggle file tree" }).click()
  await expectTree(page, 2_773, "action.yml")

  await page.keyboard.press("Control+Backquote")
  await expect(page.locator("#terminal-panel")).toHaveCount(0)
  await expectTree(page, 2_773, "action.yml")
  await page.keyboard.press("Control+Backquote")
  await expect(page.locator("#terminal-panel")).toBeVisible()
  await expectTree(page, 2_773, "action.yml")

  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(page.locator("#review-panel")).toHaveCount(0)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expectTree(page, 2_773, "action.yml")
  await page.setViewportSize({ width: 1_000, height: 700 })
  await expectTree(page, 2_773, "action.yml")
  await expectStackGeometry(page)
  await page.setViewportSize({ width: 1_000, height: 120 })
  await page.setViewportSize({ width: 1_400, height: 900 })
  await expectTree(page, 2_773, "action.yml")
  await expectStackGeometry(page)
})

async function selectMode(page: Page, current: string, next: string) {
  await page.getByRole("button", { name: current }).click()
  const option = page.getByRole("option", { name: next })
  await expect(option).toBeVisible()
  await option.click()
}

async function expectTree(page: Page, total: number, file: string) {
  await expectMountedTree(page, total)
  await expect(page.getByRole("button", { name: file })).toBeVisible()
}

async function expectMountedTree(page: Page, total: number) {
  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree).toHaveAttribute("data-total-rows", String(total))
  await expect
    .poll(() => tree.evaluate((element) => element.querySelectorAll('[data-slot="file-tree-v2-row"]').length))
    .toBeGreaterThan(0)
  const state = await tree.evaluate((element) => ({
    root: element.getBoundingClientRect().height,
    viewport: element.closest<HTMLElement>(".scroll-view__viewport")!.getBoundingClientRect().height,
    rows: element.querySelectorAll('[data-slot="file-tree-v2-row"]').length,
  }))
  expect(state.viewport).toBeGreaterThan(0)
  expect(state.root).toBeGreaterThan(0)
  expect(state.rows).toBeGreaterThan(0)
  expect(state.rows).toBeLessThanOrEqual(60)
}

async function expectStackGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const review = document.querySelector<HTMLElement>("#review-panel")!
    const terminal = document.querySelector<HTMLElement>("#terminal-panel")!
    const reviewParent = review.parentElement!.getBoundingClientRect()
    const terminalParent = terminal.parentElement!.getBoundingClientRect()
    return {
      review: review.getBoundingClientRect().height,
      reviewParent: reviewParent.height,
      terminal: terminal.getBoundingClientRect().height,
      terminalParent: terminalParent.height,
    }
  })
  expect(Math.abs(geometry.review - geometry.reviewParent)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.terminal - geometry.terminalParent)).toBeLessThanOrEqual(1)
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function statusEvent(type: "busy" | "idle") {
  return {
    directory,
    payload: { type: "session.status", properties: { sessionID, status: { type } } },
  }
}

function fileDiff(file: string, additions: number, loaded = true, version = 1) {
  return {
    file,
    additions,
    deletions: 0,
    status: "modified",
    patch: loaded
      ? `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after-${version}'\n`
      : `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}`,
  }
}
