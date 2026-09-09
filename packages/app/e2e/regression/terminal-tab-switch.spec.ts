import { base64Encode } from "@opencode/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalTabSwitch"
const projectID = "proj_terminal_tab_switch"
const sessionA = "ses_terminal_tab_a"
const sessionB = "ses_terminal_tab_b"
const titleA = "Alpha session"
const titleB = "Beta session"
const ptyID = "pty_tab_switch"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
// Marks the terminal DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

// Terminal processes are workspace-scoped, but panel visibility belongs to each
// session tab. Switching tabs must keep the PTY alive without opening its panel.
test("keeps terminal visibility per tab and the PTY alive across tab switches", async ({ page }) => {
  const connections = await setup(page)

  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)

  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  const terminalPanel = page.locator('[data-component="terminal-panel"]')
  await expect(terminal).toBeVisible()
  await expect(terminalPanel.locator('[data-slot="tabs-list"]')).toHaveCSS("padding-inline-start", "12px")
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "true")
  await expect(terminalPanel).toHaveCSS("height", "300px")
  await expect.poll(() => connections.length).toBe(1)
  const connection = new URL(connections[0]!)
  expect(connection.pathname).toBe(`/api/pty/${ptyID}/connect`)
  expect(connection.searchParams.get("location[directory]")).toBe(directory)
  expect(connection.searchParams.get("ticket")).toBe("e2e-ticket")
  await writeProbe(page)

  await switchTab(page, titleB)
  await expectSessionTitle(page, titleB)
  await expect(terminal).toBeHidden()
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "false")
  expect(await readProbe(page)).toBe(PROBE)
  expect(connections.length).toBe(1)

  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expect(terminalPanel).toHaveCSS("height", "180px")

  await switchTab(page, titleA)
  await expectSessionTitle(page, titleA)
  await expect(terminal).toBeVisible()
  await expect(terminalPanel).toHaveCSS("height", "300px")
  expect(await readProbe(page)).toBe(PROBE)
  expect(connections.length).toBe(1)

  await page.reload()
  await expectSessionTitle(page, titleA)
  await expect(terminal).toBeVisible()
  await expect(terminalPanel).toHaveCSS("height", "300px")
})

type Probed = HTMLElement & { __e2eProbe?: string }

for (const direction of ["ltr", "rtl"] as const) {
  test(`mobile terminal navigation, rename, restore, and close in ${direction}`, async ({ page }) => {
    const connections = await setup(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(sessionHref(sessionA))
    await expectSessionTitle(page, titleA)
    await page.evaluate((direction) => {
      document.documentElement.dir = direction
    }, direction)
    const navigation = page.locator('[data-slot="session-mobile-view-tabs"]')
    await navigation.getByRole("tab", { name: "Terminal", exact: true }).click()
    const terminal = page.locator(`#terminal-wrapper-${ptyID} [data-component="terminal"]`)
    const panel = page.getByRole("region", { name: "Terminal", exact: true })
    await expect(terminal.locator("textarea")).toBeFocused()
    await expect(terminal).toHaveCSS("direction", "ltr")
    await expect.poll(() => connections.length).toBe(1)
    await writeProbe(page)
    await panel
      .getByRole("tab", { name: "Terminal 1", exact: true })
      .locator('[data-slot="terminal-tab-title"]')
      .dblclick()
    const name = "بناء build-42"
    await panel.getByRole("textbox", { name: "Rename", exact: true }).fill(name)
    await panel.getByRole("textbox", { name: "Rename", exact: true }).press("Enter")
    await expect(panel.getByRole("tab", { name, exact: true })).toBeVisible()
    await navigation.getByRole("tab", { name: "Session", exact: true }).click()
    await expect(terminal).toBeHidden()
    await navigation.getByRole("tab", { name: "Terminal", exact: true }).click()
    await expect(terminal).toBeVisible()
    expect(await readProbe(page)).toBe(PROBE)
    expect(connections.length).toBe(1)
    await page.reload()
    await expectSessionTitle(page, titleA)
    await expect(panel.getByRole("tab", { name, exact: true })).toBeVisible()
    await expect.poll(() => connections.length).toBe(2)
    await terminal.click()
    await expect(terminal.locator("textarea")).toBeFocused()
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api/pty/${ptyID}`,
    )
    await page.keyboard.press("Control+w")
    expect((await removed).status()).toBe(204)
    await expect(terminal).toHaveCount(0)
    await expect(navigation.getByRole("tab", { name: "Session", exact: true })).toHaveAttribute("aria-selected", "true")
  })
}

async function switchTab(page: Page, title: string) {
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
}

async function writeProbe(page: Page) {
  await page.locator('[data-component="terminal"]').evaluate((el, probe) => {
    ;(el as Probed).__e2eProbe = probe
  }, PROBE)
}

async function readProbe(page: Page) {
  return page.locator('[data-component="terminal"]').evaluate((el) => (el as Probed).__e2eProbe)
}

async function setup(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "terminal-tab-switch",
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
    sessions: [session(sessionA, titleA, 1700000000000), session(sessionB, titleB, 1700000001000)],
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
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
        }),
  )
  await page.route(`**/api/pty/${ptyID}/connect-token*`, (route) => {
    expect(route.request().headers()["x-opencode-ticket"]).toBe("1")
    const url = new URL(route.request().url())
    expect(url.searchParams.get("location[directory]")).toBe(directory)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ location: ptyLocation(), data: { ticket: "e2e-ticket", expires_in: 60 } }),
    })
  })
  const connections: string[] = []
  await page.routeWebSocket(new RegExp(`/api/pty/${ptyID}/connect`), (ws) => {
    connections.push(ws.url())
    ws.send("Terminal fixture ready\r\n")
  })

  await page.addInitScript(
    ({ directory, server, sessions, panes }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((sessionId: string) => ({ type: "session", server, sessionId }))),
      )
      if (!localStorage.getItem("opencode.window.browser.dat:tabs.panes")) {
        localStorage.setItem("opencode.window.browser.dat:tabs.panes", JSON.stringify(panes))
      }
      localStorage.setItem("settings.v3", JSON.stringify({ general: { terminalPlacement: "bottom" } }))
    },
    {
      directory,
      server,
      sessions: [sessionA, sessionB],
      panes: {
        [`${server}\n${sessionHref(sessionA)}`]: { terminalHeight: 300 },
        [`${server}\n${sessionHref(sessionB)}`]: { terminalHeight: 180 },
      },
    },
  )
  return connections
}

function session(id: string, title: string, created: number) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
  }
}

function sessionHref(sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

function ptyLocation() {
  return { directory, project: { id: projectID, directory } }
}

function ptyInfo() {
  return { id: ptyID, title: "Terminal 1", command: "cmd.exe", args: [], cwd: directory, status: "running", pid: 1 }
}
