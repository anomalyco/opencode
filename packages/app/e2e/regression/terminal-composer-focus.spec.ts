import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalComposerFocus"
const projectID = "proj_terminal_composer_focus"
const sessionID = "ses_terminal_composer_focus"
const ptyID = "pty_terminal_composer_focus"
const newPtyID = "pty_terminal_composer_focus_new"

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
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
})

test("routes typing to the composer unless the open terminal is focused", async ({ page }) => {
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

test("keeps composer focus when a cached terminal finishes mounting", async ({ page }) => {
  const ghostty = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const created = { count: 0 }
  await page.route("**/pty", (route) => {
    created.count += 1
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: ptyID, title: "Terminal 1" }),
    })
  })
  await page.route(/ghostty-web/, async (route) => {
    ghostty.resolve()
    await release.promise
    await route.continue()
  })
  await seedCachedTerminal(page)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`, { waitUntil: "commit" })
  await expectSessionTitle(page, "Terminal composer focus")

  const composer = page.locator('[data-component="prompt-input"]')
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal).toBeVisible()
  expect(created.count).toBe(0)
  await ghostty.promise
  await composer.click()
  await expect(composer).toBeFocused()

  release.resolve()
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await page.waitForTimeout(300)
  await expect(composer).toBeFocused()
})

test("keeps newer composer focus while an explicit terminal open finishes", async ({ page }) => {
  const ghostty = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(/ghostty-web/, async (route) => {
    ghostty.resolve()
    await release.promise
    await route.continue()
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, "Terminal composer focus")

  const composer = page.locator('[data-component="prompt-input"]')
  const terminal = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await ghostty.promise
  await composer.click()
  await expect(composer).toBeFocused()

  release.resolve()
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await page.waitForTimeout(50)
  await expect(composer).toBeFocused()
})

test("focuses a terminal created from the new-terminal button", async ({ page }) => {
  const created = { count: 0 }
  await page.route("**/pty", (route) => {
    created.count += 1
    const next = created.count === 1 ? { id: ptyID, title: "Terminal 1" } : { id: newPtyID, title: "Terminal 2" }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(next),
    })
  })
  await page.route(`**/pty/${newPtyID}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  )
  await page.route(`**/pty/${newPtyID}/connect-token*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ ticket: "e2e-ticket" }),
    }),
  )
  await page.routeWebSocket(new RegExp(`/pty/${newPtyID}/connect`), () => undefined)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, "Terminal composer focus")

  const composer = page.locator('[data-component="prompt-input"]')
  const terminal = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await composer.click()
  await expect(composer).toBeFocused()

  await page.getByRole("button", { name: "New terminal" }).click()
  await expect(page.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(true)
})

function seedCachedTerminal(page: Page) {
  return page.addInitScript(
    ({ terminalKey, ptyID }) => {
      localStorage.setItem("opencode.global.dat:layout", JSON.stringify({ terminal: { height: 320, opened: true } }))
      localStorage.setItem(
        terminalKey,
        JSON.stringify({
          active: ptyID,
          all: [{ id: ptyID, title: "Terminal 1", titleNumber: 1 }],
        }),
      )
    },
    { terminalKey: `${base64Encode(directory)}/terminal.v1`, ptyID },
  )
}
