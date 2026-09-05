import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_new_session_workspace_branch"
const directory = "C:/OpenCode/WorkspaceBranch"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

for (const vcs of ["git", "hg"]) {
  test(`gates new workspace selection for ${vcs}`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: "proj_new_session_workspace_branch",
        worktree: directory,
        vcs,
        name: "workspace-branch",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: { all: [], connected: [], default: {} },
      sessions: [],
      pageMessages: () => ({ items: [] }),
      vcsBranches: ["feature/api", "main", "origin/release"],
    })
    await page.addInitScript(
      ({ directory, draftID, server }) => {
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: { local: [{ worktree: directory, expanded: true }] },
            lastProject: { local: directory },
          }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([{ type: "draft", draftID, server, directory }]),
        )
      },
      { directory, draftID, server },
    )

    await page.goto(`/new-session?draftId=${draftID}`)
    await expectAppVisible(page.locator('[data-component="composer-editor"]'))
    if (vcs !== "git") {
      await expect(page.getByText("main", { exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Local", exact: true })).toHaveCount(0)
      return
    }
    await page.getByRole("button", { name: "Local", exact: true }).click()
    await page.getByRole("menuitem", { name: "New worktree", exact: true }).click()
    await page.getByRole("button", { name: "from main", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "feature/api", exact: true }).click()

    const selected = page.getByRole("button", { name: "from feature/api", exact: true })
    await expect(selected).toBeVisible()
    await selected.click()
    await expect(page.getByRole("menuitemradio", { name: "feature/api", exact: true })).toBeChecked()
  })
}
