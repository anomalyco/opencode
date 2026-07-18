import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewStatePersistence"
const projectID = "proj_review_state_persistence"
const sessionA = "ses_review_state_a"
const sessionB = "ses_review_state_b"
const titleA = "Alpha review state"
const titleB = "Beta review state"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("restores review mode and selected file per session", async ({ page }) => {
  await setup(page)
  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)
  await page.getByRole("button", { name: "Toggle review" }).click()

  await selectMode(page, "Git changes", "Branch changes")
  await selectFile(page, "beta.ts")

  await switchSession(page, titleB)
  await expect(page.getByRole("button", { name: "Git changes" })).toBeVisible()
  await selectFile(page, "gamma.ts")

  await switchSession(page, titleA)
  await expect(page.getByRole("button", { name: "Branch changes" })).toBeVisible()
  await expectSelectedFile(page, "beta.ts")
  await selectMode(page, "Branch changes", "Git changes")
  await expectSelectedFile(page, "alpha.ts")
  await selectMode(page, "Git changes", "Branch changes")
  await expectSelectedFile(page, "beta.ts")

  await page.reload()
  await expectSessionTitle(page, titleA)
  await expect(page.getByRole("button", { name: "Branch changes" })).toBeVisible()
  await expectSelectedFile(page, "beta.ts")

  await switchSession(page, titleB)
  await expect(page.getByRole("button", { name: "Git changes" })).toBeVisible()
  await expectSelectedFile(page, "gamma.ts")
})

async function selectMode(page: Page, current: string, next: string) {
  await page.getByRole("button", { name: current }).click()
  await page.getByRole("option", { name: next }).click()
}

async function selectFile(page: Page, file: string) {
  await page.getByRole("button", { name: file }).click()
  await expectSelectedFile(page, file)
}

async function expectSelectedFile(page: Page, file: string) {
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText(file)
}

async function switchSession(page: Page, title: string) {
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
}

async function setup(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "review-state-persistence",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [session(sessionA, titleA, 1700000000000), session(sessionB, titleB, 1700000001000)],
    pageMessages: () => ({ items: [] }),
  })
  await page.route(/\/vcs(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ branch: "feature", default_branch: "dev" }),
    }),
  )
  await page.route("**/vcs/diff**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        new URL(route.request().url()).searchParams.get("mode") === "branch"
          ? [diff("src/alpha.ts"), diff("src/beta.ts")]
          : [diff("src/alpha.ts"), diff("src/gamma.ts")],
      ),
    }),
  )
  await page.addInitScript(
    ({ directory, server, sessions }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((sessionId: string) => ({ type: "session", server, sessionId }))),
      )
    },
    { directory, server, sessions: [sessionA, sessionB] },
  )
}

function session(id: string, title: string, created: number) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
  }
}

function diff(file: string) {
  return {
    file,
    additions: 1,
    deletions: 1,
    status: "modified",
    patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after'\n`,
  }
}

function sessionHref(sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}
