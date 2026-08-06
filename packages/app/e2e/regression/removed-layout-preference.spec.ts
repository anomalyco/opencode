import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const draftID = "draft_removed_layout_preference"
const directory = "C:/OpenCode/RemovedLayoutPreference"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("ignores persisted old layout preferences when opening drafts", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_removed_layout_preference",
      worktree: directory,
      vcs: "git",
      name: "removed-layout-preference",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: false } }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server },
  )

  await page.goto(`/new-session?draftId=${draftID}`)

  await expect(page).toHaveURL(`/new-session?draftId=${draftID}`)
  await expect(page.locator("body")).toHaveAttribute("data-new-layout", "")
  await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible()
})
