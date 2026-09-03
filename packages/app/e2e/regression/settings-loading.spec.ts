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
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(page.getByTestId("settings-screen").getByRole("tab", { name: "Preferences" })).toBeVisible()
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
  await settings.getByRole("tab", { name: "Workspaces", exact: true }).click()
  await requested
  await expect(settings.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
  await expect(settings.getByText("No workspaces", { exact: true })).toHaveCount(0)

  inventory.resolve()
  await expect(settings.getByText(sandboxes[0], { exact: true })).toBeVisible()
  await expect(settings.getByText("12 workspaces", { exact: true })).toBeVisible()
  sessions.resolve()
  await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()

  const refresh = Promise.withResolvers<void>()
  await page.route("**/api/worktree/*", async (route) => {
    await refresh.promise
    await route.fallback()
  })
  await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
  await settings.getByRole("tab", { name: "Workspaces", exact: true }).click()
  await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
  refresh.resolve()
})

test("extensions opens without waiting for MCPs or plugins", async ({ page }) => {
  const mcps = Promise.withResolvers<void>()
  const plugins = Promise.withResolvers<void>()
  await page.route("**/api/mcp", async (route) => {
    await mcps.promise
    await route.fulfill({
      json: { location: { directory }, data: [{ name: "demo-mcp", status: { status: "connected" } }] },
    })
  })
  await page.route("**/api/plugin", async (route) => {
    await plugins.promise
    await route.fulfill({
      json: {
        location: { directory },
        data: [
          { id: "demo-plugin", source: { type: "package", package: "demo-plugin" }, status: "active", tui: false },
        ],
      },
    })
  })
  const settings = page.getByTestId("settings-screen")
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/mcp")
  await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
  await requested
  await expect(settings.getByRole("heading", { name: "Extensions", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
  await settings.getByRole("tab", { name: "Plugins", exact: true }).click()
  await expect(settings.getByRole("tab", { name: "Plugins", exact: true })).toHaveAttribute("aria-selected", "true")
  plugins.resolve()
  await expect(settings.getByText("demo-plugin", { exact: true })).toBeVisible()
  mcps.resolve()
  await settings.getByRole("tab", { name: "MCPs", exact: true }).click()
  await expect(settings.getByRole("switch", { name: "demo-mcp" })).toBeChecked()
})

test("about opens without waiting for contributors", async ({ page }) => {
  const contributors = Promise.withResolvers<void>()
  const url = "https://api.github.com/repos/anomalyco/opencode/contributors?anon=1&per_page=1"
  await page.route(url, async (route) => {
    await contributors.promise
    await route.fulfill({
      json: [],
      headers: {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Link",
        Link: `<${url}&page=1004>; rel="last"`,
      },
    })
  })
  const settings = page.getByTestId("settings-screen")
  const requested = page.waitForRequest(url)
  await settings.getByRole("tab", { name: "About", exact: true }).click()
  await requested
  await expect(settings.getByRole("tab", { name: "About", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(settings.getByText("Released under the MIT License", { exact: true })).toBeVisible()
  await expect(settings.getByRole("link", { name: "935 others", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()

  await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
  await expect(settings.getByRole("tab", { name: "Preferences", exact: true })).toHaveAttribute("aria-selected", "true")
  await settings.getByRole("tab", { name: "About", exact: true }).click()
  await expect(settings.getByRole("link", { name: "935 others", exact: true })).toBeVisible()

  const website = settings.getByRole("link", { name: "www.opencode.ai", exact: true })
  await website.focus()
  contributors.resolve()
  await expect(settings.getByRole("link", { name: "988 others", exact: true })).toBeVisible()
  await expect(website).toBeFocused()
})

test("about keeps its fallback when the contributor request fails", async ({ page }) => {
  const contributors = Promise.withResolvers<void>()
  const url = "https://api.github.com/repos/anomalyco/opencode/contributors?anon=1&per_page=1"
  await page.route(url, async (route) => {
    await contributors.promise
    await route.abort("failed")
  })
  const settings = page.getByTestId("settings-screen")
  const requested = page.waitForRequest(url)
  await settings.getByRole("tab", { name: "About", exact: true }).click()
  await requested
  await expect(settings.getByRole("link", { name: "935 others", exact: true })).toBeVisible()

  const failed = page.waitForEvent("requestfailed", (request) => request.url() === url)
  contributors.resolve()
  await failed
  await expect(settings.getByRole("link", { name: "935 others", exact: true })).toBeVisible()
  await expect(settings.getByText("Released under the MIT License", { exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "About", exact: true })).toHaveAttribute("aria-selected", "true")
})

test("workspace inventory uses the settings panel scroll area", async ({ page }) => {
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Workspaces", exact: true }).click()
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
