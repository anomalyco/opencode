import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("keeps archived sessions off Home until search includes them", async ({ page }) => {
  const archivedTitle = "Archived search result"
  const archived = {
    ...fixture.sessions.find((session) => session.id === fixture.targetID)!,
    id: "ses_archived_search",
    title: archivedTitle,
    directory: "/removed/worktree",
    time: { created: 1, updated: 2, archived: 3 },
  }
  await mockOpenCodeServer(page, {
    sessions: [...fixture.sessions, archived],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  await expect(page.getByRole("button", { name: archivedTitle })).toHaveCount(0)

  const search = page.getByRole("textbox", { name: "Search sessions", exact: true })
  await search.fill("Archived search")
  await expect(page.getByRole("option", { name: new RegExp(archivedTitle) })).toHaveCount(0)

  const toggle = page.locator('[data-component="switch"]').filter({ hasText: "Include archived" })
  const includeArchived = toggle.getByRole("switch", { name: "Include archived" })
  await expect(includeArchived).not.toBeChecked()
  await toggle.locator('[data-slot="switch-control"]').click()
  await expect(includeArchived).toBeChecked()
  await expect(page.getByRole("option", { name: new RegExp(`${archivedTitle}.*Archived`) })).toBeVisible()

  await toggle.locator('[data-slot="switch-control"]').click()
  await expect(page.getByRole("option", { name: new RegExp(archivedTitle) })).toHaveCount(0)
  await expect(search).toBeVisible()

  await toggle.locator('[data-slot="switch-control"]').click()
  await page.getByRole("option", { name: new RegExp(`${archivedTitle}.*Archived`) }).click()
  await expect(page).toHaveURL(/\/session\/ses_archived_search$/)
})
