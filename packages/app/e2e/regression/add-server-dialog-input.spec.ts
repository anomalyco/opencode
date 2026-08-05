import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/AddServerDialog"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("Add server dialog fields accept and retain input", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_add_server",
      worktree: directory,
      vcs: "git",
      name: "add-server-dialog",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  // The legacy layout hosts the Add server form that uses the shared TextField.
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: false } }))
  })

  await page.goto("/")
  await page.keyboard.press("Control+,")

  await page.getByRole("tab", { name: "サーバー" }).click()
  await page.getByRole("button", { name: "サーバーを追加" }).click()

  const fields = page.locator('input[data-slot="input-input"]')
  await expect(fields).toHaveCount(4)
  const [url, name, username, password] = [0, 1, 2, 3].map((index) => fields.nth(index))

  // All four fields must accept input.
  await url.fill(server)
  await name.fill("opencode-server")
  await username.fill("opencode")
  await password.fill("test-password")

  // Values must survive focus moving away and back.
  await url.focus()
  await password.focus()
  await password.press("End")
  await password.type("-updated")

  await expect(url).toHaveValue(server)
  await expect(name).toHaveValue("opencode-server")
  await expect(username).toHaveValue("opencode")
  await expect(password).toHaveValue("test-password-updated")
})
