import { expect, test, type Page } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

// Both checkouts share one git remote, so the app resolves them to a single project whose
// stored worktree stays the checkout that was opened first.
const HOME = "/home/user"
const OLD = "/home/user/checkout-old"
const COPY = "/home/user/checkout-copy"

const project = {
  id: "proj_checkout_redirect",
  worktree: OLD,
  vcs: "git",
  name: "checkout-redirect",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [COPY],
}

const sessions = [
  {
    id: "sess_checkout_old",
    projectID: project.id,
    directory: OLD,
    title: "Old checkout session",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000002000 },
  },
  {
    id: "sess_checkout_copy",
    projectID: project.id,
    directory: COPY,
    title: "Copy checkout session",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000001000 },
  },
]

// A draft names the directory it runs in beside the project name: the stored worktree
// renders as "Local", a second checkout as its folder name.
const draftDirectory = (page: Page, name: string) =>
  expectAppVisible(page.locator('[data-component="session-new-design"]').getByText(name, { exact: true }))

async function mockSecondCheckout(page: Page, registered: string[]) {
  await mockOpenCodeServer(page, {
    directory: COPY,
    directories: registered,
    home: HOME,
    project,
    sessions,
    provider: fixture.provider,
    pageMessages,
    fileList: () => [{ path: "src", type: "directory" }],
    findFiles: ({ query }) => (query.includes("checkout-copy") ? ["checkout-copy/"] : []),
  })
  await page.addInitScript((worktree) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree, expanded: true }] },
        lastProject: { local: worktree },
      }),
    )
  }, OLD)
}

async function addCopyCheckout(page: Page) {
  const add = page.getByRole("button", { name: "Add project" }).first()
  await expectAppVisible(add)
  await add.click()
  const search = page.getByPlaceholder("Search folders")
  await expectAppVisible(search)
  await search.fill("checkout-copy")
  await page.locator(`[data-directory-path="${COPY}"]`).click()
}

async function openNewSessionOnCopy(page: Page) {
  const newSession = page.locator('[data-action="home-new-session"]')
  await expectAppVisible(newSession)
  await newSession.click()

  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await draftDirectory(page, "checkout-copy")
}

test("a new session on a second checkout of a known project stays on that checkout", async ({ page }) => {
  await mockSecondCheckout(page, [OLD, COPY])
  await page.goto("/")
  await addCopyCheckout(page)

  await openNewSessionOnCopy(page)
})

test("a new session stays on the copy when the stored worktree is unregistered", async ({ page }) => {
  // The first checkout was deleted from disk: it is no longer a registered directory of the
  // project, but the project row still stores it as the worktree.
  await mockSecondCheckout(page, [COPY])
  await page.goto("/")
  await addCopyCheckout(page)

  await openNewSessionOnCopy(page)
})
