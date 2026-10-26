import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@opencode/util/encode"
import { SERVER, holdRoute, project, provider, session, workspaceKey } from "../utils/app"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fileDiff, fileNode, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

test.use({ viewport: { width: 1440, height: 900 } })

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
    seed: { panes: { ses_init_a: { review: true }, ses_init_b: { review: true } } },
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
    seed: { panes: { ses_init_failure_a: { review: true }, ses_init_failure_b: { review: true } } },
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
  const searches: { query: string; dirs?: string; limit?: number }[] = []
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
      storage: { "opencode.global.dat:review-panel-v2": { sidebarOpened: false } },
    },
  })

  const panel = page.locator("#review-panel")
  const sidebar = panel.locator('[data-slot="session-review-v2-sidebar"]')
  const sidebarToggle = panel.getByRole("button", { name: "Toggle file tree" })
  const contextButton = page.getByRole("button", { name: "Toggle session context" })
  const openFile = panel.getByRole("button", { name: "Open file" })
  const tab = (name: string) => panel.getByRole("tab", { name, exact: true })
  await contextButton.click()
  await expect(tab("Context")).toHaveAttribute("aria-selected", "true")
  await openFile.click()
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await expect(sidebarToggle).toBeDisabled()
  await expect(sidebar).toBeVisible()
  await contextButton.click()
  await expect(tab("Context")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "false")
  await expect(sidebar).toBeHidden()
  await openFile.click()
  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await expect(filter).toBeFocused()
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("ReviewOpenFile", { exact: true })).toBeVisible()

  await panel.getByRole("button", { name: "README.md" }).click()
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

  await openFile.click()
  await expect(tab("README.md")).toHaveCount(0)
  await expect(sidebar).toBeVisible()
  await filter.fill("nested")
  const result = panel.getByRole("option", { name: /nested\.ts/ })
  await expect(result).toBeVisible()
  await expect(filter).toHaveAttribute("aria-activedescendant", (await result.getAttribute("id"))!)
  await filter.press("Enter")
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")
  await expect(sidebarToggle).toBeEnabled()
  await expect(panel.getByText("contents:src/nested.ts", { exact: true })).toBeVisible()
  expect(searches).toContainEqual({ query: "nested", dirs: "file", limit: 200 })

  await openFile.click()
  await expect(tab("nested.ts")).toHaveCount(1)
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await expect(sidebarToggle).toBeDisabled()
  await panel.locator("#session-side-panel-review-tab").click()
  await expect(sidebarToggle).toBeEnabled()
  await tab("Open file").click()
  await page.keyboard.press("Control+w")
  await expect(tab("Open file")).toHaveCount(0)
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")

  // The file browser beside file tabs keeps its DOM and scroll position across preview and pinned tab switches.
  await sidebarToggle.click()
  await filter.fill("")
  const root = panel.locator('[data-component="session-review-v2-sidebar-root"]')
  const viewport = root.locator('[data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await expect(root.getByRole("button", { name: "file-00.ts" })).toBeVisible()
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  const scrolled = await viewport.evaluate((element) => element.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await root.evaluate((element) => void (element.dataset.e2eProbe = "original"))

  const expectSidebarKept = async () => {
    expect(await root.evaluate((element) => element.dataset.e2eProbe)).toBe("original")
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrolled)
  }

  await root.getByRole("button", { name: "file-79.ts" }).click()
  await expect(tab("file-79.ts")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:file-79.ts", { exact: true })).toBeVisible()
  await expectSidebarKept()
  await root.getByRole("button", { name: "file-78.ts" }).dblclick()
  await expect(tab("file-78.ts")).toHaveAttribute("aria-selected", "true")
  await root.getByRole("button", { name: "file-79.ts" }).click()
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
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")
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
      seed: {
        panes: { ses_browserrepo: { review: true } },
        // The user also opened the subfolder as its own sidebar project and renamed it there.
        ...(listed && {
          projects: {
            local: [
              { worktree: root, expanded: true },
              { worktree: directory, expanded: true },
            ],
          },
          storage: { [workspaceKey(directory, "project")]: { value: { name: "Custom app" } } },
        }),
      },
    })
    const panel = page.locator("#review-panel")
    await panel.getByRole("button", { name: "Open file" }).click()
    await expect(panel.getByRole("button", { name: "README.md" })).toBeVisible()
    await expect(panel.locator('[data-slot="session-review-v2-sidebar-title"]')).toHaveText(
      listed ? "Custom app" : "app",
    )
  })
}

