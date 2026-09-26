import { base64Encode } from "@opencode/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewWithoutGit"
const sessionID = "ses_review_without_git"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

for (const view of ["desktop", "mobile"] as const) {
  test(`offers Git initialization instead of an empty changes selector (${view})`, async ({ page }) => {
    test.setTimeout(180_000)
    if (view === "mobile") await page.setViewportSize({ width: 390, height: 844 })
    const project = {
      id: "proj_review_without_git",
      worktree: directory,
      vcs: undefined as string | undefined,
      name: "review-without-git",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    }
    const session = {
      id: sessionID,
      slug: sessionID,
      projectID: project.id,
      directory,
      title: "Review without Git",
      version: "dev",
      time: { created: 1700000000000, updated: 1700000000000 },
    }
    await mockOpenCodeServer(page, {
      directory,
      project,
      provider: { all: [], connected: [], default: {} },
      sessions: [session],
      pageMessages: () => ({ items: [] }),
    })
    const requests: string[] = []
    await page.route("**/api/vcs/init*", (route) => {
      requests.push(route.request().url())
      project.id = "proj_review_with_git"
      project.vcs = "git"
      session.projectID = project.id
      return route.fulfill({ status: 204 })
    })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`, { waitUntil: "domcontentloaded" })
    if (view === "desktop") {
      await expectSessionTitle(page, "Review without Git")
      await page.getByRole("button", { name: "Toggle review" }).click()
    } else {
      await page.getByRole("tablist", { name: "Session view" }).getByRole("tab", { name: "Changes" }).click()
    }

    const panel = view === "desktop" ? page.locator("#review-panel") : page.locator("[data-component='session-review']")
    await expect(panel.getByText("Track, review, and undo changes in this project")).toBeVisible()
    await expect(panel.getByRole("button", { name: "Git changes" })).toHaveCount(0)
    const init = panel.getByRole("button", { name: "Create Git repository" })
    await expect(init).toBeVisible()
    await test.info().attach("review-without-git", { body: await panel.screenshot(), contentType: "image/png" })
    await init.click()
    await expect(panel.getByRole("button", { name: "Git changes" })).toBeVisible()
    await expect(init).toHaveCount(0)
    await test.info().attach("review-after-git", { body: await panel.screenshot(), contentType: "image/png" })
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]!).searchParams.get("location[directory]")).toBe(directory)
  })
}
