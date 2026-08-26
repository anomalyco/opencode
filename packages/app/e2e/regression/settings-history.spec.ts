import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const directory = "/settings-history"
const draft = "/new-session?draftId=settings-history"

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_settings_history",
      worktree: directory,
      vcs: "git",
      name: "settings-history",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ server, directory }) => {
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID: "settings-history", server, directory }]),
      )
    },
    { server, directory },
  )
})

test("settings close, app commands, and browser traversal share one history", async ({ page }) => {
  await page.goto("/")
  await page.locator(`[data-titlebar-tab-slot] a[href="${draft}"]`).click()
  const editor = page.locator('[data-component="composer-editor"][contenteditable="true"]')
  await expect(editor).toBeEditable()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeFocused()
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click()

  await page.keyboard.press("Control+[")
  await expect(editor).toBeEditable()
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === draft)
  await page.goForward()
  await expect(settings.getByRole("tab", { name: "Appearance", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Escape")
  await expect(editor).toBeEditable()
  await page.keyboard.press("Control+]")
  await expect(settings).toBeFocused()
  await expect(settings.getByRole("tab", { name: "Appearance", exact: true })).toHaveAttribute("aria-selected", "true")
  await settings.getByRole("button", { name: "Back to app" }).click()
  await expect(editor).toBeEditable()

  await page.keyboard.press("Control+[")
  await expect(page).toHaveURL((url) => url.pathname === "/")
  await expect(settings).not.toBeAttached()
  await page.goForward()
  await expect(editor).toBeEditable()
  await page.goForward()
  await expect(settings).toBeFocused()
  await page.goBack()
  await expect(editor).toBeEditable()
  await page.keyboard.press("Control+]")
  await expect(settings).toBeFocused()
})

test("direct settings entry and reload fall back home without leaving the app", async ({ page }) => {
  await page.goto("/settings?tab=appearance")
  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeFocused()
  await page.reload()
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL((url) => url.pathname === "/")
  await expect(settings).not.toBeAttached()
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL((url) => url.pathname === "/")
})

test("reload retains known browser history but direct entry does not adopt stale history", async ({ page }) => {
  await page.goto(draft)
  const editor = page.locator('[data-component="composer-editor"][contenteditable="true"]')
  await expect(editor).toBeEditable()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeFocused()
  await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
  const url = page.url()
  await page.reload()
  await expect(settings).toBeFocused()
  await settings.getByRole("button", { name: "Back to app" }).click()
  await expect(editor).toBeEditable()
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === draft)
  await page.goForward()
  await expect(settings.getByRole("tab", { name: "Appearance", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Escape")
  await expect(editor).toBeEditable()

  await page.goto(url)
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL((url) => url.pathname === "/")
})
