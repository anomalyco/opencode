import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/CloseProject"
const project = {
  id: "proj_close_project",
  worktree: directory,
  vcs: "git",
  name: "CloseProject",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  sandboxes: [],
}

test("closing a project from its menu keeps the home UI interactive", async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockOpenCodeServer(page, {
    directory,
    project,
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
    },
    { directory },
  )

  await page.goto("/")
  const row = page.locator('[data-component="home-project-row"]')
  await expectAppVisible(row)
  await row.hover()
  await page.locator('[data-action="home-project-menu"]').click()
  await page.getByRole("menuitem", { name: "Close" }).click()

  await expect(row).toHaveCount(0)
  const recent = page.locator('[data-component="home-recently-closed-row"]')
  await expect(recent).toBeVisible()
  await recent.click()
  await expect(row).toBeVisible()
  expect(errors).toEqual([])
})
