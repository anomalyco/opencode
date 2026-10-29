import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@opencode/util/encode"
import { SERVER, holdRoute, project, provider, session } from "../utils/app"
import { browseFiles, openFileLauncher, openReviewLauncher, reviewTabs } from "../utils/side-panel"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fileDiff, fileNode, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"
import { readFile } from "node:fs/promises"

test.use({ viewport: { width: 1440, height: 900 } })

test("review toggle shows its tooltip with the side panel open or closed", async ({ page }) => {
  await openSession(page, {
    name: "ReviewTooltip",
    seed: { panes: { ses_reviewtooltip: { review: true } } },
  })
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  const tooltip = page.getByRole("tooltip", { name: /Toggle review/ })
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("#review-panel")).toHaveAttribute("aria-hidden", "false")
  await toggle.hover()
  await expect(tooltip).toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await page.locator("[data-session-title]").hover()
  await expect(tooltip).toBeHidden()
  await toggle.hover()
  await expect(tooltip).toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await page.locator("[data-session-title]").hover()
  await expect(tooltip).toBeHidden()
  await toggle.hover()
  await expect(tooltip).toBeVisible()
})

for (const view of ["desktop", "mobile"] as const) {
  test(`offers Git initialization for a project without VCS (${view})`, async ({ page }) => {
    if (view === "mobile") await page.setViewportSize({ width: 390, height: 844 })
    const requests: { directory: string; provider?: string }[] = []

    const workspace = await openSession(page, {
      name: "ReviewWithoutGit",
      project: { vcs: undefined },
      onVcsInit: (input) => requests.push(input),
    })

    if (view === "desktop") await page.getByRole("button", { name: "Toggle review" }).click()
    else await page.getByRole("tablist", { name: "Session view" }).getByRole("tab", { name: "Changes" }).click()

    const panel = view === "desktop" ? page.locator("#review-panel") : page.locator('[data-component="session-review"]')

    if (view === "desktop") await openReviewLauncher(panel)
    await expect(panel.getByText("Track, review, and undo changes in this project")).toBeVisible()
    await expect(panel.getByRole("button", { name: "Git changes" })).toHaveCount(0)
    const init = panel.getByRole("button", { name: "Create Git repository" })
    await init.click()
    await expect.poll(() => requests).toEqual([{ directory: workspace.directory, provider: "git" }])
    await expect(panel.getByRole("button", { name: "Git changes" })).toBeVisible()
    await expect(init).toHaveCount(0)
  })
}

test("Git initialization belongs to its session and refreshes after a session switch", async ({ page }) => {
  const requests: { directory: string; provider?: string }[] = []

  const workspace = await openSession(page, {
    name: "ReviewInitSwitch",
    project: { vcs: undefined },
    onVcsInit: (input) => requests.push(input),
    sessions: [
      { id: "ses_init_a", title: "Initialize Alpha" },
      { id: "ses_init_b", title: "Initialize Beta" },
    ],
    seed: {
      panes: { ses_init_a: { review: true }, ses_init_b: { review: true } },
      storage: reviewTabs("C:/OpenCode/ReviewInitSwitch", "ses_init_a", "ses_init_b"),
    },
  })

  // The successful init finishes while another session is routed.
  const request = await holdRoute(page, (url) => url.pathname === "/api/vcs/init", { method: "POST" })
  const panel = page.locator("#review-panel")
  const init = panel.getByRole("button", { name: "Create Git repository", exact: true })
  const pending = panel.getByRole("button", { name: "Creating Git repository…", exact: true })
  await expect(init).toBeEnabled()
  await init.click()
  await request.arrived
  await expect(pending).toBeDisabled()

  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Beta" }).click()
  await expectSessionTitle(page, "Initialize Beta")
  await expect(init).toBeEnabled()
  await expect(pending).toHaveCount(0)

  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Alpha" }).click()
  await expectSessionTitle(page, "Initialize Alpha")
  await expect(pending).toBeDisabled()
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Beta" }).click()
  await expectSessionTitle(page, "Initialize Beta")
  await expect(init).toBeEnabled()

  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/vcs/init")
  // The worktree event can refresh project-wide UI by itself; the completed action must also reload Alpha's cache.
  const refreshed = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/session/ses_init_a")
  request.release()
  expect((await response).status()).toBe(204)
  expect((await refreshed).status()).toBe(200)
  expect(requests).toEqual([{ directory: workspace.directory, provider: "git" }])
  await expect(panel.getByRole("button", { name: "Git changes", exact: true })).toBeVisible()
  await expect(init).toHaveCount(0)
  await expect(page.getByText("Request failed", { exact: true })).toHaveCount(0)

  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Alpha" }).click()
  await expectSessionTitle(page, "Initialize Alpha")
  await expect(panel.getByRole("button", { name: "Git changes", exact: true })).toBeVisible()
  await expect(pending).toHaveCount(0)
})

test("a rejected Git init releases its session's button without showing an error in another session", async ({
  page,
}) => {
  await openSession(page, {
    name: "ReviewInitFailure",
    project: { vcs: undefined },
    sessions: [
      { id: "ses_init_failure_a", title: "Initialize Alpha" },
      { id: "ses_init_failure_b", title: "Initialize Beta" },
    ],
    seed: {
      panes: { ses_init_failure_a: { review: true }, ses_init_failure_b: { review: true } },
      storage: reviewTabs("C:/OpenCode/ReviewInitFailure", "ses_init_failure_a", "ses_init_failure_b"),
    },
  })
  const request = await holdRoute(page, (url) => url.pathname === "/api/vcs/init", { method: "POST" })
  const init = page.locator("#review-panel").getByRole("button", { name: "Create Git repository", exact: true })
  await init.click()
  await request.arrived
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Beta" }).click()
  await expectSessionTitle(page, "Initialize Beta")
  await expect(init).toBeEnabled()
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/vcs/init")
  request.release()
  expect((await response).status()).toBe(501)
  await expect(page.getByText("Request failed", { exact: true })).toHaveCount(0)
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Alpha" }).click()
  await expectSessionTitle(page, "Initialize Alpha")
  await expect(init).toBeEnabled()
})

