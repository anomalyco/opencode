import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/HiddenTerminalRegression"
const projectID = "proj_hidden_terminal_regression"
const sessionID = "ses_hidden_terminal_regression"
const title = "Hidden terminal regression"

test("unmounts the terminal renderer while the pane is hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "hidden-terminal-regression",
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
        slug: "hidden-terminal-regression",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/pty", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "pty_hidden_terminal", title: "Terminal 1" }),
    }),
  )
  await page.route("**/pty/pty_hidden_terminal", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  )
  await page.routeWebSocket("**/pty/pty_hidden_terminal/connect", () => undefined)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  await page.keyboard.press("Control+Backquote")
  const panel = page.locator("#terminal-panel")
  await expect(panel).toHaveAttribute("aria-hidden", "false")
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()

  await page.keyboard.press("Control+Backquote")
  await expect(panel).toHaveAttribute("aria-hidden", "true")
  await expect(page.locator('[data-component="terminal"]')).toHaveCount(0)

  await page.setViewportSize({ width: 1200, height: 700 })
  await expect(page.locator('[data-component="terminal"]')).toHaveCount(0)

  await page.keyboard.press("Control+Backquote")
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()
})

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
