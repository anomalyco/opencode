import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const MOBILE_VIEWPORT_WIDTH = 390
const SIDEBAR_AUTO_DISMISS_THRESHOLD = 250

test.use({ viewport: { width: MOBILE_VIEWPORT_WIDTH, height: 800 } })

test("dismisses full-width mobile sidebar after selecting a session", async ({ page }) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
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

  await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.sourceID}`)
  await expectSessionTitle(page, fixture.expected.sourceTitle)

  const toggle = page.getByRole("button", { name: "Toggle menu" })
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  const sidebar = page.locator('[data-component="sidebar-nav-mobile"]')
  await expect
    .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThanOrEqual(MOBILE_VIEWPORT_WIDTH - SIDEBAR_AUTO_DISMISS_THRESHOLD)

  await sidebar.getByRole("link", { name: fixture.expected.targetTitle }).click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
})
