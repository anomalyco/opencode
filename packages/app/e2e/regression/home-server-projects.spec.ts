import { expect, test, type Page } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

// Regression: Home used to render its project sidebar exclusively from a
// browser-localStorage registry. Projects known to the server (created via the
// TUI/CLI in another terminal) never appeared until manually re-added in that
// browser, leaving Home empty on a fresh profile. Server-known projects must
// hydrate automatically, while a project the user closed stays closed.

const otherDirectory = "C:/OpenCode/OtherProject"
const otherProject = {
  id: "proj_other",
  worktree: otherDirectory,
  vcs: "git",
  name: "other-project",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}
const globalProject = {
  id: "global",
  worktree: "C:/",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}
const otherSession = {
  id: "ses_other_tui",
  slug: "other-tui",
  projectID: otherProject.id,
  directory: otherDirectory,
  title: "Session created from the TUI",
  version: "dev",
  time: { created: 1700000002000, updated: 1700000002000 },
}

const projectRows = (page: Page) => page.locator('[data-component="home-project-row"]')
const sessionRows = (page: Page) => page.locator('[data-component="home-session-row"]')

async function mockMultiProjectServer(page: Page) {
  await mockOpenCodeServer(page, {
    sessions: [...fixture.sessions, otherSession],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    projects: [globalProject, otherProject, fixture.project],
    pageMessages,
  })
}

test("home lists server-known projects and their sessions on a fresh profile", async ({ page }) => {
  await mockMultiProjectServer(page)
  await page.goto("/")

  await expect(projectRows(page)).toHaveCount(2)
  await expect(projectRows(page).filter({ hasText: "smoke-project" })).toHaveCount(1)
  await expect(projectRows(page).filter({ hasText: "other-project" })).toHaveCount(1)

  await expect(sessionRows(page).filter({ hasText: otherSession.title! })).toHaveCount(1)
  await expect(sessionRows(page).filter({ hasText: fixture.expected.sourceTitle })).toHaveCount(1)
})

test("home keeps an explicitly closed server project closed", async ({ page }) => {
  await mockMultiProjectServer(page)
  await page.addInitScript(
    ({ worktree, closed }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree, expanded: true }] },
          lastProject: {},
          recentlyClosed: { local: [closed] },
        }),
      )
    },
    { worktree: fixture.directory, closed: otherDirectory },
  )
  await page.goto("/")

  const add = page.getByRole("button", { name: "Add project" }).first()
  await expectAppVisible(add)

  await expect(projectRows(page)).toHaveCount(1)
  await expect(projectRows(page).filter({ hasText: "smoke-project" })).toHaveCount(1)
  await expect(projectRows(page).filter({ hasText: "other-project" })).toHaveCount(0)
  await expect(sessionRows(page).filter({ hasText: otherSession.title! })).toHaveCount(0)
})
