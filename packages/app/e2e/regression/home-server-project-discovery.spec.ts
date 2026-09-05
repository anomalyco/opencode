import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directoryA = "C:/OpenCode/ProjectA"
const directoryB = "C:/OpenCode/ProjectB"
const projects = [
  {
    id: "proj_discovery_a",
    worktree: directoryA,
    vcs: "git",
    name: "Project A",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    sandboxes: [],
  },
  {
    id: "proj_discovery_b",
    worktree: directoryB,
    vcs: "git",
    name: "Project B",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    sandboxes: [],
  },
]
const sessions = [
  {
    id: "ses_discovery_a",
    projectID: projects[0]!.id,
    directory: directoryA,
    title: "Session in Project A",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_002 },
  },
  {
    id: "ses_discovery_b",
    projectID: projects[1]!.id,
    directory: directoryB,
    title: "Session in Project B",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_001 },
  },
]

async function configure(page: Page) {
  await mockOpenCodeServer(page, {
    directory: directoryA,
    project: projects[0],
    projects,
    provider: { all: [], connected: [], default: {} },
    sessions,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
}

function projectRow(page: Page, name: string) {
  return page.locator('[data-component="home-project-row"]').filter({ hasText: name })
}

function sessionRow(page: Page, title: string) {
  return page.locator('[data-component="home-session-row"]').filter({ hasText: title })
}

test("discovers server projects and sessions without leaking local project state across clients", async ({
  page,
  browser,
}) => {
  await configure(page)
  await page.goto("/")

  await expectAppVisible(projectRow(page, "Project A"))
  await expectAppVisible(projectRow(page, "Project B"))
  await expectAppVisible(sessionRow(page, "Session in Project A"))
  await expectAppVisible(sessionRow(page, "Session in Project B"))

  const projectA = projectRow(page, "Project A").locator("..")
  await projectA.hover()
  await projectA.locator('[data-action="home-project-new-session"]').click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)

  await page.goto("/")
  await expectAppVisible(projectRow(page, "Project B"))

  const projectB = projectRow(page, "Project B").locator("..")
  await projectB.hover()
  await projectB.locator('[data-action="home-project-menu"]').click()
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(projectRow(page, "Project B")).toHaveCount(0)

  const second = await browser.newPage()
  try {
    await configure(second)
    await second.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000")
    await expectAppVisible(projectRow(second, "Project B"))
    await expectAppVisible(sessionRow(second, "Session in Project B"))
  } finally {
    await second.close()
  }
})
