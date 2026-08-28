import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/AddServerFocus"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const session = {
  id: "ses_add_server_focus",
  directory,
  title: "Add server focus session",
}

async function mockServer(page: Page) {
  await page.addInitScript(({ server }) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [server] }))
  }, { server })

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_add_server_focus",
      worktree: directory,
      vcs: "git",
      name: "add-server-focus",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })

  // The shared helper does not stub these Settings-dialog endpoints; return empty models/providers so the dialog renders.
  await page.route("**/api/provider**", (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: [] }) }))
  await page.route("**/api/model**", (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: [] }) }))
  await page.route("**/api/model/default", (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: null }) }))
}

test("add-server form fields stay focusable while stacked on the settings dialog", async ({ page }) => {
  await mockServer(page)

  await page.goto(`/server/${base64Encode(server)}/session/${session.id}`)
  await expect(page.getByText(session.title).first()).toBeVisible()

  await page.keyboard.press("Control+,")
  const settings = page.locator(".settings-v2-dialog")
  await expect(settings).toBeVisible()

  await settings.getByRole("tab", { name: "Servers" }).click()
  await settings.getByRole("button", { name: "Add server" }).click()

  const dialog = page.locator(".settings-v2-server-dialog")
  await expect(dialog).toBeVisible()

  const urlInput = dialog.getByPlaceholder("http://localhost:4096")
  await expect(urlInput).toBeFocused()

  const nameInput = dialog.getByPlaceholder("Localhost")
  await nameInput.click()
  await expect(nameInput).toBeFocused()
  await nameInput.fill("secondary server")
  await expect(nameInput).toHaveValue("secondary server")

  const usernameInput = dialog.getByPlaceholder("username")
  await usernameInput.click()
  await expect(usernameInput).toBeFocused()

  const passwordInput = dialog.getByPlaceholder("password")
  await passwordInput.click()
  await expect(passwordInput).toBeFocused()
})
