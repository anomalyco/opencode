import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionReady } from "../utils/waits"

const directory = "/projects/deferred-discovery"
const draftID = "draft_deferred_discovery"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const project = {
  id: "proj_deferred_discovery",
  canonical: directory,
  worktree: directory,
  vcs: "git",
  name: "deferred-discovery",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

test("an existing session discovers only its own project's inventory", async ({ page }) => {
  const sessionID = "ses_deferred_discovery"
  const title = "Deferred discovery session"
  const workspace = `${directory}/feature`
  const inventory = Promise.withResolvers<void>()
  const requests: (string | null)[] = []
  await mockOpenCodeServer(page, {
    directory: workspace,
    project,
    provider: { all: [], connected: [], default: {} },
    sessions: [{ id: sessionID, projectID: project.id, directory: workspace, title, time: project.time }],
    pageMessages: () => ({
      items: [
        { id: "msg_discovery", type: "user", text: "Keep workspace identity", time: { created: project.time.created } },
      ],
    }),
  })
  await page.route(
    (url) => url.pathname === "/api/project",
    (route) => route.fulfill({ json: [project, ...historical], headers: { "access-control-allow-origin": "*" } }),
  )
  await page.route(
    (url) => url.pathname === "/api/worktree",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      requests.push(new URL(route.request().url()).searchParams.get("location[directory]"))
      await inventory.promise
      return route.fulfill({
        json: [{ directory }, { directory: workspace, strategy: "git" }],
        headers: { "access-control-allow-origin": "*" },
      })
    },
  )
  const loaded = page.waitForResponse(
    (response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/worktree",
  )
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionReady(page, { server, sessionID, title })
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()
  await editor.fill("Keep this session responsive")
  await expect(editor).toHaveText("Keep this session responsive")
  inventory.resolve()
  expect((await loaded).ok()).toBe(true)
  await expect(editor).toHaveText("Keep this session responsive")
  expect(requests).toEqual([directory])
})
const historical = Array.from({ length: 300 }, (_, index) => ({
  ...project,
  id: `proj_historical_${index}`,
  canonical: `/projects/historical-${index}`,
  worktree: `/projects/historical-${index}`,
  name: `historical-${index}`,
}))
const lastWorktree = "worktree-12-with-a-long-feature-branch-name-that-overflows-the-picker"

test.use({
  viewport: { width: 1280, height: 800 },
  colorScheme: "dark",
  contextOptions: { reducedMotion: "reduce" },
})

for (const count of [0, 12]) {
  test(`defers historical discovery until the picker opens with ${count} worktrees`, async ({ page }, testInfo) => {
    const worktrees = Array.from({ length: count }, (_, index) => ({
      directory: `${directory}/${index === 11 ? lastWorktree : `worktree-${index + 1}`}`,
      strategy: "git",
    }))
    const inventory = Promise.withResolvers<void>()
    const requests: (string | null)[] = []
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (request.method() === "GET" && url.pathname === "/api/worktree") {
        requests.push(url.searchParams.get("location[directory]"))
      }
    })
    await mockOpenCodeServer(page, {
      directory,
      project,
      provider: { all: [], connected: [], default: {} },
      sessions: [],
      pageMessages: () => ({ items: [] }),
    })
    await page.route(
      (url) => url.pathname === "/api/project",
      (route) => route.fulfill({ json: [project, ...historical], headers: { "access-control-allow-origin": "*" } }),
    )
    await page.route(
      (url) => url.pathname === "/api/worktree",
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback()
        await inventory.promise
        return route.fulfill({
          json: [{ directory }, ...worktrees],
          headers: { "access-control-allow-origin": "*" },
        })
      },
    )
    await page.addInitScript(
      ({ directory, draftID, server }) => {
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: { local: [{ worktree: directory, expanded: true }] },
            lastProject: { local: directory },
          }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([{ type: "draft", draftID, server, directory }]),
        )
      },
      { directory, draftID, server },
    )

    const metadata = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/project")
    await page.goto(`/new-session?draftId=${draftID}`)
    expect(await (await metadata).json()).toHaveLength(301)
    const editor = page.locator('[data-component="composer-editor"]')
    await expectAppVisible(editor)
    await expect(editor).toBeEditable()
    await editor.fill("Keep this draft while discovering worktrees")
    await expect(editor).toHaveText("Keep this draft while discovering worktrees")
    const local = page.getByRole("button", { name: "Local", exact: true })
    await expect(local).toBeEnabled()
    expect(requests).toEqual([])

    const requested = page.waitForRequest(
      (request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/worktree",
    )
    await local.click()
    await requested
    const loading = page.getByRole("status").filter({ hasText: "Loading" })
    await expect(loading).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Local repository", exact: true })).toBeEnabled()
    await expect(page.getByRole("menuitem", { name: "New worktree", exact: true })).toBeEnabled()
    expect(requests).toEqual([directory])

    inventory.resolve()
    await expect(loading).toBeHidden()
    if (count === 0) {
      await expect(page.getByRole("menuitem", { name: "Worktree", exact: true })).toHaveCount(0)
      await expect(page.getByRole("menuitem", { name: "View all", exact: true })).toBeEnabled()
      await page.getByRole("menuitem", { name: "New worktree", exact: true }).click()
      await expect(page.getByRole("button", { name: "New worktree", exact: true })).toBeEnabled()
      await expect(page.getByRole("button", { name: "from main", exact: true })).toBeVisible()
    }
    if (count > 0) {
      await page.getByRole("menuitem", { name: "Worktree", exact: true }).click()
      const search = page.getByRole("textbox", { name: "Search worktrees", exact: true })
      await expect(search).toBeEditable()
      await search.fill("not-a-worktree")
      await expect(page.getByRole("menuitem", { name: /^worktree-\d+/ })).toHaveCount(0)
      await search.fill("worktree-12")
      const choice = page.getByRole("menuitem", { name: lastWorktree, exact: true })
      await expect(choice).toBeEnabled()
      const screenshot = testInfo.outputPath("loaded-worktree-picker.png")
      await page.screenshot({ path: screenshot })
      await testInfo.attach("loaded-worktree-picker", { path: screenshot, contentType: "image/png" })
      await choice.click()
      const selected = page.getByRole("button", { name: lastWorktree, exact: true })
      await expect(selected).toBeEnabled()
      await page.setViewportSize({ width: 800, height: 800 })
      await expect(selected).toBeInViewport()
      await selected.click()
      await page.getByRole("menuitem", { name: "Worktree", exact: true }).click()
      await expect(search).toHaveValue("")
      await expect(page.getByRole("menuitem", { name: /^worktree-\d+/ })).toHaveCount(12)
      await expect(choice).toBeInViewport()
      const narrow = testInfo.outputPath("narrow-worktree-picker.png")
      await page.screenshot({ path: narrow })
      await testInfo.attach("narrow-worktree-picker", { path: narrow, contentType: "image/png" })
      await page.keyboard.press("Escape")
      await expect(selected).toHaveAttribute("aria-expanded", "false")
      await expect(selected).toBeFocused()
      await selected.click()
      await page.getByRole("menuitem", { name: "Local repository", exact: true }).click()
      await expect(local).toBeEnabled()
    }
    await expect(editor).toBeEditable()
    await expect(editor).toHaveText("Keep this draft while discovering worktrees")
    expect(requests).toEqual([directory])
  })
}
