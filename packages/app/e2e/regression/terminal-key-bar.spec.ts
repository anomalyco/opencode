import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalKeyBar"
const projectID = "proj_terminal_key_bar"
const sessionID = "ses_terminal_key_bar"
const ptyID = "pty_terminal_key_bar"

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const sent: string[] = []
let connections = 0

test.beforeEach(async ({ page }) => {
  sent.length = 0
  connections = 0
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "terminal-key-bar",
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
        slug: "terminal-key-bar",
        projectID,
        directory,
        title: "Terminal key bar",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/pty*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
    }),
  )
  await page.route(`**/api/pty/${ptyID}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
    }),
  )
  await page.route(`**/api/pty/${ptyID}/connect-token*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ location: ptyLocation(), data: { ticket: "e2e-ticket", expires_in: 60 } }),
    }),
  )
  await page.routeWebSocket(new RegExp(`/api/pty/${ptyID}/connect`), (ws) => {
    connections += 1
    ws.onMessage((message) => {
      sent.push(typeof message === "string" ? message : message.toString("utf8"))
    })
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
})

// The software keyboard inserts text through beforeinput. `page.keyboard.insertText`
// goes through the composition path, which the terminal ignores, so dispatch the
// event the way a keyboard extension does.
async function typeFromSoftwareKeyboard(page: Page, data: string) {
  await page.evaluate((value) => {
    const textarea = document.querySelector('[data-component="terminal"] textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("terminal textarea not found")
    textarea.focus()
    textarea.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: value, bubbles: true, cancelable: true }),
    )
  }, data)
}

async function openTerminal(page: Page) {
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, "Terminal key bar")
  await page.keyboard.press("Control+Backquote")

  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal).toBeVisible()
  await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  const bar = page.locator('[data-component="terminal-key-bar"]')
  await expect(bar).toBeVisible()
  await expect.poll(() => connections).toBe(1)
  return bar
}

test("sends special keys from the on-screen bar", async ({ page }) => {
  const bar = await openTerminal(page)

  await bar.locator('[data-key="esc"]').click()
  await expect.poll(() => sent.includes("\x1b")).toBe(true)

  await bar.locator('[data-key="tab"]').click()
  await expect.poll(() => sent.includes("\t")).toBe(true)

  await bar.locator('[data-key="ctrl-c"]').click()
  await expect.poll(() => sent.includes("\x03")).toBe(true)

  await bar.locator('[data-key="up"]').click()
  await expect.poll(() => sent.includes("\x1b[A")).toBe(true)

  await bar.locator('[data-key="left"]').click()
  await expect.poll(() => sent.includes("\x1b[D")).toBe(true)
})

test("applies a sticky modifier to the next character from the software keyboard", async ({ page }) => {
  const bar = await openTerminal(page)

  await bar.locator('[data-key="ctrl"]').click()
  await typeFromSoftwareKeyboard(page, "c")
  await expect.poll(() => sent.includes("\x03")).toBe(true)

  await typeFromSoftwareKeyboard(page, "d")
  await expect.poll(() => sent.includes("d")).toBe(true)
  expect(sent).not.toContain("\x04")
})

test("locks a modifier when tapped twice", async ({ page }) => {
  const bar = await openTerminal(page)

  await bar.locator('[data-key="ctrl"]').click()
  await bar.locator('[data-key="ctrl"]').click()
  await typeFromSoftwareKeyboard(page, "c")
  await typeFromSoftwareKeyboard(page, "d")

  await expect.poll(() => sent.includes("\x03")).toBe(true)
  await expect.poll(() => sent.includes("\x04")).toBe(true)

  await bar.locator('[data-key="ctrl"]').click()
  await typeFromSoftwareKeyboard(page, "e")
  await expect.poll(() => sent.includes("e")).toBe(true)
})

function ptyLocation() {
  return { directory, project: { id: projectID, directory } }
}

function ptyInfo() {
  return { id: ptyID, title: "Terminal 1", command: "cmd.exe", args: [], cwd: directory, status: "running", pid: 1 }
}
