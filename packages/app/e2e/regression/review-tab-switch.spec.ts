import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewTabSwitch"
const projectID = "proj_review_tab_switch"
const sessionA = "ses_review_tab_a"
const sessionB = "ses_review_tab_b"
const titleA = "Alpha session"
const titleB = "Beta session"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
// Marks the review pane DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

// The v2 review pane's diff data is workspace-scoped: switching between session
// tabs in the same workspace must update its parameters reactively instead of
// tearing the pane down and remounting it (which flickers).
test("keeps the v2 review pane mounted when switching session tabs in a workspace", async ({ page }) => {
  await setup(page)

  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)

  await page.getByRole("button", { name: "Toggle review" }).click()
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  await expectAppVisible(review)
  await expectAppVisible(page.getByRole("button", { name: /example\.ts/ }))
  await writeProbe(page)

  await switchTab(page, titleB)
  await expectSessionTitle(page, titleB)
  await expectAppVisible(review)
  expect(await readProbe(page)).toBe(PROBE)

  await switchTab(page, titleA)
  await expectSessionTitle(page, titleA)
  await expectAppVisible(review)
  expect(await readProbe(page)).toBe(PROBE)
})

type Probed = HTMLElement & { __e2eProbe?: string }

async function switchTab(page: Page, title: string) {
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
}

async function writeProbe(page: Page) {
  await page.locator('#review-panel [data-component="session-review-v2"]').evaluate((el, probe) => {
    ;(el as Probed).__e2eProbe = probe
  }, PROBE)
}

async function readProbe(page: Page) {
  return page.locator('#review-panel [data-component="session-review-v2"]').evaluate((el) => (el as Probed).__e2eProbe)
}

async function setup(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "review-tab-switch",
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
    vcsDiff: [
      {
        file: "src/example.ts",
        additions: 1,
        deletions: 1,
        status: "modified",
        patch:
          "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after'\n",
      },
    ],
    pageMessages: () => ({ items: [] }),
  })

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

function sessionHref(sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}
