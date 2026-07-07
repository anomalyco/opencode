import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalComposerFocus"
const projectID = "proj_terminal_composer_focus"
const sessionID = "ses_terminal_composer_focus"
const ptyID = "pty_terminal_composer_focus"

test.use({ viewport: { width: 1440, height: 900 } })

test("routes typing to the composer unless the open terminal is focused", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "terminal-composer-focus",
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
        slug: "terminal-composer-focus",
        projectID,
        directory,
        title: "Terminal composer focus",
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
      body: JSON.stringify({ id: ptyID, title: "Terminal 1" }),
    }),
  )
  await page.route(`**/pty/${ptyID}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  )
  await page.route(`**/pty/${ptyID}/connect-token*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ ticket: "e2e-ticket" }),
    }),
  )
  await page.routeWebSocket(new RegExp(`/pty/${ptyID}/connect`), () => undefined)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, "Terminal composer focus")

  const composer = page.locator('[data-component="prompt-input"]')
  const terminal = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  await page.keyboard.type("x")
  await expect(composer).toHaveText("")

  await page.waitForTimeout(300)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.type("a")

  await expect(composer).toBeFocused()
  await expect(composer).toHaveText("a")
})
