import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/Projects/settings-demo"
const sandboxes = Array.from({ length: 12 }, (_, index) => `${directory}/workspace-${index + 1}`)

test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" })

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_settings_demo",
      canonical: directory,
      name: "Settings demo",
      vcs: "git",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes,
    },
    provider: { all: [], connected: [], default: {} },
    sessions: sandboxes.map((directory, index) => ({
      id: `ses_settings_${index + 1}`,
      title: `Workspace ${index + 1} session`,
      directory,
      projectID: "proj_settings_demo",
      time: { created: 1700000000000, updated: 1700000000000 },
    })),
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
    )
  }, directory)
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(page.getByTestId("settings-screen").getByRole("tab", { name: "Preferences" })).toBeVisible()
})

test("settings has its own route and returns through app history", async ({ page }) => {
  const settings = page.getByTestId("settings-screen")
  const home = page.getByRole("button", { name: "Home", exact: true })
  await expect(page).toHaveURL("/settings")
  await expect(home).toHaveAttribute("aria-pressed", "false")
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(page).toHaveURL("/")
  await expect(home).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL("/settings")
  await expect(settings.getByRole("tab", { name: "Preferences", exact: true })).toBeVisible()
  await expect(home).toHaveAttribute("aria-pressed", "false")
  await home.click()
  await expect(page).toHaveURL("/")
  await expect(settings).toBeHidden()
  await expect(home).toHaveAttribute("aria-pressed", "true")
})

test("new session shortcut leaves settings and opens a new session screen", async ({ page }) => {
  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeFocused()
  await page.keyboard.press("Control+t")

  await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toHaveCount(1)
})

test("recording a new session shortcut stays in settings until recording finishes", async ({ page }) => {
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click()
  const binding = settings.locator('[data-keybind-id="tab.new"]')
  await binding.click()
  await expect(binding).toHaveText("Press keys")
  await page.keyboard.press("Control+t")

  await expect(binding).toHaveText("Ctrl+T")
  await expect(page).toHaveURL("/settings")
  await expect(page.locator("[data-titlebar-tab]")).toHaveCount(0)
  await page.keyboard.press("Control+t")
  await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
})

test("workspaces opens without waiting for inventory or sessions", async ({ page }) => {
  const inventory = Promise.withResolvers<void>()
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/worktree/*", async (route) => {
    await inventory.promise
    await route.fallback()
  })
  await page.route("**/api/session?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("directory")) await sessions.promise
    await route.fallback()
  })
  const settings = page.getByTestId("settings-screen")
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith("/api/worktree/"))
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await requested
  await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
  await expect(settings.getByText("No worktrees", { exact: true })).toHaveCount(0)

  inventory.resolve()
  await expect(settings.getByText(sandboxes[0], { exact: true })).toBeVisible()
  await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
  sessions.resolve()
  await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()

  const refresh = Promise.withResolvers<void>()
  await page.route("**/api/worktree/*", async (route) => {
    await refresh.promise
    await route.fallback()
  })
  await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
  refresh.resolve()
})

test("extensions opens without waiting for MCPs", async ({ page }) => {
  const mcps = Promise.withResolvers<void>()
  await page.route("**/api/mcp", async (route) => {
    await mcps.promise
    await route.fulfill({
      json: { location: { directory }, data: [{ name: "demo-mcp", status: { status: "connected" } }] },
    })
  })
  const settings = page.getByTestId("settings-screen")
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/mcp")
  await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
  await requested
  await expect(settings.getByRole("heading", { name: "Extensions", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
  mcps.resolve()
  await settings.getByRole("tab", { name: "MCPs", exact: true }).click()
  await expect(settings.getByRole("switch", { name: "demo-mcp" })).toBeChecked()
})

test("workspace inventory uses the settings panel scroll area", async ({ page }) => {
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
  const list = settings.locator('[data-component="settings-list"]')
  await expect(list).toHaveCSS("max-height", "none")
  await expect(list).toHaveCSS("overflow-y", "visible")
  await settings.getByText("Workspace 12 session", { exact: true }).scrollIntoViewIfNeeded()
  await expect(settings.getByText("Workspace 12 session", { exact: true })).toBeInViewport()
  await expect(settings.getByRole("button", { name: "Back to app" })).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(list).toHaveCSS("max-height", "none")
  await expect(list).toHaveCSS("overflow-y", "visible")
  await settings.getByText("Workspace 12 session", { exact: true }).scrollIntoViewIfNeeded()
  await expect(settings.getByText("Workspace 12 session", { exact: true })).toBeInViewport()
})
