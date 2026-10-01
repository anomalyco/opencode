import { expect, test, type Page } from "@playwright/test"
import type { ConfigEntry, OpenCodeEvent, WorktreeDirectory } from "@opencode/client/promise"
import { NO_PROVIDER, REMOTE_SERVER, SERVER, holdRoute, project, session } from "../utils/app"
import { mockRemoteServer, openSettings, type WorkspaceInput } from "../utils/workspace"

const directory = "C:/Projects/settings-demo"
const projectID = "proj_settings_demo"
const sandboxes = Array.from({ length: 12 }, (_, index) => `${directory}/workspace-${index + 1}`)
const override =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='red'/%3E%3C/svg%3E"
const contributors = "https://api.github.com/repos/anomalyco/opencode/contributors?anon=1&per_page=1"

test.use({ serviceWorkers: "block" })

// One project with 12 worktrees, each with one session, and a configured zsh shell.
function open(page: Page, input: Partial<WorkspaceInput> = {}) {
  return openSettings(page, {
    name: "Settings demo",
    directory,
    project: { icon: { color: "orange", override }, commands: { start: "echo setup" }, sandboxes },
    provider: NO_PROVIDER,
    configEntries: [
      { type: "document", path: "/home/test/.config/opencode/opencode.jsonc", info: { shell: "/bin/zsh" } },
      { type: "directory", path: "/home/test/.config/opencode" },
    ],
    shells: [
      { path: "/bin/zsh", name: "zsh", acceptable: true },
      { path: "/bin/bash", name: "bash", acceptable: true },
    ],
    sessions: sandboxes.map((item, index) => ({
      id: `ses_settings_${index + 1}`,
      title: `Workspace ${index + 1} session`,
      directory: item,
    })),
    ...input,
    seed: { tabs: [], ...input.seed },
  })
}

async function openProject(page: Page, name = "Settings demo") {
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  await settings.getByRole("button", { name, exact: true }).click()
  await expect(settings.getByRole("button", { name: "Back to projects", exact: true })).toBeVisible()
}

const patched = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === `/api/project/${projectID}`,
  )

test("settings has its own route and returns through app history", async ({ page }) => {
  const { settings } = await open(page)
  const home = page.getByRole("button", { name: "Home", exact: true })
  await expect(page).toHaveURL("/settings")
  await expect(home).toHaveAttribute("aria-pressed", "false")
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(page).toHaveURL("/")
  await expect(home).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL("/settings")
  await expect(home).toHaveAttribute("aria-pressed", "false")
  await home.click()
  await expect(page).toHaveURL("/")
  await expect(settings).toBeHidden()
})

test("a settings page survives refresh", async ({ page }) => {
  const { settings } = await open(page)
  const appearance = settings.getByRole("tab", { name: "Appearance", exact: true })
  await appearance.click()
  await expect(page).toHaveURL("/settings?tab=appearance")
  await page.reload()
  await expect(appearance).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL("/settings?tab=appearance")
})

test("another server's settings page survives refresh", async ({ page }) => {
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  const { settings } = await open(page)
  const url = (value: URL) =>
    value.pathname === "/settings" &&
    value.searchParams.get("server") === REMOTE_SERVER &&
    value.searchParams.get("tab") === "providers"
  await page.goto(`/settings?server=${encodeURIComponent(REMOTE_SERVER)}&tab=providers`)
  await expect(settings.getByRole("heading", { name: "Providers", exact: true })).toBeVisible()
  await expect(page).toHaveURL(url)
  await page.reload()
  await expect(settings.getByRole("heading", { name: "Providers", exact: true })).toBeVisible()
  await expect(page).toHaveURL(url)
})

