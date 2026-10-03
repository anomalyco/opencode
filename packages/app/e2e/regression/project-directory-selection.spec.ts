import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directories = ["/opencode-demo/canonical", "/opencode-demo/test-worktree"]

for (const primary of directories) {
  test(`keeps explicitly opened directories when ${primary} owns the Git project`, async ({ page }, info) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await mockOpenCodeServer(page, {
      sessions: [],
      provider: fixture.provider,
      directory: directories[0],
      project: {
        ...fixture.project,
        name: undefined,
        worktree: primary,
        sandboxes: directories.filter((directory) => directory !== primary),
      },
      pageMessages,
      fileList: () => ["opencode-demo", "canonical", "test-worktree"].map((path) => ({ path, type: "directory" })),
      findFiles: () => [directories[0]],
    })
    await page.addInitScript((dirs) => {
      if (localStorage.getItem("opencode.global.dat:server")) return
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: dirs.slice(1).map((worktree) => ({ worktree, expanded: false })) },
          lastProject: {},
        }),
      )
    }, directories)

    await page.goto("/")
    const add = page.getByRole("button", { name: "Add project" }).first()
    await expectAppVisible(add)
    await add.click()
    await page.getByRole("textbox").last().fill(directories[0])
    await page.locator(`[data-directory-path="${directories[0]}"]`).click()
    const projects = page.getByRole("complementary", { name: "Projects" })
    await expect(projects.locator('[data-component="home-project-row"]')).toHaveCount(2)
    const selected = projects.locator('[data-component="home-project-row"]').filter({ hasText: "canonical" })
    await expect(selected).toHaveAttribute("aria-current", "page")
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}")
          return state.projects?.local?.map((project: { worktree: string }) => project.worktree)
        }),
      )
      .toEqual(directories)
    await page.reload()
    await expect(projects.locator('[data-component="home-project-row"]')).toHaveCount(2)
    await page.screenshot({ path: info.outputPath("explicit-directories.png"), fullPage: false })
    for (const name of ["test-worktree", "canonical"]) {
      const row = projects.locator('[data-component="home-project-row"]').filter({ hasText: name })
      await row.hover()
      await row.locator("..").locator('[data-action="home-project-menu"]').click()
      await page.getByRole("menuitem", { name: "Close", exact: true }).click()
    }
    await expect(projects.locator('[data-component="home-recently-closed-row"]')).toHaveCount(2)
    await projects.locator('[data-component="home-recently-closed-row"]').filter({ hasText: "canonical" }).click()
    await expect(selected).toHaveAttribute("aria-current", "page")
    await selected.hover()
    await selected.locator("..").locator('[data-action="home-project-new-session"]').click()
    await expect(page).toHaveURL(/\/new-session\?draftId=/)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const tabs = JSON.parse(localStorage.getItem("opencode.window.browser.dat:tabs") ?? "[]")
          const id = new URL(location.href).searchParams.get("draftId")
          return tabs.find((tab: { draftID: string }) => tab.draftID === id)?.directory
        }),
      )
      .toBe(directories[0])
    expect(errors).toEqual([])
  })
}