test("context closes the side region only when its button opened it", async ({ page }) => {
  // A /btw tab saved before extensions must not linger as a hidden tab that keeps the region open.
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

  // Reopening the region by hand makes it the user's, so closing Context leaves Review open.
  await contextButton.click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(context).toHaveAttribute("aria-selected", "true")
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
          { ...fileNode(directory, "frontend/app.ts"), path: "frontend\\app.ts" },
          { ...fileNode(directory, longPath), path: `frontend\\${longFilename}` },
        ]
      }

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
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("aria-selected", "true")
  const sidebar = panel.locator('[data-component="session-review-v2-sidebar-root"]')
  const frontend = panel.locator('[data-slot="file-tree-v2-row"][data-path="frontend"]')
  await expect(frontend.getByText("frontend", { exact: true })).toBeVisible()
  await expect(frontend).toHaveAttribute("aria-expanded", "false")
  await frontend.click()
  await expect(frontend).toHaveAttribute("aria-expanded", "true")

  const viewport = sidebar.locator('[data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  const longRow = panel.getByRole("button", { name: longFilename })
  const status = longRow.locator('[data-slot="file-tree-v2-change"]')
  await expect(longRow).toBeVisible()
  await expect.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await expect(longRow.locator('[data-slot="file-tree-v2-label"]')).toHaveCSS("text-overflow", "clip")
  await expect(status).toHaveText("A")
  await expect.poll(() => statusInset(status, "right")).toBeLessThanOrEqual(24)
  await viewport.hover()
  await page.mouse.wheel(1_000, 0)
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(() => statusInset(status, "right")).toBeLessThanOrEqual(24)
  const thumb = sidebar.locator('.scroll-view__thumb[data-orientation="horizontal"]')
  const scrolled = await viewport.evaluate((element) => element.scrollLeft)
  await dragThumb(page, thumb, -40)
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(scrolled)

  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await filter.fill(longFilename)
  const filteredStatus = panel.getByRole("option", { name: longFilename }).locator('[data-slot="file-tree-v2-change"]')
  await expect(filteredStatus).toHaveText("A")
  await viewport.evaluate((element) => {
    element.setAttribute("dir", "rtl")
    element.scrollLeft = 0
    element.dispatchEvent(new Event("scroll"))
  })
  await viewport.hover()
  await dragThumb(page, thumb, -40)
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(0)
  await expect.poll(() => statusInset(filteredStatus, "left")).toBeLessThanOrEqual(24)
  await viewport.evaluate((element) => {
    element.removeAttribute("dir")
    element.scrollLeft = 0
  })

  await filter.fill("")
  await panel.locator('[data-slot="file-tree-v2-row"][data-path="frontend/app.ts"]').click()
  await expect(panel.getByRole("tab", { name: "app.ts" })).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:frontend/app.ts", { exact: true })).toBeVisible()
})

test("a restored file tab keeps the file tree on files changed", async ({ page }) => {
  const directory = "C:/OpenCode/TreeRestore"
  await openSession(page, {
    name: "TreeRestore",
    vcsDiff: [fileDiff("src/changed.ts")],
    fileList: (path) => (path ? [] : [fileNode(directory, "README.md")]),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { ses_treerestore: { review: true } },
      settings: { general: { showFileTree: true } },
      storage: { "opencode.global.dat:layout": { fileTree: { opened: true, width: 240, tab: "changes" } } },
    },
  })
  const panel = page.locator("#review-panel")
  const tree = page.locator("#file-tree-panel")
  const treeTab = (name: string) => tree.getByRole("tab", { name, exact: true })
  const readme = panel.getByRole("tab", { name: "README.md", exact: true })

  await treeTab("All files").click()
  await tree.getByRole("button", { name: "README.md" }).click()
  await expect(readme).toHaveAttribute("aria-selected", "true")
  await treeTab("1 file changed").click()
  await expect(treeTab("1 file changed")).toHaveAttribute("aria-selected", "true")

  await page.reload()
  await expect(readme).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()
  await expect(treeTab("1 file changed")).toHaveAttribute("aria-selected", "true")

  // Selecting a file tab after load still shows it among all files.
  await panel.locator("#session-side-panel-review-tab").click()
  await readme.click()
  await expect(treeTab("All files")).toHaveAttribute("aria-selected", "true")
})