test("single-server settings expose scoped pages without a server picker", async ({ page }) => {
  const { settings } = await open(page)
  await expect(settings.getByRole("tab", { name: "Server", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Servers", exact: true })).toHaveCount(0)
  for (const name of ["Projects", "Worktrees", "Providers", "Models", "Extensions"]) {
    await settings.getByRole("tab", { name, exact: true }).click()
    await expect(settings.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(settings.locator('[data-action="settings-server-select"]')).toHaveCount(0)
  }

  await settings.getByRole("tab", { name: "Server", exact: true }).click()
  await expect(settings.getByText("Terminal shell", { exact: true })).toBeVisible()
  await settings.getByText("zsh", { exact: true }).click()
  const updated = page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/experimental/config",
  )
  await page.getByRole("option", { name: "bash", exact: true }).click()
  expect((await updated).postDataJSON()).toEqual({ shell: "bash" })
})

test("project list menus rename, close, edit, add, and stay inside the scrollport", async ({ page }) => {
  const projects = ["rebase", "dinocms", "opencode", "Playground"].map((name, index) =>
    project({ id: `project-${index}`, directory: `/projects/${name}`, name }),
  )
  const { settings } = await open(page, {
    name: "rebase",
    directory: "/projects/rebase",
    project: { id: "project-0" },
    projects,
    sessions: [],
    fileList: () => [],
    seed: { projects: { local: projects.map((item) => ({ worktree: item.worktree, expanded: true })) } },
  })
  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  const panel = settings.getByRole("tabpanel")
  const list = panel.getByRole("list")
  await expect(list.getByRole("listitem")).toHaveCount(4)
  const card = list.getByRole("listitem").filter({ hasText: "rebase" })
  const more = card.getByRole("button", { name: "More options", exact: true })
  await more.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Rename", "Clear notifications", "Close"])
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click()
  await expect(panel.getByRole("heading", { name: "rebase", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to projects", exact: true }).click()

  await page.setViewportSize({ width: 600, height: 720 })
  // Each project card stays fully inside every horizontal clip ancestor.
  await expect
    .poll(() =>
      card.evaluate((row) => {
        const bounds = row.getBoundingClientRect()
        const clips = []
        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX === "visible") continue
          const clip = parent.getBoundingClientRect()
          clips.push(bounds.left - clip.left, clip.right - bounds.right)
        }
        return Math.min(...clips)
      }),
    )
    .toBeGreaterThanOrEqual(4)
  await expect(panel).toHaveJSProperty("scrollWidth", await panel.evaluate((element) => element.clientWidth))
  await page.setViewportSize({ width: 1280, height: 720 })

  await list
    .getByRole("listitem")
    .filter({ hasText: "dinocms" })
    .getByRole("button", { name: "More options", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(panel.getByRole("button", { name: "dinocms", exact: true })).toHaveCount(0)

  await more.click()
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const rename = panel.getByRole("textbox", { name: "Rename", exact: true })
  await expect(rename).toBeFocused()
  await rename.fill("Renamed project")
  const renamed = page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/project/project-0",
  )
  await rename.press("Enter")
  expect((await renamed).postDataJSON()).toEqual({ name: "Renamed project" })
  await expect(panel.getByRole("button", { name: "Renamed project", exact: true })).toBeVisible()

  await panel.getByRole("button", { name: "Add project", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })
  await picker.getByRole("combobox").fill("/projects/added")
  await picker.getByRole("combobox").press("Enter")
  const select = picker.getByRole("button", { name: "Select folder", exact: true })
  await expect(select).toBeEnabled()
  await select.click()
  await expect(picker).toBeHidden()
  await expect(panel.getByRole("heading", { name: "added", exact: true })).toBeVisible()
})

test("project settings open as a nested view that keeps its route", async ({ page }) => {
  const { settings } = await open(page)
  await openProject(page)
  await expect(settings.getByRole("tab", { name: "General", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Extensions", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Scripts", exact: true })).toHaveCount(0)
  const menu = page.getByRole("menu")
  await settings.locator(".settings-tab-header").getByRole("button", { name: "More options", exact: true }).click()
  await expect(menu.getByRole("menuitem")).toHaveText(["Clear notifications", "Close"])
  // Escape must reach the menu, not the settings screen behind it.
  await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(settings.getByRole("button", { name: "Back to projects", exact: true })).toBeVisible()

  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
  const route = (url: URL) =>
    url.pathname === "/settings" &&
    url.searchParams.get("server") === SERVER &&
    url.searchParams.get("project") === directory &&
    url.searchParams.get("tab") === "workspaces"
  await expect(page).toHaveURL(route)
  await page.reload()
  await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
  await expect(page).toHaveURL(route)
  await page.keyboard.press("Escape")
  await expect(settings.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
})

for (const field of [
  {
    name: "color",
    label: "",
    initial: "orange",
    next: "blue",
    patches: [{ icon: { color: "blue", override: "" } }, { icon: { color: "orange", override: "" } }],
  },
  {
    name: "name",
    label: "Project name",
    initial: "Settings demo",
    next: "Renamed project",
    patches: [{ name: "Renamed project" }, { name: "Settings demo" }],
  },
  {
    name: "startup script",
    label: "Worktree startup script",
    initial: "echo setup",
    next: "bun install",
    patches: [{ commands: { start: "bun install" } }, { commands: { start: "echo setup" } }],
  },
]) {
  test(`project autosave keeps the final ${field.name} when reverting during a save`, async ({ page }) => {
    const { settings } = await open(page, {
      project: { icon: { color: "orange" }, commands: { start: "echo setup" }, sandboxes },
    })
    await openProject(page)
    const hold = await holdRoute(page, (url) => url.pathname === `/api/project/${projectID}`, { method: "PATCH" })
    const edit = async (value: string) => {
      if (field.name === "color") {
        await settings.getByRole("button", { name: `Select ${value} color`, exact: true }).click()
        return
      }
      const input = settings.getByRole("textbox", { name: field.label, exact: true })
      await input.fill(value)
      await input.blur()
    }

    await edit(field.next)
    await hold.arrived
    await edit(field.initial)
    expect(hold.requests.map((request) => request.postDataJSON())).toEqual([field.patches[0]])
    hold.release()
    await expect.poll(() => hold.requests.map((request) => request.postDataJSON())).toEqual(field.patches)
    await expect(settings.locator('[aria-busy="true"]')).toHaveCount(0)

    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await settings.getByRole("tab", { name: "General", exact: true }).click()
    if (field.name === "color") {
      await expect(settings.getByRole("button", { name: "Select orange color", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      )
      return
    }
    await expect(settings.getByRole("textbox", { name: field.label, exact: true })).toHaveValue(field.initial)
  })
}

test("clearing project fields sends explicit removal values", async ({ page }) => {
  const { settings } = await open(page)
  await openProject(page)
  const startup = settings.getByRole("textbox", { name: "Worktree startup script", exact: true })
  await expect(startup).toHaveValue("echo setup")
  const icon = settings.getByRole("button", { name: "Project icon", exact: true })
  await expect(icon.locator("img")).toHaveCount(1)
  const color = settings.getByRole("button", { name: "Select orange color", exact: true })

  for (const step of [
    {
      act: async () => {
        await startup.clear()
        await startup.blur()
      },
      patch: { commands: { start: "" } },
    },
    { act: () => icon.click(), patch: { icon: { color: "orange", override: "" } } },
    {
      act: async () => {
        await expect(color).toHaveAttribute("aria-pressed", "true")
        await color.click()
      },
      patch: { icon: { color: "", override: "" } },
    },
  ]) {
    const saved = patched(page)
    await step.act()
    expect((await saved).postDataJSON()).toEqual(step.patch)
    await expect(settings.locator('[aria-busy="true"]')).toHaveCount(0)
  }
})

test("the new session shortcut waits for a shortcut recording, then leaves settings", async ({ page }) => {
  const { settings } = await open(page)
  await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click()
  const binding = settings.locator('[data-keybind-id="tab.new"]')
  await binding.click()
  await expect(binding).toHaveText("Press keys")
  await page.keyboard.press("Control+t")
  await expect(binding).toHaveText("Ctrl+T")
  await expect(page).toHaveURL("/settings?tab=shortcuts")
  await expect(page.locator("[data-titlebar-tab]")).toHaveCount(0)

  await page.keyboard.press("Control+t")
  await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toHaveCount(1)
})

test.describe("pages open before slow data", () => {
  test("worktrees", async ({ page }) => {
    const { settings } = await open(page)
    const inventory = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
    const sessions = await holdRoute(
      page,
      (url) => url.pathname === "/api/session" && url.searchParams.has("directory"),
    )
    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await inventory.arrived
    await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
    await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
    await expect(settings.getByText("No worktrees", { exact: true })).toHaveCount(0)

    inventory.release()
    await expect(settings.getByText(sandboxes[0]!, { exact: true })).toBeVisible()
    await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
    // Home already listed this session; it renders while the directory reads are still held.
    await sessions.arrived
    await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
    sessions.release()

    const refresh = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
    await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
    refresh.release()
  })

  test("extensions", async ({ page }) => {
    const { settings } = await open(page, { mcp: [{ name: "demo-mcp", status: { status: "connected" } }] })
    const mcp = await holdRoute(page, (url) => url.pathname === "/api/mcp")
    await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
    await mcp.arrived
    await expect(settings.getByRole("heading", { name: "Extensions", exact: true })).toBeVisible()
    await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
    mcp.release()
    await settings.getByRole("tab", { name: "MCPs", exact: true }).click()
    await expect(settings.getByRole("switch", { name: "demo-mcp" })).toBeChecked()
  })

  for (const fails of [false, true]) {
    test(`about ${fails ? "keeps its fallback when contributors fail" : "updates contributors later"}`, async ({
      page,
    }) => {
      const { settings } = await open(page)
      const gate = Promise.withResolvers<void>()
      await page.route(contributors, async (route) => {
        await gate.promise
        if (fails) return route.abort("failed")
        await route.fulfill({
          json: [],
          headers: {
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "Link",
            Link: `<${contributors}&page=1004>; rel="last"`,
          },
        })
      })
      const requested = page.waitForRequest(contributors)
      await settings.getByRole("tab", { name: "About", exact: true }).click()
      await requested
      await expect(settings.getByText("Released under the MIT License", { exact: true })).toBeVisible()
      await expect(settings.getByRole("link", { name: "935 others", exact: true })).toBeVisible()
      await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()

      const website = settings.getByRole("link", { name: "www.opencode.ai", exact: true })
      await website.focus()
      const settled = fails
        ? page.waitForEvent("requestfailed", (request) => request.url() === contributors)
        : page.waitForResponse(contributors)
      gate.resolve()
      await settled
      await expect(settings.getByRole("link", { name: fails ? "935 others" : "988 others", exact: true })).toBeVisible()
      await expect(website).toBeFocused()
    })
  }
})

test("worktrees follow inventory events, wait for session counts, and delete by project", async ({ page }) => {
  const empty = `${directory}/empty-workspace`
  const discovered = `${directory}/discovered-workspace`
  const inventory: WorktreeDirectory[] = [
    { directory },
    ...[...sandboxes, empty].map((item) => ({ directory: item, strategy: "git" })),
  ]
  const view = await open(page, {
    project: { sandboxes: [...sandboxes, empty] },
    worktrees: () => inventory,
    onWorktreeRemove: (body) => {
      inventory.splice(
        inventory.findIndex((item) => item.directory === (body as { directory: string }).directory),
        1,
      )
    },
  })
  const settings = view.settings
  // Holding every directory would fill the request budget; hold only the worktree without sessions.
  const sessions = await holdRoute(
    page,
    (url) => url.pathname === "/api/session" && url.searchParams.get("directory") === empty,
  )
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  const row = settings.locator(".settings-workspaces-row").filter({ has: page.getByLabel(empty, { exact: true }) })
  await expect(row).toContainText("Loading messages")
  await settings.getByRole("button", { name: "More options", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Delete worktrees without sessions", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  sessions.release()
  await expect(row).toContainText("0 sessions")

  const listed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/worktree" && response.request().method() === "GET",
  )
  const read = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === "/api/session" && url.searchParams.get("directory") === discovered
  })
  // Home never listed this session, so only the new worktree's directory read can show it.
  view.sessions.push(session({ id: "ses_discovered", directory: discovered, title: "Discovered session", projectID }))
  inventory.push({ directory: discovered, strategy: "git" })
  await view.push([
    { id: "evt_settings_worktree_updated", created: Date.now(), type: "worktree.updated", data: { projectID } },
  ] as OpenCodeEvent[])
  expect((await listed).ok()).toBe(true)
  await expect(settings.getByText(discovered, { exact: true })).toBeVisible()
  expect((await read).ok()).toBe(true)
  await expect(settings.getByText("Discovered session", { exact: true })).toBeVisible()

  await openProject(page)
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await settings.getByRole("button", { name: "Delete “workspace-1”?", exact: true }).click()
  const deleting = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/worktree" && request.method() === "DELETE",
  )
  await page
    .getByRole("dialog", { name: "Delete “workspace-1”?", exact: true })
    .getByRole("button", { name: "Delete worktree", exact: true })
    .click()
  const request = await deleting
  expect(new URL(request.url()).searchParams.has("location[directory]")).toBe(false)
  expect(request.postDataJSON()).toEqual({ projectID, directory: sandboxes[0], force: true })
  await expect(settings.getByText("13 worktrees", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByText("13 worktrees", { exact: true })).toBeVisible()
  await expect(settings.getByLabel(sandboxes[0]!, { exact: true })).toHaveCount(0)
})

test.describe("worktrees prefetch", () => {
  const other = project({ id: "proj_other", directory: "/repo/other", name: "Other project" })

  for (const interaction of ["hover", "focus"] as const) {
    test(`project Worktrees ${interaction} prefetches only its inventory and reuses the request`, async ({ page }) => {
      const { settings } = await open(page)
      await page.route(
        (url) => url.pathname === "/api/project",
        (route) => route.fulfill({ json: [project({ id: projectID, directory, sandboxes }), other] }),
      )
      const refreshes: string[] = []
      const sessions: string[] = []
      page.on("request", (request) => {
        const url = new URL(request.url())
        if (url.pathname === "/api/worktree/refresh") refreshes.push(request.postDataJSON().projectID)
        if (url.pathname === "/api/session" && url.searchParams.has("directory"))
          sessions.push(url.searchParams.get("directory")!)
      })
      await openProject(page)
      const inventory = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
      const calls = () => inventory.requests.map((request) => new URL(request.url()).searchParams.get("projectID"))
      const worktrees = settings.getByRole("tab", { name: "Worktrees", exact: true })
      await expect(worktrees).toBeEnabled()
      await worktrees[interaction]()
      await inventory.arrived
      await expect(worktrees).toHaveAttribute("aria-selected", "false")
      expect(calls()).toEqual([projectID])
      expect(sessions).toEqual([])

      if (interaction === "hover") {
        const finished = page.waitForEvent(
          "requestfinished",
          (request) => new URL(request.url()).pathname === "/api/worktree",
        )
        inventory.release()
        await finished
      }
      await worktrees.click()
      await expect(worktrees).toHaveAttribute("aria-selected", "true")
      inventory.release()
      await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
      expect(calls()).toEqual([projectID])
      expect(refreshes).toEqual([projectID])
      await expect.poll(() => sessions.toSorted()).toEqual(sandboxes.toSorted())
    })
  }

  test("server Worktrees hover only prefetches metadata", async ({ page }) => {
    const { settings } = await open(page)
    const calls = { projects: 0, worktrees: [] as string[], refreshes: [] as string[] }
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/worktree/refresh")
        calls.refreshes.push(request.postDataJSON().projectID)
    })
    await page.route(
      (url) => url.pathname === "/api/project",
      async (route) => {
        calls.projects += 1
        await route.fulfill({ json: [project({ id: projectID, directory, sandboxes }), other] })
      },
    )
    await page.route(
      (url) => url.pathname === "/api/worktree",
      async (route) => {
        const requested = new URL(route.request().url()).searchParams.get("projectID") ?? ""
        calls.worktrees.push(requested)
        if (requested === other.id) return route.fulfill({ json: [{ directory: other.worktree }] })
        await route.fallback()
      },
    )
    const worktrees = settings.getByRole("tab", { name: "Worktrees", exact: true })
    const fetched = page.waitForEvent(
      "requestfinished",
      (request) => new URL(request.url()).pathname === "/api/project",
    )
    await worktrees.hover()
    await fetched
    await worktrees.focus()
    await expect(worktrees).toHaveAttribute("aria-selected", "false")
    expect(calls).toEqual({ projects: 1, worktrees: [], refreshes: [] })

    await worktrees.click()
    await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
    expect(calls.projects).toBe(1)
    expect(calls.worktrees.toSorted()).toEqual([projectID, other.id].toSorted())
    expect(calls.refreshes).toEqual([])
  })
})

const lsp: ConfigEntry[] = [
  {
    type: "document",
    path: "/config/opencode.json",
    info: { lsp: { typescript: { command: ["typescript-language-server", "--stdio"], extensions: [".ts", ".tsx"] } } },
  },
  {
    type: "document",
    path: `${directory}/opencode.jsonc`,
    info: { lsp: { typescript: { disabled: true }, rust: { command: ["rust-analyzer"], extensions: [".rs"] } } },
  },
]

for (const row of ["configured", "disabled", "failure"] as const) {
  test(`project LSPs: ${row}`, async ({ page }) => {
    const { settings } = await open(page)
    await openProject(page)
    await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
    const state = { fail: row === "failure" }
    const gate = Promise.withResolvers<void>()
    await page.route(
      (url) => url.pathname === "/api/config",
      async (route) => {
        await gate.promise
        if (state.fail) return route.fulfill({ status: 404, json: {} })
        await route.fulfill({ json: row === "disabled" ? [{ type: "document", info: { lsp: false } }] : lsp })
      },
    )
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/config")
    await settings.getByRole("tab", { name: "LSPs", exact: true }).click()
    expect(new URL((await requested).url()).searchParams.get("location[directory]")).toBe(directory)
    const panel = settings.getByRole("tabpanel", { name: "LSPs", exact: true })
    await expect(panel.getByText("Loading", { exact: true })).toBeVisible()
    gate.resolve()

    if (row === "disabled") {
      await expect(panel.getByText("Language servers disabled", { exact: true })).toBeVisible()
      await expect(panel.locator(".project-settings-extension-row")).toHaveCount(0)
      return
    }
    if (row === "failure") {
      await expect(panel.getByText("Could not load language server configuration", { exact: true })).toBeVisible()
      state.fail = false
      await panel.getByRole("button", { name: "Retry", exact: true }).click()
    }
    const rows = panel.locator(".project-settings-extension-row")
    await expect(rows.filter({ hasText: "typescript" })).toContainText("Disabled in config")
    await expect(rows.filter({ hasText: "typescript" })).toContainText(".ts, .tsx")
    await expect(rows.filter({ hasText: "rust" })).toContainText("Enabled in config")
    await expect(panel.getByRole("switch")).toHaveCount(0)
  })
}

// Zen and the Console account share the id `opencode`: the provider comes from models.dev, the
// integration carries the account sign-in.
for (const row of [
  { name: "a fresh install offers the Console sign-in", paid: false, connections: [], console: true },
  {
    name: "a stored Zen API key keeps the Console sign-in",
    paid: true,
    connections: [{ type: "credential", id: "cred_v1", label: "API key", method: "key" }],
    console: true,
  },
  {
    name: "a Console account hides the sign-in row",
    paid: true,
    connections: [{ type: "credential", id: "cred_account", label: "Clara Team", method: "oauth" }],
    console: false,
  },
]) {
  test(`providers: ${row.name}`, async ({ page }) => {
    const { settings } = await open(page, {
      provider: {
        all: [
          {
            id: "opencode",
            name: "OpenCode Zen",
            models: {
              "claude-sonnet-4-6": {
                id: "claude-sonnet-4-6",
                name: "Claude Sonnet 4.6",
                cost: { input: row.paid ? 3 : 0, output: 0 },
              },
            },
          },
        ],
        connected: ["opencode"],
        default: {},
      },
      integrations: [
        {
          id: "opencode",
          name: "OpenCode Console",
          methods: [
            { id: "device", type: "oauth", label: "OpenCode Console account" },
            { type: "key", label: "API key (service account)" },
          ],
          connections: row.connections,
        },
        { id: "opencode-go", name: "OpenCode Go", methods: [{ type: "key" }], connections: [] },
        { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] },
      ],
    })
    await settings.getByRole("tab", { name: "Providers", exact: true }).click()
    await expect(settings.getByRole("heading", { name: "Popular providers" })).toBeVisible()
    const connected = settings.locator('[data-component="connected-providers-section"]')
    if (row.paid) await expect(connected.getByText("OpenCode Zen", { exact: true })).toBeVisible()
    if (!row.paid) await expect(settings.getByText("No connected providers")).toBeVisible()
    // Anthropic only exists in the integration fixture, so its row proves the integration list has loaded.
    await expect(settings.getByText("Anthropic", { exact: true })).toBeVisible()
    await expect(settings.getByText("OpenCode Console", { exact: true })).toHaveCount(row.console ? 1 : 0)
  })
}

test("the add server dialog keeps focus above fullscreen settings", async ({ page }) => {
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  const { settings } = await open(page)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
  await settings.getByRole("button", { name: "Add server" }).click()

  const editor = page.getByRole("dialog", { name: "Add server" })
  await expect(editor.getByPlaceholder("http://localhost:4096")).toBeFocused()
  await expect(editor.getByPlaceholder("username")).toHaveCount(0)
  const name = editor.getByPlaceholder("Localhost", { exact: true })
  await name.click()
  await name.fill("Remote")
  await page.keyboard.press("Tab")
  await expect(editor.getByPlaceholder("password")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(editor).toBeHidden()
  await expect(settings).toBeVisible()
})

test("the tab layout preference switches to vertical tabs and survives reload", async ({ page }) => {
  const { settings } = await open(page)
  const layout = settings.locator('[data-action="settings-tab-layout"]')
  await expect(layout).toContainText("Horizontal")
  await layout.click()
  await page.getByRole("option", { name: "Vertical" }).click()
  await expect(layout).toContainText("Vertical")
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)

  await page.reload()
  await expect(layout).toContainText("Vertical")
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
})

for (const viewport of [
  { name: "desktop", width: 1280, height: 720, bottom: false },
  { name: "mobile", width: 390, height: 844, bottom: true },
]) {
  test(`settings layout (${viewport.name}): every page scrolls inside its panel with room below`, async ({ page }) => {
    await page.route("https://api.github.com/repos/anomalyco/opencode/contributors?*", (route) =>
      route.fulfill({ json: [] }),
    )
    const { settings } = await open(page)
    await page.setViewportSize(viewport)
    const panel = settings.locator(".settings-content > .settings-panel:visible")
    const main = page.getByRole("main")
    if (viewport.bottom) {
      const toggle = settings.locator('[data-action="settings-mobile-titlebar-bottom"]')
      await toggle.locator('[data-slot="switch-control"]').click()
      await expect(toggle.getByRole("switch")).toBeChecked()
    }
    // Wheel over the outer gutter must not move the entire settings screen.
    await main.hover({ position: { x: 1, y: 200 } })
    await page.mouse.wheel(0, 10000)
    await expect(main).toHaveJSProperty("scrollTop", 0)

    const pages = [
      "Preferences",
      "Appearance",
      "Notifications",
      "Shortcuts",
      "Projects",
      "Worktrees",
      "Providers",
      "Models",
      "Extensions",
      "Server",
      "About",
    ]
    for (const [index, name] of pages.entries()) {
      if (viewport.width >= 816) await settings.getByRole("tab", { name, exact: true }).click()
      if (viewport.width < 816) {
        await settings.getByRole("button", { name: pages[Math.max(0, index - 1)], exact: true }).click()
        await page.getByRole("menuitemradio", { name, exact: true }).click()
      }
      if (name === "About") await expect(panel.getByText("Released under the MIT License")).toBeVisible()
      if (name !== "About")
        await expect(
          panel.getByRole("heading", { name: name === "Shortcuts" ? "Keyboard shortcuts" : name, exact: true }),
        ).toBeVisible()
      if (name === "Worktrees") {
        const last = settings.getByText("Workspace 12 session", { exact: true })
        await last.scrollIntoViewIfNeeded()
        await expect(last).toBeInViewport()
        if (!viewport.bottom) await expect(settings.getByRole("button", { name: "Back to app" })).toBeInViewport()
      }
      await panel.hover()
      await page.mouse.wheel(0, 10000)
      await expect
        .poll(() => panel.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
        .toBeLessThanOrEqual(1)
      await expect
        .poll(
          () =>
            panel.evaluate((element) => {
              const body = element.querySelector(".settings-tab-body, .settings-about-content")!
              return element.getBoundingClientRect().bottom - body.lastElementChild!.getBoundingClientRect().bottom
            }),
          { message: `${name} bottom clearance` },
        )
        .toBeGreaterThanOrEqual(viewport.bottom ? 119.5 : 79.5)
      await expect(main).toHaveJSProperty("scrollTop", 0)
      await expect
        .poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1)
    }
  })
}
