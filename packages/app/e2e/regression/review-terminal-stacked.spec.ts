import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionReady } from "../utils/waits"

const directory = "C:/OpenCode/ReviewTerminalStacked"
const projectID = "proj_review_terminal_stacked"
const sessionID = "ses_review_terminal_stacked"
const title = "Review terminal stacked"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
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
  })
  await page.route(/\/api\/vcs(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory, canonical: directory } },
        data: { branch: "review-pane-performance", defaultBranch: "dev" },
      }),
    }),
  )
  await page.route("**/api/vcs/diff**", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory, canonical: directory } },
        data: branchDiffs,
      }),
    })
  })
  await page.route("**/pty*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: {
          id: "pty_review_terminal",
          title: "Terminal 1",
          command: "cmd.exe",
          args: [],
          cwd: directory,
          status: "running",
          pid: 1,
        },
      }),
    }),
  )
  await page.route("**/api/pty/pty_review_terminal*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: {
          id: "pty_review_terminal",
          title: "Terminal 1",
          command: "cmd.exe",
          args: [],
          cwd: directory,
          status: "running",
          pid: 1,
        },
      }),
    }),
  )
  await page.route("**/api/pty/pty_review_terminal/connect-token*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: { ticket: "e2e-ticket", expires_in: 60 },
      }),
    }),
  )
  await page.routeWebSocket("**/api/pty/pty_review_terminal/connect", () => undefined)
  await page.addInitScript(() => {
    localStorage.setItem(
      "opencode.global.dat:layout",
      JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
    )
  })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionReady(page, { server, sessionID, title })
  await expect(page.locator("#review-panel")).toBeVisible()
  await expectTree(page, 2_773, "action.yml")
  await expect(page.locator("#session-side-panel-review-tab")).toHaveText("Files Changed 2740")
  await page.keyboard.press("Control+Backquote")
  await expect(page.locator("#terminal-panel")).toBeVisible()
  await expectTree(page, 2_773, "action.yml")
  await expectStackGeometry(page)
})

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
    const sidebar = review.querySelector<HTMLElement>('[data-slot="session-review-v2-sidebar"]')!
    return {
      review: review.getBoundingClientRect().height,
      reviewParent: reviewParent.height,
      terminal: terminal.getBoundingClientRect().height,
      terminalParent: terminalParent.height,
      sidebar: sidebar.getBoundingClientRect().width,
    }
  })
  expect(Math.abs(geometry.review - geometry.reviewParent)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.terminal - geometry.terminalParent)).toBeLessThanOrEqual(1)
  expect(geometry.sidebar).toBeGreaterThanOrEqual(240)
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function fileDiff(file: string, additions: number, loaded = true) {
  return {
    file,
    additions,
    deletions: 0,
    status: "modified",
    patch: loaded
      ? `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after'\n`
      : `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}`,
  }
}