test("rereads a file each time an artifact link opens it", async ({ page }) => {
  const file = { content: "first draft" }

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
  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("first draft", { exact: true })).toBeVisible()

  file.content = "second draft"
  await tab.locator("..").getByRole("button", { name: "Close tab" }).click()
  await expect(tab).toHaveCount(0)
  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("second draft", { exact: true })).toBeVisible()
  await expect(panel.getByText("first draft", { exact: true })).toHaveCount(0)

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
    fileContent: (path) => ({
      content:
        path === "second.svg"
          ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1600"><rect width="1600" height="1600" fill="#6699aa"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="#6699aa"/></svg>',
    }),
    pageMessages: () => ({
      items: [
        {
          id: "msg_images",
          type: "assistant",
          agent: "build",
          model: { id: "test", providerID: "opencode" },
          content: [{ type: "text", text: "[First](first.svg) [Second](second.svg)" }],
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
  await expect(fit).toBeDisabled()
  // Wait for the side pane's opening motion before choosing a gesture anchor.
  await image.hover()
  const initial = (await image.boundingBox())!
  const pane = (await panel.boundingBox())!
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
  await expect(fit).toBeEnabled()
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
  await expect(fit).toBeEnabled()
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
  await expect(fit).toBeEnabled()
  expect((await image.boundingBox())!.x).toBeCloseTo(scrolled.x + 30, 1)
  expect((await image.boundingBox())!.y).toBeCloseTo(scrolled.y + 20, 1)
  // Keyboard-accessible fit restores the exact original geometry.
  await fit.focus()
  await page.keyboard.press("Enter")
  await expect(fit).toBeDisabled()
  expect(await image.boundingBox()).toEqual(initial)
  expect(
    await stage.evaluate((element) =>
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true })),
    ),
  ).toBe(true)
  await image.click()
  await expect(fit).toBeEnabled()
  await page.getByRole("link", { name: "Second", exact: true }).click()
  await expect(panel.getByRole("img", { name: "second.svg", exact: true })).toBeVisible()
  await expect(fit).toBeDisabled()
  await panel.getByRole("img", { name: "second.svg", exact: true }).hover()
  const second = (await panel.getByRole("img", { name: "second.svg", exact: true }).boundingBox())!
  expect(second.width).toBeGreaterThan(0)
  expect(second.height).toBeGreaterThan(0)
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -50)
  await expect(fit).toBeEnabled()
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
  await page.getByRole("button", { name: /preview\.png/ }).click()
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

test("video files over 25 MB play in the viewer, expand into the theatre overlay, and collapse on Escape without remounting", async ({
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
  await page.route(`**/api/fs/read/${file}*`, (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
      body: mp4,
    }),
  )

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await panel.getByRole("button", { name: file }).click()
  await expect(panel.getByRole("tab", { name: file, exact: true })).toHaveAttribute("aria-selected", "true")

  const toolbar = panel.locator('[data-slot="artifact-toolbar"]')
  const stage = panel.locator('[data-slot="artifact-stage"]')
  const video = stage.locator('video[data-slot="artifact-media"]')
  const fullscreen = stage.getByRole("button", { name: "Enter full screen", exact: true })
  const exitFullscreen = stage.getByRole("button", { name: "Exit full screen", exact: true })

  await expect(video).toBeVisible()
  await expect(toolbar).toContainText("64 × 36")
  await expect(toolbar).toContainText("0:01")
  await expect(toolbar).toContainText("38.4 MB")
  await expect(panel.getByText(/Binary file/)).toHaveCount(0)
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false")
  const inlineBounds = (await stage.boundingBox())!
  expect(inlineBounds.width).toBeLessThan(1000)

  await video.evaluate((element) => {
    element.dataset.e2eProbe = "retained"
  })

  await fullscreen.click()
  await expect(exitFullscreen).toHaveAttribute("aria-pressed", "true")
  await expect(stage).toHaveAttribute("data-expanded", "")
  expect(await stage.evaluate((element) => element.matches(":popover-open"))).toBe(true)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  expect(await video.evaluate((element) => element.dataset.e2eProbe)).toBe("retained")
  await expect.poll(() => stage.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 })

  await page.keyboard.press("Escape")
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false")
  await expect(stage).not.toHaveAttribute("data-expanded")
  expect(await stage.evaluate((element) => element.matches(":popover-open"))).toBe(false)
  expect(await video.evaluate((element) => element.dataset.e2eProbe)).toBe("retained")
  await expect.poll(() => stage.boundingBox()).toEqual(inlineBounds)

  await video.dblclick()
  await expect(exitFullscreen).toHaveAttribute("aria-pressed", "true")
  await page.mouse.click(8, 8)
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false")
  expect(await video.evaluate((element) => element.dataset.e2eProbe)).toBe("retained")

  // Chromium's controls also answer a double click with native fullscreen, which covers the backdrop. Opting out with
  // controlslist="nofullscreen" would end their click-to-play as well.
  await video.click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
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
  await page.getByRole("button", { name: "gamma.ts" }).click()
  await selectedFile("gamma.ts")
  await panel.getByRole("button", { name: "Open file" }).click()
  await panel.getByRole("button", { name: "README.md" }).click()
  await selectedTab("README.md")

  await switchSession("Beta review state")
  await toggle.click()
  await expect(review).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await page.getByRole("button", { name: "beta.ts" }).click()
  await selectedFile("beta.ts")
  await page.getByRole("button", { name: "Toggle session context" }).click()
  await selectedTab("Context")

  await switchSession("Gamma review state")
  await toggle.click()
  await panel.getByRole("button", { name: "Open file" }).click()
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
  await page.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Last turn changes" }).click()
  await expect(page.getByRole("button", { name: "Last turn changes" })).toBeVisible()
  await expect(panel.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("delta.ts")

  await page.reload()
  await expectSessionTitle(page, "ReviewTurn")
  await expect(page.getByRole("button", { name: "Last turn changes" })).toBeVisible()
  await expect(panel.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("delta.ts")
})

test("keeps the review state a session stored before extensions", async ({ page }) => {
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
  await mode("Git changes").click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await expect(file).toHaveText("beta.ts")
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage).some(
          ([key, value]) => key.includes("extension.review.session") && value.includes('"branch"'),
        ),
      ),
    )
    .toBe(true)

  // The reopened window's review mounts before its session store has loaded.
  working.length = 0
  await page.goto(desktop("extension.review.session"))
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
      panel.getByRole("button", { name: "Open file", exact: true }),
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

    // Pause in the same task as each click so even the first painted state can be inspected.
    for (const opened of [true, false]) {
      await toggle.evaluate((element) => {
        // SAFETY: `toggle` is the review toggle, a button.
        const button = element as HTMLButtonElement
        button.click()
        document
          .getAnimations()
          .filter((animation) => animation.timeline instanceof DocumentTimeline)
          .forEach((animation) => animation.pause())
      })
      await expect(toggle).toHaveAttribute("aria-expanded", String(opened))
      await expect(panel).toHaveAttribute("aria-hidden", String(!opened))

      for (const progress of [0.25, 0.8]) await expectHeaderClearOfToggle(page, toggle, progress)
      await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation.timeline instanceof DocumentTimeline)
          .forEach((animation) => animation.finish()),
      )
    }

    await expect(panel).toBeHidden()
  })
}

