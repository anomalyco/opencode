import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/Projects/extensions-demo"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const session = {
  id: "ses_project_extensions",
  title: "Existing session",
  directory,
  projectID: "proj_extensions_demo",
  time: { created: 1700000000000, updated: 1700000000000 },
}

test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" })

test("project Extensions stays inside settings while plugins load", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: session.projectID,
      canonical: directory,
      name: "Extensions demo",
      vcs: "git",
      time: session.time,
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ server, sessionID, directory }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { server, sessionID: session.id, directory },
  )
  const href = `/server/${base64Encode(server)}/session/${session.id}`
  await page.goto(href)
  await expect(page.getByRole("heading", { name: session.title, exact: true })).toBeVisible()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  await settings.getByText("Extensions demo", { exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeFocused()

  const globalPlugins = Promise.withResolvers<void>()
  const projectPlugins = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === "/api/plugin",
    async (route) => {
      const project = new URL(route.request().url()).searchParams.get("location[directory]")
      await (project ? projectPlugins : globalPlugins).promise
      await route.fulfill({
        json: {
          location: project ? { directory: project } : {},
          data: (project ? ["shared-plugin", "project-plugin"] : ["shared-plugin"]).map((id) => ({
            id,
            source: { type: "package", package: id },
            status: "active",
            tui: false,
          })),
        },
      })
    },
  )
  const requested = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === "/api/plugin" && url.searchParams.get("location[directory]") === directory
  })
  await dialog.getByRole("tab", { name: "Extensions", exact: true }).click()
  await requested
  await expect(page).toHaveURL(href)
  await expect(dialog.getByRole("heading", { name: "Extensions", exact: true })).toBeVisible()
  await expect(settings).toBeVisible()
  await expect(page.getByRole("heading", { name: session.title, exact: true, includeHidden: true })).toBeHidden()
  await dialog.getByRole("tab", { name: "Plugins", exact: true }).click()
  await expect(dialog.getByRole("tab", { name: "Plugins", exact: true })).toHaveAttribute("aria-selected", "true")

  globalPlugins.resolve()
  await dialog.getByRole("tab", { name: "Scripts", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Scripts", exact: true })).toBeVisible()
  await dialog.getByRole("tab", { name: "Extensions", exact: true }).click()
  projectPlugins.resolve()
  await dialog.getByRole("tab", { name: "Plugins", exact: true }).click()
  await expect(dialog.getByText("project-plugin", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Shared with all projects 1", exact: true }).click()
  await expect(dialog.getByText("shared-plugin", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(href)

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(settings.getByRole("tab", { name: "Projects", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("heading", { name: session.title, exact: true, includeHidden: true })).toBeHidden()
})
