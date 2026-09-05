import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/DirectNewSession"

test("registers a directly opened new-session directory", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_direct_new_session",
      worktree: directory,
      vcs: "git",
      name: "direct-new-session",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: {}, lastProject: {} }))
  })

  await page.goto(`/${base64Encode(directory)}/session`)

  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = localStorage.getItem("opencode.global.dat:server")
        if (!value) return
        return JSON.parse(value) as {
          projects?: Record<string, { worktree: string }[]>
          lastProject?: Record<string, string>
        }
      }),
    )
    .toMatchObject({
      projects: { local: [{ worktree: directory }] },
      lastProject: { local: directory },
    })
})