async function dragThumb(page: Page, thumb: Locator, dx: number) {
  await expect(thumb).toBeVisible()
  const box = (await thumb.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2)
  await page.mouse.up()
}

async function statusInset(status: Locator, side: "left" | "right") {
  return status.evaluate((element, side) => {
    const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!.getBoundingClientRect()
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

async function expectHeaderClearOfToggle(page: Page, toggle: Locator, progress: number) {
  const geometry = await page.locator('[data-slot="session-chat-panel"]').evaluate((chat, progress) => {
    const row = chat.parentElement!

    const animations = row
      .getAnimations({ subtree: true })
      .filter((animation) => animation.timeline instanceof DocumentTimeline)

    const width = animations.find(
      (animation) => animation instanceof CSSTransition && animation.transitionProperty === "width",
    )!

    animations.forEach((animation) => {
      animation.pause()
      animation.currentTime = Number(width.effect!.getTiming().duration) * progress
    })
    const chatBounds = chat.getBoundingClientRect()
    const panelBounds = document.querySelector("#review-panel")!.getBoundingClientRect()

    return {
      row: row.getBoundingClientRect().width,
      panelWidth: panelBounds.width,
      gap:
        getComputedStyle(row).direction === "rtl"
          ? chatBounds.left - panelBounds.right
          : panelBounds.left - chatBounds.right,
      contentOpacity: Number(getComputedStyle(document.querySelector('[data-slot="session-review-content"]')!).opacity),
      panels: chatBounds.width + panelBounds.width + parseFloat(getComputedStyle(row).columnGap),
    }
  }, progress)

  expect(geometry.gap).toBeCloseTo(8, 1)

  if (geometry.panelWidth > 0) expect(Math.abs(geometry.row - geometry.panels)).toBeLessThanOrEqual(1)

  if (progress === 0.25) {
    expect(geometry.contentOpacity).toBeGreaterThan(0)
    expect(geometry.contentOpacity).toBeLessThan(1)
  }

  const clip = (await toggle.boundingBox())!
  // Header contents must make no difference to the pixels behind the fixed toggle.
  expect(await page.screenshot({ clip })).toEqual(
    await page.screenshot({ clip, style: ".session-review-v2-tabs-bar { visibility: hidden !important; }" }),
  )
}