test("open file tab browses, searches, and tracks missing files", async ({ page }) => {
  const searches: { query: string; dirs?: string; limit?: number; directory: string }[] = []
  const directory = "C:/OpenCode/ReviewOpenFile"
  const files = Array.from({ length: 80 }, (_, index) => `file-${String(index).padStart(2, "0")}.ts`)

  const workspace = await openSession(page, {
    name: "ReviewOpenFile",
    vcsDiff: [fileDiff("src/changed.ts")],
    fileList: (path) =>
      path
        ? []
        : [
            fileNode(directory, "README.md"),
            fileNode(directory, "src", "directory"),
            ...files.map((file) => fileNode(directory, file)),
          ],
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    findFiles: (input) => {
      searches.push(input)

      return input.query === "nested" ? [fileNode(directory, "src/nested.ts")] : []
    },
    seed: {
      panes: { ses_reviewopenfile: { review: true } },
      storage: {
        ...reviewTabs("C:/OpenCode/ReviewOpenFile", "ses_reviewopenfile"),
        "opencode.global.dat:review-panel-v2": { sidebarOpened: false },
      },
    },
  })

  const panel = page.locator("#review-panel")
  const sidebar = panel.locator('[data-slot="session-review-v2-sidebar"]')
  const sidebarToggle = panel.getByRole("button", { name: "Toggle file tree" })
  const contextButton = page.getByRole("button", { name: "Toggle session context" })
  const tab = (name: string) => panel.getByRole("tab", { name, exact: true })
  await contextButton.click()
  await expect(tab("Context")).toHaveAttribute("aria-selected", "true")
  await openFileLauncher(panel)
  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await expect(filter).toBeFocused()
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await expect(sidebarToggle).toBeDisabled()
  await expect(sidebar).toBeVisible()
  await contextButton.click()
  await expect(tab("Context")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "false")
  await expect(sidebar).toBeHidden()
  // The strip's launcher tab returns to it.
  await tab("Open file").click()
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("ReviewOpenFile", { exact: true })).toBeVisible()

  await panel.getByRole("treeitem", { name: "README.md" }).click()
  await expect(tab("README.md")).toHaveAttribute("aria-selected", "true")
  await expect(sidebarToggle).toBeEnabled()
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()
  await expect(sidebar).toHaveCount(0)

  const missingRead = "**/api/fs/read/README.md*"
  await page.route(missingRead, (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
      // SAFETY: the server's wire body for a missing file, which the client decodes into its own error.
      // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- see SAFETY above
      json: { _tag: "FileNotFoundError", path: "README.md", message: "File not found: README.md" },
    }),
  )
  const missingResponse = page.waitForResponse((response) => response.url().includes("/api/fs/read/README.md"))
  await workspace.push([filesystemEvent(directory, "README.md", "unlink")])
  await missingResponse
  await expect(page.getByText("Failed to load file", { exact: true })).toHaveCount(0)
  await expect(tab("File not found: README.md")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("File not found: README.md", { exact: true })).toBeVisible()

  await page.unroute(missingRead)
  await workspace.push([filesystemEvent(directory, "README.md", "add")])
  await expect(tab("README.md")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()

  // A new launcher opens beside the preview rather than replacing it.
  await browseFiles(page)
  await expect(tab("README.md")).toHaveAttribute("aria-selected", "false")
  await expect(sidebar).toBeVisible()
  await filter.fill("nested")
  const result = panel.getByRole("option", { name: /nested\.ts/ })
  await expect(result).toBeVisible()
  await expect(filter).toHaveAttribute("aria-activedescendant", (await result.getAttribute("id"))!)
  await filter.press("Enter")
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")
  await expect(sidebarToggle).toBeEnabled()
  await expect(panel.getByText("contents:src/nested.ts", { exact: true })).toBeVisible()
  expect(searches).toContainEqual({ query: "nested", dirs: "file", limit: 200, directory })

  await browseFiles(page)
  await expect(tab("nested.ts")).toHaveCount(1)
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await expect(sidebarToggle).toBeDisabled()
  await panel.locator("#session-side-panel-review-tab").click()
  await expect(sidebarToggle).toBeEnabled()
  await tab("Open file").click()
  await page.keyboard.press("Control+w")
  await expect(tab("Open file")).toHaveCount(0)
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")

  // The New tab view keeps offering Open file, so several launchers stay open; a pick replaces the selected one.
  await openFileLauncher(panel)
  await openFileLauncher(panel)
  await expect(tab("Open file")).toHaveCount(2)
  await panel.getByRole("treeitem", { name: "README.md" }).click()
  await expect(tab("README.md")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Open file")).toHaveCount(1)
  await tab("Open file").click()
  await page.keyboard.press("Control+w")
  await expect(tab("Open file")).toHaveCount(0)
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")

  // The file browser beside file tabs keeps its DOM and scroll position across preview and pinned tab switches.
  await sidebarToggle.click()
  await filter.fill("")
  const root = panel.locator('[data-component="session-review-v2-sidebar-root"]')
  const viewport = root.locator('[data-slot="session-review-v2-sidebar-tree"] [data-file-tree-virtualized-scroll]')
  await expect(root.getByRole("treeitem", { name: "file-00.ts" })).toBeVisible()
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  // The tree ignores the pointer until a scroll settles. A click before then hits the scroller, and Playwright's retry
  // scrolls the row into view itself, which moves the position this case guards.
  await expect(viewport.locator("[data-file-tree-virtualized-list]")).not.toHaveAttribute("data-is-scrolling")
  const scrolled = await viewport.evaluate((element) => element.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await root.evaluate((element) => void (element.dataset.e2eProbe = "original"))

  const expectSidebarKept = async () => {
    expect(await root.evaluate((element) => element.dataset.e2eProbe)).toBe("original")
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrolled)
  }

  await root.getByRole("treeitem", { name: "file-79.ts" }).click()
  await expect(tab("file-79.ts")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:file-79.ts", { exact: true })).toBeVisible()
  await expectSidebarKept()
  await root.getByRole("treeitem", { name: "file-78.ts" }).dblclick()
  await expect(tab("file-78.ts")).toHaveAttribute("aria-selected", "true")
  await root.getByRole("treeitem", { name: "file-79.ts" }).click()
  await expect(tab("file-79.ts")).toHaveAttribute("aria-selected", "true")
  await tab("file-78.ts").click()
  await expect(tab("file-78.ts")).toHaveAttribute("aria-selected", "true")
  await expectSidebarKept()

  // Context opens in front and keeps the preview tab, so closing it selects the first remaining tab.
  await tab("Context").click({ button: "middle" })
  await expect(tab("Context")).toHaveCount(0)
  await contextButton.click()
  await expect(tab("Context")).toHaveAttribute("aria-selected", "true")
  await expect(tab("file-79.ts")).toHaveCount(1)
  await contextButton.click()
  await expect(tab("Context")).toHaveCount(0)
  await expect(panel.locator("#session-side-panel-review-tab")).toHaveAttribute("aria-selected", "true")
})

for (const listed of [false, true]) {
  test(`the open file heading names a subfolder session ${listed ? "after its sidebar project" : "after its folder"}`, async ({
    page,
  }) => {
    const root = "C:/OpenCode/BrowserRepo"
    const directory = `${root}/packages/app`
    await openSession(page, {
      name: "BrowserRepo",
      sessions: [{ id: "ses_browserrepo", title: "BrowserRepo", directory }],
      fileList: (path) => (path ? [] : [fileNode(directory, "README.md")]),
      // The server also lists the subfolder as its own project, renamed.
      ...(listed && {
        projects: [
          project({ id: "proj_browserrepo", directory: root, name: "BrowserRepo" }),
          project({ id: "proj_browserrepo_app", directory, name: "Custom app" }),
        ],
      }),
      seed: { panes: { ses_browserrepo: { review: true } } },
    })
    const panel = page.locator("#review-panel")
    await openFileLauncher(panel)
    await expect(panel.getByRole("treeitem", { name: "README.md" })).toBeVisible()
    await expect(panel.locator('[data-slot="session-review-v2-sidebar-title"]')).toHaveText(
      listed ? "Custom app" : "app",
    )
  })
}

test("context closes the side region only when its button opened it", async ({ page }) => {
  // A /btw tab saved before plugins must not linger as a hidden tab that keeps the region open.
  await openSession(page, {
    name: "ReviewContextOpener",
    seed: {
      storage: {
        "opencode.global.dat:layout": {
          sessionTabs: {
            [`local\u0000${base64Encode("C:/OpenCode/ReviewContextOpener")}/ses_reviewcontextopener`]: {
              all: ["btw"],
              active: "btw",
            },
          },
        },
      },
    },
  })
  const panel = page.locator("#review-panel")
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  const contextButton = page.getByRole("button", { name: "Toggle session context" })
  const context = panel.getByRole("tab", { name: "Context", exact: true })

  await contextButton.click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await contextButton.click()
  await expect(context).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")

  // With another tab open, closing Context leaves the region open on it.
  await contextButton.click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(context).toHaveAttribute("aria-selected", "true")
  // "+" opens the New tab view over Context; picking a launcher replaces it with the tab it opens.
  const newTab = panel.getByRole("tab", { name: "New tab", exact: true })
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(newTab).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("button", { name: /^Review/ }).click()
  await expect(newTab).toHaveCount(0)
  await expect(panel.locator("#session-side-panel-review-tab")).toHaveAttribute("aria-selected", "true")
  // Closing Review returns to Context, the tab the view opened over, without bringing the replaced view back.
  await panel
    .locator('div[data-value="review:changes"]')
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await expect(newTab).toHaveCount(0)
  // "Recently closed" lists only files, so the closed Review is offered again by its launcher alone.
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(panel.getByRole("region", { name: "Recently closed", exact: true })).toHaveCount(0)
  await panel.getByRole("button", { name: /^Review/ }).click()
  await expect(panel.locator("#session-side-panel-review-tab")).toHaveAttribute("aria-selected", "true")
  await context.click()
  await contextButton.click()
  await expect(context).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(panel.locator("#session-side-panel-review-tab")).toHaveAttribute("aria-selected", "true")
})

test("context hides free-model cost but keeps paid-model zero cost", async ({ page }) => {
  const cases = [
    { id: "ses_context_free", title: "Free model", model: "free", cost: 0, usage: false, text: "0" },
    { id: "ses_context_paid", title: "Paid model", model: "paid", cost: 0, usage: false, text: "0·$0.00" },
    { id: "ses_context_used", title: "Paid usage", model: "paid", cost: 1.25, usage: true, text: "2k·$1.25" },
    { id: "ses_context_free_used", title: "Free usage", model: "free", cost: 0, usage: true, text: "2k" },
    { id: "ses_context_mixed", title: "Previously paid", model: "free", cost: 1.25, usage: true, text: "2k·$1.25" },
    { id: "ses_context_unknown", title: "Unknown pricing", model: "missing", cost: 0, usage: false, text: "0·$0.00" },
    { id: "ses_context_output", title: "Output pricing", model: "output", cost: 0, usage: false, text: "0·$0.00" },
    // The root's model is free, but its subagent spent on a paid model: the family total shows.
    { id: "ses_context_family", title: "Paid subagent", model: "free", cost: 0, usage: true, text: "2k·$1.25" },
    // A completed compaction resets the context until the next reply reports usage, as in the TUI.
    { id: "ses_context_compacted", title: "Compacted", model: "paid", cost: 1.25, usage: true, text: "0·$1.25" },
  ]

  await openSession(page, {
    name: "ContextPricing",
    provider: provider(
      { id: "free", name: "Free", cost: { input: 0, output: 0 } },
      { id: "paid", name: "Paid", cost: { input: 1, output: 3 } },
      { id: "output", name: "Output", cost: { input: 0, output: 1 } },
    ),
    sessions: [
      ...cases.map((item) => ({
        id: item.id,
        title: item.title,
        model: { id: item.model, providerID: "opencode" },
        cost: item.cost,
      })),
      {
        id: "ses_context_family_child",
        parentID: "ses_context_family",
        title: "Subagent run",
        model: { id: "paid", providerID: "opencode" },
        cost: 1.25,
      },
    ],
    pageMessages: (id) => ({
      items: cases.flatMap((item): SessionMessageInfo[] =>
        item.id === id && item.usage
          ? [
              {
                id: `msg_${item.id}`,
                type: "assistant",
                agent: "build",
                model: { id: item.model, providerID: "opencode" },
                tokens: { input: 1500, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
                content: [{ type: "text", text: "Done." }],
                time: { created: 1, completed: 2 },
              },
              ...(item.id === "ses_context_compacted"
                ? [
                    {
                      id: `msg_${item.id}_compaction`,
                      type: "compaction" as const,
                      status: "completed" as const,
                      reason: "manual" as const,
                      summary: "Current state",
                      recent: "",
                      time: { created: 3 },
                    },
                  ]
                : []),
            ]
          : [],
      ),
    }),
  })
  const button = page.getByRole("button", { name: "Toggle session context", exact: true })

  for (const item of cases) {
    await page.locator("[data-titlebar-tab-slot]", { hasText: item.title }).click()
    await expectSessionTitle(page, item.title)
    await expect(button).toHaveText(item.text)
  }
})

test("file tree expands Windows paths and scrolls long names in both directions", async ({ page }) => {
  const directory = "C:/OpenCode/OpenFileExpand"
  const longFilename = "a-very-long-file-name-that-must-overflow-the-file-sidebar-instead-of-being-truncated.ts"
  const longPath = `frontend/${longFilename}`
  await openSession(page, {
    name: "OpenFileExpand",
    vcsDiff: [
      {
        file: longPath,
        additions: 1,
        deletions: 0,
        status: "added",
        patch: "@@ -0,0 +1 @@\n+export const added = true\n",
      },
    ],
    fileList: (path) => {
      if (path === "frontend\\" || path === "frontend") {
        return [
          fileNode(directory, "frontend/nested", "directory"),
          { ...fileNode(directory, "frontend/app.ts"), path: "frontend\\app.ts" },
          { ...fileNode(directory, longPath), path: `frontend\\${longFilename}` },
          // Short rows below the long one, so it can scroll out of view.
          ...Array.from({ length: 80 }, (_, index) => {
            const name = `file-${String(index).padStart(2, "0")}.ts`

            return { ...fileNode(directory, `frontend/${name}`), path: `frontend\\${name}` }
          }),
        ]
      }

      if (path === "frontend/nested") return [fileNode(directory, "frontend/nested/child.ts")]

      if (path) return []

      return [
        { ...fileNode(directory, "frontend", "directory"), name: "", path: "frontend\\" },
        fileNode(directory, "README.md"),
      ]
    },
    findFiles: ({ query }) => (longPath.includes(query) ? [fileNode(directory, longPath)] : []),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { ses_openfileexpand: { review: true } },
      storage: { "opencode.global.dat:review-panel-v2": { sidebarOpened: true } },
    },
  })

  const panel = page.locator("#review-panel")
  await openFileLauncher(panel)
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("aria-selected", "true")
  const sidebar = panel.locator('[data-component="session-review-v2-sidebar-root"]')
  const frontend = panel.locator('[data-type="item"][data-item-path="frontend/"]')
  await expect(frontend.getByText("frontend", { exact: true })).toBeVisible()
  await expect(frontend).toHaveAttribute("aria-expanded", "false")
  await frontend.click()
  await expect(frontend).toHaveAttribute("aria-expanded", "true")

  const nested = panel.locator('[data-type="item"][data-item-path="frontend/nested/"]')
  await nested.click()
  const child = panel.locator('[data-type="item"][data-item-path="frontend/nested/child.ts"]')
  await expect(child).toBeVisible()
  await expect(child.locator('[data-item-section="spacing-item"]')).toHaveCount(2)

  // Every ancestor guide runs through its folder's chevron, not just the first indentation level.
  const guideOffset = () =>
    child.evaluate((element) => {
      const root = element.getRootNode()

      if (!(root instanceof ShadowRoot)) throw new Error("Expected the file tree's shadow root")

      return Math.max(
        ...Array.from(element.querySelectorAll<HTMLElement>('[data-item-section="spacing-item"]'), (guide) => {
          const folder = Array.from(root.querySelectorAll<HTMLElement>('[data-type="item"]')).find(
            (row) => row.dataset.itemPath === guide.dataset.ancestorPath,
          )!

          const icon = folder.querySelector('[data-item-section="icon"]')!.getBoundingClientRect()
          const line = guide.getBoundingClientRect()
          const center = getComputedStyle(guide).direction === "rtl" ? line.right - 0.5 : line.left + 0.5

          return Math.abs(center - (icon.left + icon.width / 2))
        }),
      )
    })

  await expect.poll(guideOffset).toBeLessThanOrEqual(0.5)

  const viewport = sidebar.locator('[data-slot="session-review-v2-sidebar-viewport"]')
  const longRow = panel.locator(`[data-type="item"][data-item-path="${longPath}"]`)
  const content = longRow.locator('[data-item-section="content"]')
  const status = longRow.locator('[data-item-section="git"]')
  await expect(longRow).toBeVisible()
  await expect(content).toHaveAttribute("title", longFilename)
  // The name is never clipped: the tree scrolls sideways and the change letter sticks to the pane's edge.
  await expect
    .poll(() => content.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(0)
  await expect
    .poll(() =>
      longRow.evaluate((element) => {
        const scroll = element.closest("[data-file-tree-virtualized-scroll]")!

        return scroll.scrollWidth - scroll.clientWidth
      }),
    )
    .toBeGreaterThan(0)
  await expect(status).toHaveText("A")
  await expect.poll(() => statusInset(status, "right")).toBeLessThanOrEqual(24)
  const treeScroll = panel.locator(".opencode-pierre-file-tree")

  const scrollTree = (position: { left?: number; top?: number }) =>
    treeScroll.evaluate((element, position) => {
      const scroll = element.shadowRoot!.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]")!

      if (position.left !== undefined) scroll.scrollLeft = position.left

      if (position.top !== undefined) scroll.scrollTop = position.top

      return { left: scroll.scrollLeft, overflow: scroll.scrollWidth - scroll.clientWidth }
    }, position)

  await scrollTree({ left: 1_000_000 })
  await expect.poll(() => statusInset(status, "right")).toBeLessThanOrEqual(24)
  // The tree keeps the long row's width after it scrolls out of view, so the sideways position holds.
  await scrollTree({ top: 1_000_000 })
  await expect(longRow).toHaveCount(0)
  await expect.poll(async () => (await scrollTree({})).overflow).toBeGreaterThan(0)
  await expect.poll(async () => (await scrollTree({})).left).toBeGreaterThan(0)
  await scrollTree({ left: 0, top: 0 })
  await viewport.evaluate((element) => element.setAttribute("dir", "rtl"))
  await expect.poll(guideOffset).toBeLessThanOrEqual(0.5)
  await expect.poll(() => statusInset(status, "left")).toBeLessThanOrEqual(24)
  await frontend.focus()
  await page.keyboard.press("ArrowRight")
  await expect(frontend).toHaveAttribute("aria-expanded", "false")
  await page.keyboard.press("ArrowLeft")
  await expect(frontend).toHaveAttribute("aria-expanded", "true")
  await viewport.evaluate((element) => element.removeAttribute("dir"))

  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await filter.fill(longFilename)
  const filteredOption = panel.getByRole("option", { name: longFilename })
  await expect(filteredOption.locator('svg[data-icon-token="typescript"]')).toBeVisible()
  const filteredStatus = filteredOption.locator('[data-slot="file-tree-v2-change"]')
  await expect(filteredStatus).toHaveText("A")
  await expect.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await expect.poll(() => statusInset(filteredStatus, "right")).toBeLessThanOrEqual(24)
  await viewport.hover()
  await page.mouse.wheel(1_000, 0)
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(() => statusInset(filteredStatus, "right")).toBeLessThanOrEqual(24)
  await viewport.evaluate((element) => {
    element.setAttribute("dir", "rtl")
    element.scrollLeft = -1_000_000
  })
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(0)
  await expect.poll(() => statusInset(filteredStatus, "left")).toBeLessThanOrEqual(24)
  await viewport.evaluate((element) => {
    element.removeAttribute("dir")
    element.scrollLeft = 0
  })

  await filter.fill("")
  await panel.locator('[data-type="item"][data-item-path="frontend/app.ts"]').click()
  await expect(panel.getByRole("tab", { name: "app.ts" })).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:frontend/app.ts", { exact: true })).toBeVisible()
})

test("rereads a file each time an artifact link opens it", async ({ page }) => {
  // Enough lines to scroll the code view, ending in the draft's name.
  const draft = (name: string) => [...Array.from({ length: 200 }, (_, index) => `item ${index + 1}`), name].join("\n")
  const file = { content: draft("first draft") }

  const messages = [
    { id: "msg_prompt", type: "user", text: "Write the shopping list", time: { created: 1 } },
    {
      id: "msg_reply",
      type: "assistant",
      agent: "build",
      model: { id: "test", providerID: "opencode" },
      content: [{ type: "text", text: "Updated [shopping.txt](shopping.txt)." }],
      time: { created: 2, completed: 3 },
    },
  ] satisfies SessionMessageInfo[]

  await openSession(page, {
    name: "ArtifactReopen",
    fileList: () => [],
    fileContent: (path) => (path === "shopping.txt" ? file : ""),
    pageMessages: () => ({ items: messages }),
  })

  const link = page.getByRole("link", { name: "shopping.txt", exact: true })
  const panel = page.locator("#review-panel")
  const tab = panel.getByRole("tab", { name: "shopping.txt" })
  const code = panel.locator("[data-scrollable]", { has: page.locator('[data-component="file"]') })

  // A long file mounts only the rows near the viewport, so its last line needs a scroll. A reopened tab may restore its
  // earlier scroll position, so this starts from wherever the view is once its rows overflow.
  const scrollToEnd = async () => {
    await expect.poll(() => code.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
    await code.hover()
    await page.mouse.wheel(0, 100_000)
    await expect
      .poll(() => code.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(1)
  }

  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  // The first open starts at the top.
  await expect(panel.getByText("item 1", { exact: true })).toBeVisible()
  await scrollToEnd()
  await expect(panel.getByText("first draft", { exact: true })).toBeVisible()

  // Rereading the open file updates it in place: the code view keeps its node and never jumps back to the top.
  const scrolled = await code.evaluate((element) => element.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await code.evaluate((element) => void (element.dataset.e2eProbe = "original"))
  file.content = draft("second draft")
  await link.click()
  await expect(panel.getByText("second draft", { exact: true })).toBeVisible()
  expect(await code.evaluate((element) => element.dataset.e2eProbe)).toBe("original")
  expect(await code.evaluate((element) => element.scrollTop)).toBe(scrolled)

  file.content = draft("third draft")
  await tab.locator("..").getByRole("button", { name: "Close tab" }).click()
  await expect(tab).toHaveCount(0)
  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await scrollToEnd()
  await expect(panel.getByText("third draft", { exact: true })).toBeVisible()
  await expect(panel.getByText("second draft", { exact: true })).toHaveCount(0)

  // A restored file tab whose file was deleted shows its inline not-found state without a toast; clicking a broken link
  // when no tab is open for it shows the toast.
  await page.route("**/api/fs/read/shopping.txt*", (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
      // SAFETY: the server's wire body for a missing file, which the client decodes into its own error.
      // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- see SAFETY above
      json: { _tag: "FileNotFoundError", path: "shopping.txt", message: "File not found: shopping.txt" },
    }),
  )
  await page.reload()
  const missingTab = panel.getByRole("tab", { name: "File not found: shopping.txt", exact: true })
  await expect(missingTab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("File not found: shopping.txt", { exact: true })).toBeVisible()
  await expect(page.getByText("Failed to load file", { exact: true })).toHaveCount(0)

  await missingTab.locator("..").getByRole("button", { name: "Close tab" }).click()
  await expect(missingTab).toHaveCount(0)
  await link.click()
  await expect(page.getByText("Failed to load file", { exact: true })).toBeVisible()
  await expect(missingTab).toHaveCount(0)
})

test("artifact actions copy and download content, switch source, and follow the selected file's capabilities", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80"/></svg>'
  const table = 'name,role\n"Jensen, Oliver",Researcher\nIsabella,Support'

  const workspace = await openSession(page, {
    name: "ArtifactActions",
    fileList: () => [],
    fileContent: (path) => {
      if (path === "vector.svg") return { content: source }

      if (path === "data.csv") return { content: table }

      if (path === "notes.md") return { content: "# Notes\n\nA document with a visible top edge." }

      return { type: "binary", content: "AAEC", encoding: "base64" }
    },
    pageMessages: () => ({
      items: [
        {
          id: "msg_artifact_actions",
          type: "assistant",
          agent: "build",
          model: { id: "test", providerID: "opencode" },
          content: [
            { type: "text", text: "[Vector](vector.svg) [Table](data.csv) [Notes](notes.md) [Binary](sample.bin)" },
          ],
          time: { created: 1, completed: 2 },
        },
      ],
    }),
  })

  await page.getByRole("link", { name: "Vector", exact: true }).click()
  const panel = page.locator("#review-panel")
  const toolbar = panel.locator('[data-slot="artifact-toolbar"]:visible')
  const actions = toolbar.getByRole("button", { name: "File actions", exact: true })
  const image = panel.getByRole("img", { name: "vector.svg", exact: true })
  await expect(image).toHaveJSProperty("naturalWidth", 120)
  await expect(toolbar.getByText("vector.svg", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Toggle file tree", exact: true }).click()

  // The source action stays visible at rest; only metadata needs hover or keyboard focus.
  await page.mouse.move(0, 0)
  const sourceAction = toolbar.getByRole("button", { name: "View source", exact: true })
  await expect(sourceAction).toHaveCSS("opacity", "1")
  await expect(toolbar.locator('[data-slot="artifact-metadata"]')).toHaveCSS("opacity", "0")
  await actions.focus()
  await expect(toolbar.locator('[data-slot="artifact-metadata"]')).toHaveCSS("opacity", "1")
  await expect(toolbar.getByText("120 × 80", { exact: true })).toBeVisible()
  const copy = toolbar.getByRole("button", { name: "Copy content", exact: true })
  await copy.click()
  await expect(page.getByText("Copied", { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
  await page.getByRole("button", { name: "Dismiss", exact: true }).click()

  await sourceAction.click()
  await expect(image).toHaveCount(0)
  await expect(panel.locator("diffs-container")).toContainText(source)
  await actions.click()
  await expect(page.getByRole("menuitem", { name: "View preview", exact: true })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Open in", exact: true })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "View preview", exact: true }).click()
  await expect(image).toHaveJSProperty("naturalWidth", 120)

  await page.getByRole("link", { name: "Table", exact: true }).click()
  await expect(panel.getByRole("columnheader", { name: /^name(?:\s|$)/ })).toHaveCSS(
    "background-color",
    "rgb(242, 242, 242)",
  )
  const nameCell = panel.getByRole("cell", { name: /^Jensen, Oliver(?:\s|$)/ })
  await expect(nameCell).toBeVisible()
  await expect(toolbar.getByText("data.csv", { exact: true })).toBeVisible()
  await nameCell.hover()
  await nameCell.getByRole("button", { name: "Copy cell", exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Jensen, Oliver")
  await toolbar.hover()
  await expect(nameCell.getByRole("button", { name: "Copy cell", exact: true })).toHaveCSS("opacity", "0")
  await page.keyboard.press("Tab")

  const nextCopy = panel
    .getByRole("cell", { name: /^Researcher(?:\s|$)/ })
    .getByRole("button", { name: "Copy cell", exact: true })

  await expect(nextCopy).toBeFocused()
  await expect(nextCopy).toHaveCSS("opacity", "1")

  const copyHeader = panel
    .getByRole("columnheader", { name: /^role(?:\s|$)/ })
    .getByRole("button", { name: "Copy cell", exact: true })

  await copyHeader.focus()
  await copyHeader.press("Enter")
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("role")
  await actions.click()
  const downloaded = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Download", exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe("data.csv")
  expect(await readFile((await download.path())!, "utf8")).toBe(table)

  await page.getByRole("link", { name: "Notes", exact: true }).click()
  await expect(panel.getByRole("heading", { name: "Notes", exact: true })).toBeVisible()
  const paper = panel.locator('[data-slot="artifact-markdown-page"]')
  await expect(paper).toHaveCSS("border-radius", "8px")
  await expect(paper).toHaveAttribute("data-component", "document-surface")
  expect(await paper.evaluate((element) => getComputedStyle(element, "::after").borderTopStyle)).toBe("solid")
  const surface = (await paper.boundingBox())!
  const bar = (await toolbar.boundingBox())!
  expect(surface.y - bar.y - bar.height).toBe(1)
  await expect(panel.getByRole("group", { name: "Preview controls", exact: true })).toHaveCount(0)

  await page.getByRole("link", { name: "Binary", exact: true }).click()
  await expect(panel.getByText(/Binary file/)).toBeVisible()
  await expect(toolbar.getByText("sample.bin", { exact: true })).toBeVisible()
  await expect(copy).toHaveCount(0)
  await expect(toolbar.getByRole("button", { name: "View source", exact: true })).toHaveCount(0)
  await actions.click()
  await expect(page.getByRole("menuitem", { name: "Download", exact: true })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "Copy path", exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${workspace.directory}/sample.bin`)
})

test("Markdown and DOCX sheets stay aligned when switching at wide and narrow preview widths", async ({ page }) => {
  // Minimal DOCX containing one paragraph, "Document spacing", and a letter-sized page.
  const docx =
    "UEsDBBQAAAAIAI51W13mdcR+0gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvVLDMAzHX8XnlasVGBh6SToAKzD0BXSOkvjw11luad++Sls6cIVR+n/8ZLebQ/BqT4Vdip1+NI3e9O32mImVKJE7Pdea1wBsZwrIJmWKooypBKwylgky2i+cCJ6a5hlsipViXdWlQ/ftK42481W9HWR9oRTyrNXLxbiwOo05e2exig77OPyirK4EI8mzh2eX+UEMGu4SFuVvwDX3Ic8ubiD1iaW+YxAXfKcywJDsLkjS/F9z5840js7SLb+05ZIsMbs4BW9uSkAXf+6H83f3J1BLAwQUAAAACACOdVtdXzOVUpUAAAAHAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0Q+QJ0yMKCmXVi6Ii4QJW5T0TzkhNftycBAEQOjf//6LHfDw6/iRpyXGBS0jYSh70606lKD7JaURW2ErMCVkg6I2TjyOjcxUaibKbLXpY48Y9LmomfCnZR75E8DtqYYrQIebQvi/Ez0jx2naTF0jObqKZQfJ74aVdY8U1Fwj2zRvuOmsoB9h5sX+xdQSwMEFAAAAAgAjnVbXUye0X++AAAAMQEAABEAAAB3b3JkL2RvY3VtZW50LnhtbEVQ0Q6CMAz8FbIPsEjUGILw4quJiV8wxwQSti5dFfXr7TCEl9v1ru01q5q3G7OXpTigP6ntJldNXU1li+bprOdMbB/L6aR65lACRNNbp+MGg/XiPZCcZimpgwmpDYTGxjj4zo1Q5PkBnB68Sivv2H7SGxJQAq7PS0wM2shQBUlNSDPOvdEavs4Dobt9syldsy2KXa6E98L3R+Hwb7hoEpUxiL77t9DQ9byWd2RGt9ajfSwuzKFLHiw3w/of9Q9QSwECFAMUAAAACACOdVtd5nXEftIAAACLAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAI51W11fM5VSlQAAAAcBAAALAAAAAAAAAAAAAACAAQMBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAI51W11MntF/vgAAADEBAAARAAAAAAAAAAAAAACAAcEBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAACuAgAAAAA="

  await page.setViewportSize({ width: 1728, height: 900 })
  await openSession(page, {
    name: "DocumentAlignment",
    fileList: () => [],
    fileContent: (path) =>
      path === "notes.md"
        ? { type: "text", content: "# Document spacing\n\nA Markdown sheet beside an Office document." }
        : {
            type: "binary",
            content: docx,
            encoding: "base64",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
    pageMessages: () => ({
      items: [
        {
          id: "msg_document_alignment",
          type: "assistant",
          agent: "build",
          model: { id: "test", providerID: "opencode" },
          content: [{ type: "text", text: "[Markdown](notes.md) [Word](sample.docx) [Second Word](other.docx)" }],
          time: { created: 1, completed: 2 },
        },
      ],
    }),
    seed: { storage: { "opencode.global.dat:review-panel-v2": { sidebarOpened: false } } },
  })

  const panel = page.locator("#review-panel")
  const toolbar = panel.locator('[data-slot="artifact-toolbar"]:visible')
  const markdown = panel.locator('[data-slot="artifact-markdown-page"]')
  const word = panel.getByRole("group", { name: "Page 1", exact: true })

  const edges = (sheet: Locator) =>
    sheet.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const scrollport = element.closest("[data-document-surface-scrollport]")!

      return { left: rect.left, right: rect.right, inset: rect.left - scrollport.getBoundingClientRect().left }
    })

  await page.getByRole("link", { name: "Markdown", exact: true }).click()
  await page.getByRole("link", { name: "Word", exact: true }).click()
  await expect(toolbar.getByText("sample.docx", { exact: true })).toBeVisible()
  // The real Office engine may need a cold WASM initialization before its text layer is ready.
  await expect(word.getByText("Document spacing", { exact: true })).toBeVisible({ timeout: 30_000 })
  await word.evaluate((element) => {
    element.dataset.e2eProbe = "warm"
  })
  const canvas = await word.locator("canvas").elementHandle()
  expect(canvas).not.toBeNull()
  await expect.poll(() => canvas!.evaluate((element) => Number(element.getAttribute("width")))).toBeGreaterThan(0)
  await page.getByRole("link", { name: "Second Word", exact: true }).click()
  await expect(toolbar.getByText("other.docx", { exact: true })).toBeVisible()
  await expect(word.getByText("Document spacing", { exact: true })).toBeVisible({ timeout: 30_000 })
  await word.evaluate((element) => {
    element.dataset.e2eProbe = "other-warm"
  })

  for (const size of [
    { width: 1728, gutter: 20 },
    { width: 1000, gutter: 12 },
  ]) {
    await page.setViewportSize({ width: size.width, height: 900 })
    await panel.getByRole("tab", { name: "notes.md", exact: true }).click()
    await expect(markdown.getByRole("heading", { name: "Document spacing", exact: true })).toBeVisible()
    await toolbar.hover()
    await expect.poll(async () => (await edges(markdown)).inset).toBeCloseTo(size.gutter, 1)
    const reference = await edges(markdown)
    const header = await toolbar.boundingBox()

    await panel.getByRole("tab", { name: "sample.docx", exact: true }).click()
    await expect(word).toHaveAttribute("data-e2e-probe", "warm")
    await expect(word.getByText("Document spacing", { exact: true })).toBeVisible()
    await expect
      .poll(() => edges(word))
      .toEqual({
        left: expect.closeTo(reference.left, 1),
        right: expect.closeTo(reference.right, 1),
        inset: expect.closeTo(size.gutter, 1),
      })
    await expect.poll(() => toolbar.boundingBox()).toEqual(header)

    await panel.getByRole("tab", { name: "notes.md", exact: true }).click()
    await expect(markdown.getByRole("heading", { name: "Document spacing", exact: true })).toBeVisible()
    await expect.poll(() => edges(markdown)).toEqual(reference)
    await expect.poll(() => toolbar.boundingBox()).toEqual(header)
    expect(await canvas!.evaluate((element) => element.isConnected && Number(element.getAttribute("width")) > 0)).toBe(true)
    await panel.getByRole("tab", { name: "other.docx", exact: true }).click()
    await expect(word).toHaveAttribute("data-e2e-probe", "other-warm")
    await panel.getByRole("tab", { name: "notes.md", exact: true }).click()
  }

  await panel
    .getByRole("tab", { name: "sample.docx", exact: true })
    .locator("..")
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect.poll(() => canvas!.evaluate((element) => element.isConnected)).toBe(false)
})

test("diagram preview controls zoom the rendered diagram and fit it back into its pane", async ({ page }) => {
  await openSession(page, {
    name: "DiagramZoom",
    fileList: () => [],
    fileContent: () => ({ content: "flowchart LR\n Start[Start] --> Review[Review] --> Finish[Finish]" }),
    pageMessages: () => ({
      items: [
        {
          id: "msg_diagram_zoom",
          type: "assistant",
          agent: "build",
          model: { id: "test", providerID: "opencode" },
          content: [{ type: "text", text: "[Diagram](flow.mmd)" }],
          time: { created: 1, completed: 2 },
        },
      ],
    }),
  })
  await page.getByRole("link", { name: "Diagram", exact: true }).click()
  const panel = page.locator("#review-panel")
  const diagram = panel.locator('[data-component="markdown-mermaid"] > svg')
  const controls = panel.getByRole("group", { name: "Preview controls", exact: true })
  const fit = controls.getByRole("button", { name: "Fit", exact: true })
  await expect(panel.getByText("Finish", { exact: true })).toBeVisible()
  await diagram.hover()
  const initial = (await diagram.boundingBox())!

  await expect(fit).toBeEnabled()
  await controls.getByRole("button", { name: "Zoom in", exact: true }).click()
  await expect.poll(async () => (await diagram.boundingBox())!.width).toBeCloseTo(initial.width * 1.25, 1)
  await controls.getByRole("button", { name: "Zoom out", exact: true }).click()
  await expect.poll(async () => (await diagram.boundingBox())!.width).toBeCloseTo(initial.width, 1)
  await controls.getByRole("button", { name: "Zoom out", exact: true }).click()
  await expect.poll(async () => (await diagram.boundingBox())!.width).toBeCloseTo(initial.width / 1.25, 1)
  await fit.click()
  await expect.poll(() => diagram.boundingBox()).toEqual(initial)
})

/** What the image case's frame probe records on the window. */
type ImageProbe = { problems: string[]; frames: number; running: boolean }

test("image gestures anchor zoom, pan, and reset independently of the pane", async ({ page }) => {
  // Some browsers expose no natural dimensions for a viewBox-only SVG.
  await page.addInitScript(() => {
    for (const name of ["naturalWidth", "naturalHeight"]) {
      const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, name)!
      Object.defineProperty(HTMLImageElement.prototype, name, {
        ...original,
        get() {
          return this.alt === "second.svg" ? 0 : original.get?.call(this)
        },
      })
    }
  })
  await openSession(page, {
    name: "ImageGestures",
    fileList: () => [],
    fileContent: (path) => {
      if (path === "small.svg")
        return {
          content:
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#6699aa"/></svg>',
        }

      return {
        content:
          path === "second.svg"
            ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1600"><rect width="1600" height="1600" fill="#6699aa"/></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="#6699aa"/></svg>',
      }
    },
    pageMessages: () => ({
      items: [
        {
          id: "msg_images",
          type: "assistant",
          agent: "build",
          model: { id: "test", providerID: "opencode" },
          content: [{ type: "text", text: "[First](first.svg) [Second](second.svg) [Small](small.svg)" }],
          time: { created: 1, completed: 2 },
        },
      ],
    }),
  })
  await page.getByRole("link", { name: "First", exact: true }).click()
  const panel = page.locator("#review-panel")
  const image = panel.getByRole("img", { name: "first.svg", exact: true })
  const stage = panel.locator('[data-slot="artifact-stage"]')
  const fit = panel.getByRole("button", { name: "Fit", exact: true })
  await expect(image).toBeVisible()
  await expect(fit).toBeEnabled()
  // Wait for the side pane's opening motion before choosing a gesture anchor.
  await image.hover()
  const initial = (await image.boundingBox())!
  const pane = (await panel.boundingBox())!
  await panel.getByRole("button", { name: "Zoom in", exact: true }).click()
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(initial.width * 1.25, 1)
  await panel.getByRole("button", { name: "Zoom out", exact: true }).click()
  await expect.poll(() => image.boundingBox()).toEqual(initial)
  const anchor = { x: Math.round(initial.x + initial.width * 0.55), y: Math.round(initial.y + initial.height * 0.55) }
  await page.mouse.move(anchor.x, anchor.y)
  // A continuous pinch catches anchor drift while the image still fits one axis.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.synthesizePinchGesture", {
    ...anchor,
    scaleFactor: 2,
    relativeSpeed: 500,
    gestureSourceType: "mouse",
  })
  await cdp.detach()
  await expect(stage).toHaveAttribute("data-zoom", "actual")
  const zoomed = (await image.boundingBox())!
  expect(zoomed.width).toBeCloseTo(initial.width * 2, 1)
  expect((anchor.x - zoomed.x) / zoomed.width).toBeCloseTo((anchor.x - initial.x) / initial.width, 4)
  expect((anchor.y - zoomed.y) / zoomed.height).toBeCloseTo((anchor.y - initial.y) / initial.height, 4)
  expect(await panel.boundingBox()).toEqual(pane)
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1)
  await page.mouse.wheel(40, 60)
  await expect.poll(async () => (await image.boundingBox())!.x).toBeCloseTo(zoomed.x - 40, 1)
  expect((await image.boundingBox())!.y).toBeCloseTo(zoomed.y - 60, 1)
  const scrolled = (await image.boundingBox())!
  await page.mouse.down()
  await page.mouse.move(anchor.x + 60, anchor.y + 40, { steps: 5 })
  await page.mouse.up()
  await expect(stage).toHaveAttribute("data-zoom", "actual")
  expect((await image.boundingBox())!.x).toBeCloseTo(scrolled.x + 60, 1)
  expect((await image.boundingBox())!.y).toBeCloseTo(scrolled.y + 40, 1)
  // Touch uses the same captured-pointer path and must not generate a click-to-fit.
  const touch = await page.context().newCDPSession(page)
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: anchor.x, y: anchor.y }] })
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: anchor.x - 30, y: anchor.y - 20 }],
  })
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await touch.detach()
  await expect(stage).toHaveAttribute("data-zoom", "actual")
  expect((await image.boundingBox())!.x).toBeCloseTo(scrolled.x + 30, 1)
  expect((await image.boundingBox())!.y).toBeCloseTo(scrolled.y + 20, 1)
  // Keyboard-accessible fit restores the exact original geometry.
  await fit.focus()
  await page.keyboard.press("Enter")
  await expect(stage).toHaveAttribute("data-zoom", "fit")
  expect(await image.boundingBox()).toEqual(initial)
  expect(
    await stage.evaluate((element) =>
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true })),
    ),
  ).toBe(true)
  await image.click()
  await expect(stage).toHaveAttribute("data-zoom", "actual")
  await page.getByRole("link", { name: "Second", exact: true }).click()
  await expect(panel.getByRole("img", { name: "second.svg", exact: true })).toBeVisible()
  await expect(stage).toHaveAttribute("data-zoom", "fit")
  await panel.getByRole("img", { name: "second.svg", exact: true }).hover()
  const second = (await panel.getByRole("img", { name: "second.svg", exact: true }).boundingBox())!
  expect(second.width).toBeGreaterThan(0)
  expect(second.height).toBeGreaterThan(0)
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -50)
  await expect(stage).toHaveAttribute("data-zoom", "actual")
  await page.keyboard.up("Control")
  await fit.click()
  await page.setViewportSize({ width: 1200, height: 700 })
  await expect
    .poll(async () => {
      const frame = (await stage.boundingBox())!
      const media = (await panel.getByRole("img", { name: "second.svg", exact: true }).boundingBox())!

      return media.width <= frame.width - 47 && media.height <= frame.height - 47
    })
    .toBe(true)
  await page.getByRole("link", { name: "Small", exact: true }).click()
  const small = panel.getByRole("img", { name: "small.svg", exact: true })
  await expect(small).toHaveJSProperty("naturalWidth", 32)
  await small.click()
  await expect.poll(async () => (await small.boundingBox())!.width).toBeCloseTo(32, 1)
  await expect(panel.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled()
  await fit.click()
  await expect.poll(async () => (await small.boundingBox())!.width).toBeGreaterThan(128)
})

test("image files load into the review panel and keep it painted while loading", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 })
  const directory = "C:/OpenCode/ReviewImage"
  const image = "assets/preview.png"
  const read = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await openSession(page, {
    name: "ReviewImage",
    vcsDiff: [fileDiff("src/example.ts"), { file: image, patch: "", additions: 1, deletions: 0, status: "added" }],
    fileContent: async (path) => {
      if (path !== image) return undefined
      read.resolve()
      await release.promise

      // A 1x1 PNG.
      return {
        type: "binary",
        content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        encoding: "base64",
        mimeType: "image/png",
      }
    },
    fileList: (path) => {
      if (!path) return [fileNode(directory, "assets", "directory"), fileNode(directory, "src", "directory")]

      if (path === "assets") return [fileNode(directory, image)]

      if (path === "src") return [fileNode(directory, "src/example.ts")]

      return []
    },
  })
  await page.getByRole("button", { name: "Toggle review" }).click()
  await openReviewLauncher(page.locator("#review-panel"))
  await expect(page.locator('#review-panel [data-component="session-review-v2"]')).toBeVisible()

  // Records every painted frame from before the click until after the image read completes.
  await page.evaluate(() => {
    const probe: ImageProbe = { problems: [], frames: 0, running: true }

    const sample = () => {
      const panel = document.querySelector<HTMLElement>('#review-panel [data-component="session-review-v2"]')
      const rect = panel?.getBoundingClientRect()

      const hit =
        rect?.width && rect.height ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null

      const frame = [
        !panel?.checkVisibility() && "hidden",
        !panel?.textContent?.trim() && "blank",
        !(hit && document.querySelector("#review-panel")?.contains(hit)) && "outside the review panel",
        hit && getComputedStyle(hit).backgroundColor === "rgb(0, 0, 0)" && "black",
      ].filter((problem) => problem !== false && problem !== null)

      probe.problems.push(...frame)
      probe.frames += 1

      if (probe.running) requestAnimationFrame(sample)
    }

    // The evaluates below read it.
    Object.assign(window, { e2eImageProbe: probe })
    requestAnimationFrame(sample)
  })

  const frames = () =>
    // SAFETY: the evaluate above stored the probe on the window before any frame is counted.
    page.evaluate(() => (window as Window & { e2eImageProbe?: ImageProbe }).e2eImageProbe!.frames)

  const response = page.waitForResponse((item) => item.url().includes(`/api/fs/read/${image}`))
  await page.getByRole("treeitem", { name: /preview\.png/ }).click()
  await read.promise
  const pending = await frames()
  await expect.poll(frames).toBeGreaterThan(pending)
  release.resolve()
  await response
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("preview.png")
  await expect(page.locator("#review-panel").getByRole("img", { name: image, exact: true })).toHaveJSProperty(
    "naturalWidth",
    1,
  )
  const loaded = await frames()
  await expect.poll(frames).toBeGreaterThan(loaded)
  expect(
    await page.evaluate(() => {
      // SAFETY: the evaluate above stored the probe on the window.
      const probe = (window as Window & { e2eImageProbe?: ImageProbe }).e2eImageProbe!
      probe.running = false

      return probe.problems
    }),
  ).toEqual([])
})

test("video files stream into the viewer behind a loading state, open into the preview, and come back on Escape without remounting", async ({
  page,
}) => {
  const directory = "C:/OpenCode/ReviewVideo"
  const file = "arcade-update-draft.mp4"

  const head = Buffer.from(
    "AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAAAMm1kYXSCSYNCAAPwAjYAOCQcGEIAADBgAABYS///mpmB/////7FMC////+OkgAAAAAL+bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAil0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAkAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAGhbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABTG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAQxzdGJsAAAAqHN0c2QAAAAAAAAAAQAAAJh2cDA5AAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAJABIAAAASAAAAAAAAAABF0xhdmM2My4xLjEwMiBsaWJ2cHgtdnA5AAAAAAAAAAAAGP//AAAAFHZwY0MBAAAAAAqCAgICAAAAAAAKZmllbAEAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAJxAAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAEAAEAAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAACoAAAABAAAAFHN0Y28AAAAAAAAAAQAAACwAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAy",
    "base64",
  )

  const mp4 = Buffer.alloc(38_400_000)

  head.copy(mp4)
  mp4.writeUInt32BE(mp4.length - head.length, head.length)
  mp4.write("free", head.length + 4, "ascii")

  await openSession(page, {
    name: "ReviewVideo",
    fileList: (path) => (path ? [] : [fileNode(directory, file)]),
    seed: {
      panes: { ses_reviewvideo: { review: true } },
    },
  })
  // The app only checks the file with a HEAD; the video element streams it with range requests, held until released.
  const ranged = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(`**/api/fs/read/${file}*`, async (route) => {
    const headers = { "access-control-allow-origin": "*", "accept-ranges": "bytes", "content-type": "video/mp4" }

    if (route.request().method() === "HEAD")
      return route.fulfill({ status: 200, headers: { ...headers, "content-length": String(mp4.length) } })

    const range = /^bytes=(\d+)-(\d*)$/.exec((await route.request().headerValue("range")) ?? "")

    if (!range) return route.fulfill({ status: 200, headers, body: mp4 })
    ranged.resolve()
    await release.promise
    const start = Number(range[1])
    const end = Math.min(range[2] ? Number(range[2]) : mp4.length - 1, start + 4_000_000, mp4.length - 1)

    return route.fulfill({
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${mp4.length}` },
      body: mp4.subarray(start, end + 1),
    })
  })

  const panel = page.locator("#review-panel")
  await openFileLauncher(panel)
  await panel.getByRole("treeitem", { name: file }).click()
  await expect(panel.getByRole("tab", { name: file, exact: true })).toHaveAttribute("aria-selected", "true")

  const toolbar = panel.locator('[data-slot="artifact-toolbar"]')
  const stage = panel.locator('[data-slot="artifact-stage"]')
  const video = stage.locator('video[data-slot="artifact-media"]')
  const fullscreen = stage.getByRole("button", { name: "Enter full screen", exact: true })
  const preview = page.locator('[data-component="image-preview"]')
  const loading = stage.getByRole("status", { name: "Loading", exact: true })

  await ranged.promise
  await expect(loading).toBeVisible()
  expect(await video.getAttribute("src")).toMatch(new RegExp(`^${SERVER}/api/fs/read/${file}\\?`))
  release.resolve()
  await expect(loading).toHaveCount(0)
  await expect(video).toBeVisible()
  await expect(toolbar).toContainText("64 × 36")
  await expect(toolbar).toContainText("0:01")
  await expect(toolbar).toContainText("38.4 MB")
  await expect(panel.getByText(/Binary file/)).toHaveCount(0)
  const inlineBounds = (await stage.boundingBox())!
  expect(inlineBounds.width).toBeLessThan(1000)

  await video.evaluate((element) => {
    element.dataset.e2eProbe = "retained"
  })

  // The preview borrows the same element, so playback never restarts.
  await fullscreen.click()
  await expect(preview).toHaveAttribute("data-stage", "rest")
  await expect(preview.locator('video[data-e2e-probe="retained"]')).toBeVisible()
  await expect(video).toHaveCount(0)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()

  await page.keyboard.press("Escape")
  await expect(preview).toHaveCount(0)
  await expect(video).toHaveAttribute("data-e2e-probe", "retained")
  await expect.poll(() => stage.boundingBox()).toEqual(inlineBounds)

  await video.dblclick()
  await expect(preview).toHaveAttribute("data-stage", "rest")
  await page.mouse.click(8, 8)
  await expect(preview).toHaveCount(0)
  await expect(video).toHaveAttribute("data-e2e-probe", "retained")

  // Chromium's controls also answer a double click with native fullscreen, which covers the backdrop. Opting out with
  // controlslist="nofullscreen" would end their click-to-play as well.
  await video.click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
})

test("review file navigation focuses the arrow for the keyboard direction", async ({ page }) => {
  await openSession(page, {
    name: "ReviewArrowFocus",
    vcsDiff: [fileDiff("src/alpha.ts"), fileDiff("src/beta.ts"), fileDiff("src/gamma.ts")],
    seed: {
      panes: { ses_reviewarrowfocus: { review: true } },
      storage: {
        ...reviewTabs("C:/OpenCode/ReviewArrowFocus", "ses_reviewarrowfocus"),
        "opencode.global.dat:review-panel-v2": { sidebarOpened: false },
      },
    },
  })

  const panel = page.locator("#review-panel")
  const file = panel.locator('[data-slot="session-review-v2-file-name"]')
  const previous = panel.getByRole("button", { name: "Previous file", exact: true })
  const next = panel.getByRole("button", { name: "Next file", exact: true })

  await expect(file).toHaveText("alpha.ts")
  await previous.click()
  await expect(file).toHaveText("gamma.ts")
  await page.keyboard.press("ArrowRight")
  await expect(file).toHaveText("alpha.ts")
  await expect(next).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(file).toHaveText("beta.ts")
  await page.keyboard.press("ArrowLeft")
  await expect(file).toHaveText("alpha.ts")
  await expect(previous).toBeFocused()
  await next.click()
  await expect(file).toHaveText("beta.ts")
  await expect(next).toBeFocused()

  const home = page.getByRole("button", { name: "Home", exact: true })
  await home.focus()
  await page.keyboard.press("ArrowRight")
  await expect(file).toHaveText("gamma.ts")
  await expect(home).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(file).toHaveText("beta.ts")
  await expect(home).toBeFocused()
})

test("restores review state and the side-panel tab per session", async ({ page }) => {
  const sessions = [
    { id: "ses_review_state_a", title: "Alpha review state" },
    { id: "ses_review_state_b", title: "Beta review state" },
    { id: "ses_review_state_c", title: "Gamma review state" },
  ]

  const directory = "C:/OpenCode/ReviewState"
  await openSession(page, {
    name: "ReviewState",
    sessions,
    vcs: { current: "feature", default: "dev" },
    vcsDiff: ({ mode }) =>
      mode === "branch"
        ? [fileDiff("src/alpha.ts"), fileDiff("src/beta.ts")]
        : [fileDiff("src/alpha.ts"), fileDiff("src/gamma.ts")],
    fileList: () => [fileNode(directory, "README.md")],
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
  })
  const panel = page.locator("#review-panel")
  const review = panel.locator("#session-side-panel-review-tab")
  const toggle = page.getByRole("button", { name: "Toggle review" })

  const selectedTab = (name: string) =>
    expect(panel.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true")

  const selectedFile = (file: string) =>
    expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText(file)

  const switchSession = async (title: string) => {
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
  }

  // Each session selects a file other than the first, which the review would show without a stored selection.
  await toggle.click()
  await openReviewLauncher(panel)
  await page.getByRole("treeitem", { name: "gamma.ts" }).click()
  await selectedFile("gamma.ts")
  await openFileLauncher(panel)
  await panel.getByRole("treeitem", { name: "README.md" }).click()
  await selectedTab("README.md")

  await switchSession("Beta review state")
  await toggle.click()
  await openReviewLauncher(panel)
  await expect(review).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await page.getByRole("treeitem", { name: "beta.ts" }).click()
  await selectedFile("beta.ts")
  await page.getByRole("button", { name: "Toggle session context" }).click()
  await selectedTab("Context")

  await switchSession("Gamma review state")
  await toggle.click()
  await openFileLauncher(panel)
  await selectedTab("Open file")

  await switchSession("Alpha review state")
  await selectedTab("README.md")
  await review.click()
  await selectedFile("gamma.ts")
  await panel.getByRole("tab", { name: "README.md", exact: true }).click()
  await switchSession("Beta review state")
  await selectedTab("Context")
  await switchSession("Gamma review state")
  await selectedTab("Open file")

  await page.reload()
  await expectSessionTitle(page, "Gamma review state")
  await selectedTab("Open file")
  await switchSession("Beta review state")
  await selectedTab("Context")
  await review.click()
  await expect(page.getByRole("button", { name: "Branch changes" })).toBeVisible()
  await selectedFile("beta.ts")
  await switchSession("Alpha review state")
  await selectedTab("README.md")
  await panel.getByRole("tab", { name: "README.md", exact: true }).press("Home")
  await expect(review).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("button", { name: "Git changes" })).toBeVisible()
  await selectedFile("gamma.ts")
  await review.press("End")
  await selectedTab("README.md")

  // A hidden side-panel tab does not claim Close Tab while the side region is collapsed.
  await toggle.click()
  await expect(panel).toBeHidden()
  await page.keyboard.press("Control+w")
  await expect(page.locator("[data-titlebar-tab-slot]", { hasText: "Alpha review state" })).toHaveCount(0)
  await expectSessionTitle(page, "Beta review state")
  await page.keyboard.press("Control+Shift+T")
  await expectSessionTitle(page, "Alpha review state")
  await toggle.click()
  await selectedTab("README.md")

  // Opening moves focus into the side panel once its motion lands; from there Close Tab closes the side tab.
  await expect(panel).toBeFocused()
  await page.keyboard.press("Control+w")
  await expect(panel.getByRole("tab", { name: "README.md", exact: true })).toHaveCount(0)
  await expect(review).toHaveAttribute("aria-selected", "true")
  await expectSessionTitle(page, "Alpha review state")
})

test("shows and restores last turn changes from the session diff", async ({ page }) => {
  const sessionID = "ses_reviewturn"
  await openSession(page, { name: "ReviewTurn", vcsDiff: [fileDiff("src/alpha.ts")] })
  await page.route(`**/api/session/${sessionID}/diff**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [fileDiff("src/delta.ts")] }),
    }),
  )
  const panel = page.locator("#review-panel")
  await page.getByRole("button", { name: "Toggle review" }).click()
  await openReviewLauncher(panel)
  await page.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Last turn changes" }).click()
  await expect(page.getByRole("button", { name: "Last turn changes" })).toBeVisible()
  await expect(panel.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("delta.ts")

  await page.reload()
  await expectSessionTitle(page, "ReviewTurn")
  await expect(page.getByRole("button", { name: "Last turn changes" })).toBeVisible()
  await expect(panel.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("delta.ts")
})

test("keeps the review state a session stored before plugins", async ({ page }) => {
  const directory = "C:/OpenCode/ReviewLegacy"
  await openSession(page, {
    name: "ReviewLegacy",
    vcs: { current: "feature", default: "dev" },
    vcsDiff: ({ mode }) =>
      mode === "branch" ? [fileDiff("alpha.ts"), fileDiff("beta.ts")] : [fileDiff("alpha.ts"), fileDiff("gamma.ts")],
    seed: {
      storage: {
        "opencode.global.dat:layout": {
          sessionView: {
            [`local\u0000${base64Encode(directory)}/ses_reviewlegacy`]: {
              scroll: {},
              reviewMode: "branch",
              reviewFile: "beta.ts",
              reviewOpen: ["beta.ts"],
            },
          },
        },
      },
    },
  })
  const mode = (name: string) => page.getByRole("button", { name, exact: true })
  const changes = page.getByRole("tablist", { name: "Session view", exact: true }).getByRole("tab", { name: "Changes" })

  const trigger = (file: string) =>
    page
      .locator(`[data-component="session-review"] [data-file="${file}"]`)
      .getByRole("button", { name: file, exact: true })

  await page.getByRole("button", { name: "Toggle review" }).click()
  await openReviewLauncher(page.locator("#review-panel"))
  await expect(mode("Branch changes")).toBeVisible()
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("beta.ts")
  // The narrow review lists every file and expands the ones left open.
  await page.setViewportSize({ width: 390, height: 844 })
  await changes.click()
  await expect(trigger("beta.ts")).toHaveAttribute("aria-expanded", "true")
  await expect(trigger("alpha.ts")).toHaveAttribute("aria-expanded", "false")

  // The copy happens once: a later change survives a reload, although the old state is still stored.
  await mode("Branch changes").click()
  await page.getByRole("option", { name: "Git changes" }).click()
  await expect(trigger("gamma.ts")).toBeVisible()
  await page.reload()
  await changes.click()
  await expect(mode("Git changes")).toBeVisible()
  await expect(trigger("gamma.ts")).toBeVisible()
})

test("desktop review waits for the session's stored mode before it loads changes", async ({ page }) => {
  const directory = "C:/OpenCode/ReviewDesktop"
  const id = "ses_review_desktop"
  const title = "Desktop review"
  await mockOpenCodeServer(page, {
    directory,
    project: project({ id: "proj_review_desktop", directory }),
    provider: provider(),
    sessions: [session({ id, directory, title })],
    pageMessages: () => ({ items: [] }),
    vcs: { current: "feature", default: "dev" },
    vcsDiff: ({ mode }) => (mode === "branch" ? [fileDiff("beta.ts")] : [fileDiff("gamma.ts")]),
  })
  const working: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())

    if (url.pathname.endsWith("/vcs/diff") && url.searchParams.get("mode") === "working") working.push(request.url())
  })

  const desktop = (hold?: string) =>
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({
      server: SERVER,
      mode: "stopped",
      storage: "async",
      path: `/server/${base64Encode("sidecar")}/session/${id}`,
      ...(hold && { hold }),
    })}`

  const mode = (name: string) => page.getByRole("button", { name, exact: true })
  const file = page.locator('[data-slot="session-review-v2-file-name"]')
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })

  await page.goto(desktop())
  await expectSessionTitle(page, title)
  await toggle.click()
  await openReviewLauncher(page.locator("#review-panel"))
  await mode("Git changes").click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await expect(file).toHaveText("beta.ts")
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage).some(
          ([key, value]) => key.includes("plugin.review.session") && value.includes('"branch"'),
        ),
      ),
    )
    .toBe(true)

  // The reopened window's review mounts before its session store has loaded.
  working.length = 0
  await page.goto(desktop("plugin.review.session"))
  await expectSessionTitle(page, title)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("#review-panel").getByText("Loading changes…", { exact: true })).toBeVisible()
  await expect(mode("Git changes")).toHaveCount(0)
  await page.getByRole("button", { name: "Load held storage" }).click()
  await expect(mode("Branch changes")).toBeVisible()
  await expect(file).toHaveText("beta.ts")
  expect(working).toEqual([])
})

test("a chosen mode the session stops offering shows as Git, and comes back when it is offered again", async ({
  page,
}) => {
  // The mock server reads the branches on each request, so a reload sees the session's branch change.
  const vcs = { current: "feature", default: "dev" }
  await openSession(page, {
    name: "ReviewModeBack",
    vcs,
    vcsDiff: ({ mode }) => (mode === "branch" ? [fileDiff("beta.ts")] : [fileDiff("gamma.ts")]),
  })
  const mode = (name: string) => page.getByRole("button", { name, exact: true })
  const file = page.locator('[data-slot="session-review-v2-file-name"]')

  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await openReviewLauncher(page.locator("#review-panel"))
  await mode("Git changes").click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await expect(file).toHaveText("beta.ts")

  // Back on the default branch, Branch is not offered.
  vcs.current = "dev"
  await page.reload()
  await expect(mode("Git changes")).toBeVisible()
  await expect(file).toHaveText("gamma.ts")

  vcs.current = "feature"
  await page.reload()
  await expect(mode("Branch changes")).toBeVisible()
  await expect(file).toHaveText("beta.ts")
})

test("names a single change source and keeps the review header rows at 48px", async ({ page }) => {
  // Turn changes are offered only for Git, so another VCS offers one source.
  await openSession(page, { name: "ReviewHeader", project: { vcs: "hg" }, vcsDiff: [fileDiff("src/alpha.ts")] })
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  const panel = page.locator("#review-panel")
  await openReviewLauncher(panel)
  const toggle = panel.getByRole("button", { name: "Toggle file tree" })
  const header = panel.locator('[data-slot="session-review-v2-sidebar-header"]')
  const toolbar = panel.locator('[data-slot="session-review-v2-toolbar"]')

  await expect(header.getByText("Git changes", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Git changes" })).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(header).toHaveCSS("height", "48px")
  await expect(toolbar).toHaveCSS("height", "48px")

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toolbar.getByText("Git changes", { exact: true })).toBeVisible()
  await expect(toolbar).toHaveCSS("height", "48px")

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(header).toHaveCSS("height", "48px")
  await expect(toolbar).toHaveCSS("height", "48px")

  // Closing the last tab closes the side region; it reopens on a New tab view listing its launchers.
  const region = page.getByRole("button", { name: "Toggle review", exact: true })
  await panel.locator("#session-side-panel-review-tab").hover()
  await panel.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(region).toHaveAttribute("aria-expanded", "false")
  await region.click()
  await expect(panel.getByRole("tab")).toHaveCount(1)
  await expect(panel.getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")
  // "+" adds another New tab beside it instead of replacing it.
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(panel.getByRole("tab", { name: "New tab", exact: true })).toHaveCount(2)
  // Only its launchers: "Recently closed" lists files, not the closed Review.
  await expect(panel.getByRole("button", { name: /^Review/ })).toBeVisible()
  await expect(panel.getByRole("region", { name: "Recently closed", exact: true })).toHaveCount(0)
})

test("Review from a new tab keeps the file browser and preview open", async ({ page }) => {
  const directory = "C:/OpenCode/ReviewNewTabFile"
  await openSession(page, {
    name: "ReviewNewTabFile",
    fileList: (path) => (path ? [] : [fileNode(directory, "README.md")]),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { ses_reviewnewtabfile: { review: true } },
      storage: { "opencode.global.dat:review-panel-v2": { sidebarOpened: false } },
    },
  })
  const panel = page.locator("#review-panel")
  const tab = (name: string) => panel.getByRole("tab", { name, exact: true })

  await openFileLauncher(panel)
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(tab("New tab")).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("button", { name: /^Review/ }).click()
  await expect(tab("Review")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "false")
  await tab("Review").hover()
  await panel
    .locator('div[data-value="review:changes"]')
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await tab("Open file").click()
  await panel.getByRole("treeitem", { name: "README.md" }).click()
  await expect(tab("README.md")).toHaveAttribute("aria-selected", "true")

  // Choosing Review also leaves a single-click file preview open beside it.
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(tab("New tab")).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("button", { name: /^Review/ }).click()
  await expect(panel.locator("#session-side-panel-review-tab")).toHaveAttribute("aria-selected", "true")
  await expect(tab("README.md")).toHaveCount(1)
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`review toggle stays at the header edge in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await openSession(page, { name: "ReviewToggle" })
    await page.locator("html").evaluate((element, dir) => element.setAttribute("dir", dir), direction)

    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    const panel = page.locator("#review-panel")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    const closed = (await toggle.boundingBox())!
    const header = (await page.locator("[data-session-title]").boundingBox())!
    expect(closed.y).toBeGreaterThanOrEqual(header.y)
    expect(closed.y + closed.height).toBeLessThanOrEqual(header.y + header.height)

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(panel).toHaveAttribute("aria-hidden", "false")
    await expect(toggle).toHaveCount(1)
    await expect.poll(() => toggle.boundingBox()).toEqual(closed)
    await expect
      .poll(async () => {
        const box = (await panel.boundingBox())!

        return (
          closed.x >= box.x &&
          closed.x + closed.width <= box.x + box.width &&
          closed.y >= box.y &&
          closed.y + closed.height <= box.y + 52
        )
      })
      .toBe(true)

    for (const control of [
      panel.locator('[data-slot="session-side-panel-actions"]'),
      panel.getByRole("button", { name: "Add tab", exact: true }),
    ]) {
      await expect
        .poll(async () => {
          const box = await control.boundingBox()

          return box ? box.y + box.height / 2 : undefined
        })
        .toBe(closed.y + closed.height / 2)
    }

    await toggle.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(toggle).toBeFocused()
    await expect.poll(() => toggle.boundingBox()).toEqual(closed)
    await expect(panel).toBeHidden()

    // The chat's width springs; once the panel settles open, it fills the rest of the row beside the chat.
    for (const opened of [true, false]) {
      await toggle.click()
      await expect(toggle).toHaveAttribute("aria-expanded", String(opened))
      await expect(panel).toHaveAttribute("aria-hidden", String(!opened))

      if (opened) await expect(() => expectHeaderClearOfToggle(page, toggle)).toPass()
    }

    await expect(panel).toBeHidden()
  })
}

async function statusInset(status: Locator, side: "left" | "right") {
  return status.evaluate((element, side) => {
    const root = element.getRootNode()
    const host = root instanceof ShadowRoot ? root.host : element
    const viewport = host.closest<HTMLElement>("[data-scrollable]")!.getBoundingClientRect()
    const box = element.getBoundingClientRect()

    return side === "right" ? viewport.right - box.right : box.left - viewport.left
  }, side)
}

function filesystemEvent(directory: string, file: string, event: "add" | "change" | "unlink"): OpenCodeEvent {
  return {
    id: `evt_${file}_${event}`,
    created: 1,
    type: "filesystem.changed",
    location: { directory },
    data: { file, event },
  }
}

async function expectHeaderClearOfToggle(page: Page, toggle: Locator) {
  const geometry = await page.locator('[data-slot="session-chat-panel"]').evaluate((chat) => {
    const row = chat.parentElement!
    const chatBounds = chat.getBoundingClientRect()
    const panelBounds = document.querySelector("#review-panel")!.getBoundingClientRect()

    return {
      row: row.getBoundingClientRect().width,
      gap:
        getComputedStyle(row).direction === "rtl"
          ? chatBounds.left - panelBounds.right
          : panelBounds.left - chatBounds.right,
      panels: chatBounds.width + panelBounds.width + parseFloat(getComputedStyle(row).columnGap),
    }
  })

  expect(geometry.gap).toBeCloseTo(8, 1)
  expect(Math.abs(geometry.row - geometry.panels)).toBeLessThanOrEqual(1)

  const clip = (await toggle.boundingBox())!
  // Header contents must make no difference to the pixels behind the fixed toggle.
  expect(await page.screenshot({ clip })).toEqual(
    await page.screenshot({ clip, style: ".session-review-v2-tabs-bar { visibility: hidden !important; }" }),
  )
}
