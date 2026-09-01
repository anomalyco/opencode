import { base64Encode } from "@opencode-ai/util/encode"
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
const diffs = Array.from({ length: 2_740 }, (_, index) =>
  fileDiff(`src/generated-${String(index).padStart(4, "0")}.ts`),
)
// Marks the review pane DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

// The review pane's data is workspace-scoped, but visibility belongs to each
// session tab. Switching tabs must keep the pane mounted without opening it.
test("keeps review visibility per tab and the pane mounted across tab switches", async ({ page }) => {
  await setup(page)

  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)

  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect
    .poll(() =>
      page
        .locator('[data-slot="session-chat-panel"]')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toContain("0.24s")
  const reviewTab = page.locator("#session-side-panel-review-tab")
  const reviewTabPanel = page.locator("#session-side-panel-review-tabpanel")
  const chatPanel = page.locator('[data-slot="session-chat-panel"]')
  await expect(reviewTab).toHaveAttribute("aria-controls", "session-side-panel-review-tabpanel")
  await expect(reviewTabPanel).toHaveAttribute("id", "session-side-panel-review-tabpanel")
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  await expectAppVisible(review)
  await expect(chatPanel).toHaveCSS("width", "580px")
  await expectAppVisible(page.getByRole("button", { name: "generated-0000.ts" }))
  await writeProbe(page)

  await switchTab(page, titleB)
  await expectSessionTitle(page, titleB)
  await expect(review).toBeHidden()
  await expect
    .poll(() =>
      page
        .locator('[data-slot="session-chat-panel"]')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toBe("0s")
  expect(await readProbe(page)).toBe(PROBE)

  await page.getByRole("button", { name: "Toggle review" }).click()
  await expectAppVisible(review)
  await expect(chatPanel).toHaveCSS("width", "520px")

  await switchTab(page, titleA)
  await expectSessionTitle(page, titleA)
  await expectAppVisible(review)
  await expect(chatPanel).toHaveCSS("width", "580px")
  await expectAppVisible(page.getByRole("button", { name: "generated-0000.ts" }))
  expect(await readProbe(page)).toBe(PROBE)

  await expect
    .poll(() =>
      page.evaluate(
        ({ key }) => {
          const panes = JSON.parse(localStorage.getItem("opencode.window.browser.dat:tabs.panes") ?? "{}")
          return panes[key]?.review
        },
        { key: `${server}\n${sessionHref(sessionA)}` },
      ),
    )
    .toBe(true)
  await page.reload()
  await expectSessionTitle(page, titleA)
  await expectAppVisible(review)
  await expect(chatPanel).toHaveCSS("width", "580px")

  const viewport = page.locator('#review-panel [data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  await expect(page.getByRole("button", { name: "generated-2739.ts" })).toBeVisible()
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
    vcsDiff: diffs,
    pageMessages: () => ({ items: [] }),
  })

  await page.addInitScript(
    ({ directory, server, sessions, panes }) => {
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
      if (!localStorage.getItem("opencode.window.browser.dat:tabs.panes")) {
        localStorage.setItem("opencode.window.browser.dat:tabs.panes", JSON.stringify(panes))
      }
    },
    {
      directory,
      server,
      sessions: [sessionA, sessionB],
      panes: {
        [`${server}\n${sessionHref(sessionA)}`]: { sessionWidth: 580 },
        [`${server}\n${sessionHref(sessionB)}`]: { sessionWidth: 520 },
      },
    },
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

function fileDiff(file: string) {
  return {
    file,
    additions: 1,
    deletions: 1,
    status: "modified",
    patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after'\n`,
  }
}
