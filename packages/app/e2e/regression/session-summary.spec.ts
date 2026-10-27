import { expect, test, type Locator, type Page } from "@playwright/test"
import { SERVER, holdRoute, seed, sessionHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture, installStressSessionTabs, mockStressTimeline, pageMessages } from "../utils/session-fixture"
import { fileDiff, openSession } from "../utils/workspace"

const cors = { "access-control-allow-origin": "*" }

for (const custom of [false, true]) {
  test(`summary toggle ${custom ? "custom" : "default"} shortcut follows the active session`, async ({ page }) => {
    await mockStressTimeline(page)
    await installStressSessionTabs(page)

    // The legacy command ID; the keybind migration renames it to `details.toggle`.
    if (custom) await seed(page, { settings: { keybinds: { "session.summary.toggle": "alt+f8" } } })
    await page.goto(sessionHref(fixture.sourceID))
    const trigger = page.getByRole("button", { name: "Session details", exact: true })
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
    await expect(trigger).toBeEnabled()
    // The trigger scrolls with the timeline under its sticky header, and Kobalte closes a tooltip whenever its
    // trigger scrolls. A cold timeline keeps scrolling to its bottom until it reveals its rows, so hover after that.
    await expect(
      page.locator(`[data-timeline-row="UserMessage"][data-message-id="${fixture.expected.sourceMessageIDs.at(-1)}"]`),
    ).toBeVisible()
    await trigger.hover()
    const tooltip = page.getByRole("tooltip")
    await expect(tooltip).toContainText("Session details")
    const mac = await page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))
    const shortcut = custom ? "Alt+F8" : mac ? "Meta+Shift+Y" : "Control+Shift+Y"
    await expect(tooltip.locator('[data-slot="keybind-v2-label"]')).toHaveText(
      custom ? (mac ? ["⌥", "F8"] : ["Alt", "F8"]) : mac ? ["⇧", "⌘", "Y"] : ["Ctrl", "Shift", "Y"],
    )

    for (const id of [fixture.sourceID, fixture.targetID, fixture.sourceID]) {
      await page.locator(`[data-titlebar-tab-link][href="${sessionHref(id)}"]`).click()
      const messages = id === fixture.sourceID ? fixture.expected.sourceMessageIDs : fixture.expected.targetMessageIDs
      await expect(
        page.locator(`[data-timeline-row="UserMessage"][data-message-id="${messages.at(-1)}"]`),
      ).toBeInViewport()
      await page.keyboard.press(shortcut)
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
      await expect.poll(() => summary.evaluate((element) => element.contains(document.activeElement))).toBe(true)
      await expect(tooltip).toBeHidden()
      await page.keyboard.press(shortcut)
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(summary).toBeHidden()
      await expect(trigger).toBeFocused()
    }

    if (!custom) return

    // The override moved, so storage keeps only its new id and Shortcuts lists no row titled with the old one.
    const keybinds = () => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "null")?.keybinds)
    await expect.poll(keybinds).toEqual({ "details.toggle": "alt+f8" })
    await page.goto("/settings")
    const settings = page.getByTestId("settings-screen")
    await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click()
    await expect(settings.getByText("Toggle session details", { exact: true })).toBeVisible()
    await expect(settings.getByText("session.summary.toggle", { exact: true })).toHaveCount(0)
    expect(await keybinds()).toEqual({ "details.toggle": "alt+f8" })
  })
}

test("the summary always shows services under a static, icon-free heading", async ({ page }) => {
  await openSession(page, {
    name: "SummaryDisclosure",
    seed: { settings: { sessionSummary: { projectExpanded: true, serverExpanded: false } } },
  })
  const trigger = page.getByRole("button", { name: "Session details", exact: true })
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await trigger.click()
  const server = summary.getByRole("heading", { name: "Extensions", exact: true })
  await expect(server).toBeVisible()
  await expect(server.locator("svg")).toHaveCount(0)
  await expect(summary.getByRole("button", { name: "Extensions", exact: true })).toHaveCount(0)
  await expect(summary).not.toContainText("SummaryDisclosure")
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(summary).toBeHidden()
  await page.reload()
  await trigger.click()
  await expect(server).toBeVisible()
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("summary-static-heading.png"), animations: "disabled" })
})

test("the project menu loads changes on demand and opens review", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/vcs/diff") requests.push(request.url())
  })
  await openSession(page, {
    name: "ProjectChanges",
    vcsDiff: [fileDiff("README.md", { additions: 7, deletions: 3 })],
  })
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
  expect(requests).toEqual([])
  await page.keyboard.press("Escape")
  const changes = await holdRoute(page, (url) => url.pathname === "/api/vcs/diff", { method: "GET" })
  await page.locator('[data-slot="session-location-trigger"]').click()
  const menu = page.locator('[data-slot="session-location-card"]')
  await changes.arrived
  await expect(menu.getByRole("menuitem", { name: "Loading changes…", exact: true })).toBeVisible()
  changes.release()
  const workspace = menu.getByRole("menuitem", { name: "Local repository", exact: true })
  await expect(menu.getByRole("menuitem", { name: "Move session to", exact: true })).toHaveCount(0)
  await workspace.click()
  const destinations = page.getByRole("menu", { name: "Local repository", exact: true })
  await expect(destinations.getByRole("menuitem", { name: "New worktree", exact: true })).toBeVisible()
  await expect(destinations.getByText("Move session to", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("project-menu-location-submenu.png"), animations: "disabled" })
  await destinations.getByRole("menuitem", { name: "New worktree", exact: true }).press("Escape")
  await expect(destinations).toBeHidden()
  await expect(menu).toBeHidden()
  await page.locator('[data-slot="session-location-trigger"]').click()
  await expect(menu).toBeVisible()
  const row = menu.getByRole("menuitem", { name: /1 Changed file/ })
  await expect(row).toContainText("+7")
  await expect(row).toContainText("-3")
  await expect(menu.locator(":scope > *")).toHaveText([
    /ProjectChanges$/,
    "Local repository",
    "main",
    /1 Changed file.*\+7.*-3/,
    "",
    "This computer",
    "C:/OpenCode/ProjectChanges",
    "",
    "Edit project",
  ])

  const muted = await menu
    .locator('[data-slot="session-location-path"] [data-slot="icon-svg"]')
    .evaluate((icon) => getComputedStyle(icon).color)

  await expect
    .poll(() =>
      menu
        .locator('[data-slot="icon-svg"], [data-slot="menu-v2-item-chevron"]')
        .evaluateAll((icons) => [...new Set(icons.map((icon) => getComputedStyle(icon).color))]),
    )
    .toEqual([muted])
  await page.screenshot({ path: test.info().outputPath("project-menu-muted-icons.png"), animations: "disabled" })
  await row.click()
  await expect(menu).toBeHidden()
  await expect(page.locator("#review-panel")).toBeVisible()
})

test("a session in a worktree subfolder names its worktree and lists cached worktrees at once", async ({ page }) => {
  const root = "C:/OpenCode/SmokeWorktrees"
  await mockStressTimeline(page, {
    sessions: fixture.sessions.map((item) =>
      item.id === fixture.targetID ? { ...item, directory: `${root}/feature/packages/app` } : { ...item },
    ),
    // Found on disk: the project's stored sandboxes stay empty.
    worktrees: [
      { directory: fixture.directory },
      { directory: `${root}/feature`, strategy: "git" },
      { directory: `${root}/other`, strategy: "git" },
    ],
  })
  await page.goto(sessionHref(fixture.targetID))
  const trigger = page.locator('[data-slot="session-location-trigger"]')
  const summary = page.locator('[data-slot="session-location-card"]')
  const location = summary.getByRole("menuitem", { name: "feature", exact: true })
  await trigger.click()
  await expect(summary.getByText("feature", { exact: true })).toBeVisible()
  await expect(location).toBeVisible()
  await location.click()
  await enter(page, location, page.getByRole("menu", { name: "feature", exact: true }))
  await expect(page.getByRole("menuitem", { name: "Worktree", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await expect(summary).toBeHidden()

  // The reopened summary's menu lists the cached inventory while its own refresh stays held.
  const list = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
  await trigger.click()
  await location.click()
  await enter(page, location, page.getByRole("menu", { name: "feature", exact: true }))
  await list.arrived
  await page.getByRole("menuitem", { name: "Worktree", exact: true }).click()
  const existing = page.getByRole("menu").filter({ has: page.getByRole("menuitem", { name: "other", exact: true }) })
  await expect(existing.getByRole("menuitem", { name: "other", exact: true })).toBeVisible()
  await expect(existing.getByRole("menuitem", { name: "feature", exact: true })).toHaveCount(0)
  list.release()
})

test("a subagent shows its details but cannot move to another worktree", async ({ page }) => {
  const root = "C:/OpenCode/SmokeWorktrees"

  await mockStressTimeline(page, {
    sessions: fixture.sessions.map((item) =>
      item.id === fixture.targetID
        ? { ...item, parentID: fixture.sourceID, directory: `${root}/feature` }
        : { ...item },
    ),
    worktrees: [{ directory: fixture.directory }, { directory: `${root}/feature`, strategy: "git" }],
  })
  await page.goto(sessionHref(fixture.targetID))

  const summary = page.getByRole("dialog", { name: "Session details", exact: true })

  await page.getByRole("button", { name: "Session details", exact: true }).click()
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
  await expect(summary).not.toContainText("feature")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "More options", exact: true })).toHaveCount(0)
  await page.locator('[data-slot="session-location-trigger"]').click()
  const location = page.locator('[data-slot="session-location-card"]')
  await expect(location.getByText("feature", { exact: true })).toBeVisible()
  await expect(location.getByRole("menuitem", { name: "Move session to", exact: true })).toHaveCount(0)
  await expect(location.getByRole("menuitem", { name: "feature", exact: true })).toBeDisabled()
})

test("the details follow the routed session when it moves to another worktree", async ({ page }) => {
  const root = "C:/OpenCode/SmokeWorktrees"

  const sessions = fixture.sessions.map((item) =>
    item.id === fixture.targetID ? { ...item, directory: `${root}/feature` } : { ...item },
  )

  const mock = await mockStressTimeline(page, {
    sessions,
    worktrees: [
      { directory: fixture.directory },
      { directory: `${root}/feature`, strategy: "git" },
      { directory: `${root}/other`, strategy: "git" },
    ],
  })

  await page.goto(sessionHref(fixture.targetID))
  const trigger = page.locator('[data-slot="session-location-trigger"]')
  const summary = page.locator('[data-slot="session-location-card"]')
  const location = (name: string) => summary.getByText(name, { exact: true })
  await trigger.click()
  await expect(location("feature")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(summary).toBeHidden()

  // The server moves the session; the screen stays mounted while its plugins read the new worktree.
  const moved = sessions.find((item) => item.id === fixture.targetID)

  if (moved) moved.directory = `${root}/other`
  await mock.push([
    {
      id: "evt_details_session_moved",
      type: "session.moved",
      created: 2,
      durable: { aggregateID: fixture.targetID, seq: 1, version: 1 },
      data: { sessionID: fixture.targetID, location: { directory: `${root}/other` }, projectID: fixture.project.id },
    },
  ])
  await expect(trigger.locator('[data-slot="session-location-worktree"]')).toHaveText("other")
  await trigger.click()
  await expect(location("other")).toBeVisible()
  await expect(location("feature")).toHaveCount(0)
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`summary overlays the view and submenus follow ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockStressTimeline(page)
    await openWithDirection(page, sessionHref(fixture.targetID), direction)
    const trigger = page.getByRole("button", { name: "Session details", exact: true })
    await expect(trigger).toBeEnabled()
    await expect(page.locator("html")).toHaveAttribute("dir", direction)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    const warnings = ownerWarnings(page)

    const row = page.locator(
      `[data-timeline-row="UserMessage"][data-message-id="${fixture.expected.targetMessageIDs.at(-1)}"]`,
    )

    const composer = page.locator('[data-component="session-composer-dock"] > div')
    const timeline = page.locator('[data-slot="session-timeline-scroll"]')
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    await expect(row).toBeInViewport()
    const before = { row: (await row.boundingBox())!, composer: (await composer.boundingBox())! }

    await trigger.click()
    await expect(summary).toBeVisible()
    await expect
      .poll(async () => {
        const message = (await row.boundingBox())!
        const input = (await composer.boundingBox())!

        return Math.max(Math.abs(message.x - before.row.x), Math.abs(input.x - before.composer.x))
      })
      .toBeLessThan(1)
    // The capped session column can end before the menu, so the overlay is measured against the whole timeline.
    await expect
      .poll(async () => {
        const view = (await timeline.boundingBox())!
        const details = (await summary.boundingBox())!

        return Math.min(view.x + view.width, details.x + details.width) - Math.max(view.x, details.x)
      })
      .toBeGreaterThan(0)
    await expectAlignedWithHeader(page, direction)

    const mcp = summary.getByRole("button", { name: "MCP", exact: true })
    const submenu = page.getByRole("group", { name: "MCP", exact: true })
    await mcp.click()
    await expect(submenu.getByText("No MCP servers configured", { exact: true })).toBeVisible()
    await expect(submenu.getByText("Configuration file")).toBeVisible()
    await expect(summary).toBeVisible()
    // The submenu opens beside its row, never over it.
    await expect
      .poll(async () => {
        const item = (await mcp.boundingBox())!
        const menu = (await submenu.boundingBox())!

        return menu.x + menu.width <= item.x + 1 || menu.x >= item.x + item.width - 1
      })
      .toBe(true)

    for (const [name, empty] of [
      ["Plugins", "No plugins configured"],
      ["Skills", "No skills configured"],
      ["LSP", "No LSP servers configured"],
    ]) {
      await summary.getByRole("button", { name, exact: true }).click()
      await expect(page.getByRole("group", { name, exact: true }).getByText(empty, { exact: true })).toBeVisible()
      await expect(submenu).toBeHidden()
    }

    await page.keyboard.press("Escape")
    await expect(page.getByRole("group", { name: "LSP", exact: true })).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(summary).toBeHidden()

    await page.getByRole("button", { name: "Toggle review", exact: true }).click()
    await trigger.click()
    await expectAlignedWithHeader(page, direction)
    expect(warnings).toEqual([])
  })
}

test("summary catalogs load, refresh while cached, and tell errors from empty", async ({ page }) => {
  const state = { fail: true, extra: false, empty: false }
  const pluginDirectories: string[] = []

  const lsp = [
    {
      type: "document",
      info: {
        lsp: {
          typescript: { command: ["typescript-language-server", "--stdio"] },
          rust: { command: ["rust-analyzer"] },
        },
      },
    },
    { type: "document", info: { lsp: { rust: { disabled: true } } } },
  ]

  await mockStressTimeline(page, {
    mcp: () => (state.empty ? [] : [{ name: "summary-mcp", status: { status: "connected" } }]),
    plugins: () =>
      state.empty
        ? []
        : [
            { id: "builtin", source: { type: "builtin" }, features: {}, state: { status: "active" } },
            {
              id: "supermemory",
              source: { type: "package", target: "opencode-supermemory" },
              features: { server: true },
              state: { status: "active" },
            },
            {
              id: "broken-plugin",
              source: { type: "local", path: "/broken.ts" },
              features: { server: true },
              state: { status: "failed", error: "Plugin failed to activate" },
            },
            ...(state.extra
              ? [
                  {
                    id: "daytona",
                    source: { type: "package", target: "opencode-daytona" },
                    features: {},
                    state: { status: "active" },
                  },
                ]
              : []),
          ],
    skills: () =>
      state.empty
        ? []
        : [
            { id: "find-skills", name: "find-skills", path: "/skills/find/SKILL.md", content: "Find skills" },
            { id: "review-animations", name: "review-animations", path: "/skills/review/SKILL.md", content: "Review" },
          ],
    configEntries: lsp,
  })
  await page.route(
    (url) => url.pathname === "/api/plugin",
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback()
      pluginDirectories.push(new URL(route.request().url()).searchParams.get("location[directory]") ?? "")

      if (state.fail) return route.fulfill({ status: 500, headers: cors, json: { message: "Unavailable" } })

      return route.fallback()
    },
  )
  const prefetch = await holdRoute(page, (url) => url.pathname === "/api/plugin")
  const warnings = ownerWarnings(page)
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  const menu = (name: string) => page.getByRole("group", { name, exact: true })

  const open = async (name: string) => {
    const item = summary.getByRole("button", { name, exact: true })
    await item.click()
    await expect(menu(name)).toBeVisible()
  }

  await prefetch.arrived
  await expect(summary.getByText("Local repository", { exact: true })).toHaveCount(0)
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
  await open("Plugins")
  await expect(menu("Plugins").getByRole("status")).toContainText("Loading")
  await expect(menu("Plugins").getByText("No plugins configured", { exact: true })).toHaveCount(0)
  prefetch.release()
  await expect(menu("Plugins").getByRole("alert")).toContainText("Request failed")
  await expect(menu("Plugins").getByText("No plugins configured", { exact: true })).toHaveCount(0)

  state.fail = false
  await menu("Plugins").getByRole("button", { name: "Retry", exact: true }).click()
  await expect(menu("Plugins").getByText("supermemory", { exact: true })).toBeVisible()
  await expect(menu("Plugins").getByText("builtin", { exact: true })).toHaveCount(0)
  // The dot is the status: a failed plugin's dot shows its error on hover.
  await menu("Plugins")
    .locator(".session-service-row")
    .filter({ hasText: "broken-plugin" })
    .locator(".session-service-dot")
    .hover()
  await expect(page.getByRole("tooltip")).toHaveText("Plugin failed to activate")
  expect(pluginDirectories.length).toBeGreaterThan(1)
  expect(pluginDirectories.every((directory) => directory === fixture.directory)).toBe(true)

  await open("Skills")
  await expect(menu("Skills").getByText("find-skills", { exact: true })).toBeVisible()
  await expect(menu("Skills").getByText("review-animations", { exact: true })).toBeVisible()
  await expect(menu("Plugins")).toBeHidden()
  await open("LSP")
  await expect(menu("LSP").getByText("typescript", { exact: true })).toBeVisible()
  await expect(menu("LSP").getByText("rust", { exact: true })).toHaveCount(0)
  await expect(menu("LSP").locator(".session-service-dot")).toHaveCount(0)
  await open("MCP")
  await expect(
    menu("MCP").locator('[data-slot="truncated-text-label"]').filter({ hasText: "summary-mcp" }),
  ).toBeVisible()

  for (const service of [
    { name: "MCP", path: "/api/mcp", item: "summary-mcp" },
    { name: "Plugins", path: "/api/plugin", item: "supermemory" },
    { name: "Skills", path: "/api/skill", item: "find-skills" },
    { name: "LSP", path: "/api/config", item: "typescript" },
  ]) {
    await expectRefreshKeeps(page, service.name, service.path, service.item)
  }

  state.extra = true
  await expectRefreshKeeps(page, "Plugins", "/api/plugin", "supermemory")
  await expect(menu("Plugins").getByText("daytona", { exact: true })).toBeVisible()

  state.empty = true
  lsp.length = 0

  for (const service of [
    { name: "MCP", path: "/api/mcp", empty: "No MCP servers configured" },
    { name: "Plugins", path: "/api/plugin", empty: "No plugins configured" },
    { name: "Skills", path: "/api/skill", empty: "No skills configured" },
    { name: "LSP", path: "/api/config", empty: "No LSP servers configured" },
  ]) {
    await open(service.name)
    await expectRefreshKeeps(page, service.name, service.path, service.empty)
  }

  expect(warnings).toEqual([])
})

test("MCP rows toggle once per action and keep sign-in, errors, and management available", async ({ page }) => {
  await mockStressTimeline(page, {
    mcp: [
      { name: "figma", status: { status: "connected" } },
      { name: "linear", status: { status: "needs_auth" }, integrationID: "linear-oauth" },
      { name: "playwright", status: { status: "failed", error: "Connection refused" } },
      { name: "waiting", status: { status: "pending" } },
      { name: "off", status: { status: "disabled" } },
    ],
  })
  const writes: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())

    if (request.method() === "POST" && url.pathname.startsWith("/api/experimental/mcp/")) writes.push(url.pathname)
  })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const item = page.getByRole("button", { name: "MCP", exact: true })
  await item.click()
  const submenu = page.getByRole("group", { name: "MCP", exact: true })
  await expect(submenu).toBeVisible()

  const row = (name: string) =>
    submenu.locator(".session-mcp-row").filter({ has: page.getByText(name, { exact: true }) })

  const connected = submenu.getByRole("switch", { name: "figma", exact: true })
  const disabled = submenu.getByRole("switch", { name: "off", exact: true })
  await expect(submenu.getByRole("switch")).toHaveCount(4)
  await expect(submenu.locator(".session-service-dot")).toHaveCount(5)
  await expect(connected).toBeChecked()
  await expect(disabled).not.toBeChecked()
  await expect(submenu.getByRole("switch", { name: "waiting", exact: true })).toBeDisabled()
  await expect(submenu.getByRole("switch", { name: "waiting", exact: true })).toHaveAccessibleDescription("Connecting…")
  // The dot is the status; the words are for assistive technology only.
  await expect(connected).toHaveAccessibleDescription("Connected")
  await expect(disabled).toHaveAccessibleDescription("Disabled")
  await expect(submenu.getByRole("switch", { name: "playwright", exact: true })).toHaveAccessibleDescription("Failed")
  await expect(submenu.getByRole("button", { name: "Sign in to linear", exact: true })).toBeVisible()
  await expect(submenu.getByRole("button", { name: "Details for playwright", exact: true })).toBeVisible()
  await expect
    .poll(async () => {
      const [inset, dot, label] = await Promise.all([
        row("figma").evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const style = getComputedStyle(element)

          return {
            rtl: style.direction === "rtl",
            start:
              style.direction === "rtl"
                ? bounds.right - parseFloat(style.paddingRight)
                : bounds.left + parseFloat(style.paddingLeft),
          }
        }),
        row("figma").locator(".session-service-dot").boundingBox(),
        row("figma").locator('[data-slot="truncated-text-label"]').boundingBox(),
      ])

      if (!dot || !label) return

      return {
        width: dot.width,
        height: dot.height,
        alignment: inset.rtl ? inset.start - dot.x - dot.width : dot.x - inset.start,
        gap: inset.rtl ? dot.x - label.x - label.width : label.x - dot.x - dot.width,
      }
    })
    .toEqual({ width: 6, height: 6, alignment: 0, gap: 8 })
  await page.screenshot({ path: test.info().outputPath("mcp-toggles.png"), animations: "disabled" })

  for (const [index, target] of ["label", "dot", "padding", "control", "keyboard"].entries()) {
    await expect(connected).toBeEnabled()

    const pending =
      index === 0
        ? await holdRoute(page, /\/api\/experimental\/mcp\/figma\/disconnect(?:\?|$)/, { method: "POST" })
        : undefined

    if (target === "label") await row("figma").locator('[data-slot="truncated-text-label"]').click()

    if (target === "dot") await row("figma").locator(".session-service-dot").click()

    if (target === "padding") await row("figma").click({ position: { x: 3, y: 3 } })

    if (target === "control") await row("figma").locator('[data-slot="switch-control"]').click()

    if (target === "keyboard") await connected.press("Space")

    if (pending) {
      await pending.arrived
      await expect(connected).toBeDisabled()
      pending.release()
    }

    await expect(connected).toBeChecked({ checked: index % 2 !== 0 })
    await expect(connected).toBeEnabled()
    await expect(connected).toHaveAccessibleDescription(index % 2 !== 0 ? "Connected" : "Disabled")
    await expect(submenu).toBeVisible()
    expect(writes).toEqual(
      Array.from(
        { length: index + 1 },
        (_, index) => `/api/experimental/mcp/figma/${index % 2 !== 0 ? "connect" : "disconnect"}`,
      ),
    )
  }

  await expect(connected).toBeFocused()
  await disabled.press("Space")
  await expect(disabled).toBeChecked()
  await expect(disabled).toBeEnabled()
  expect(writes.at(-1)).toBe("/api/experimental/mcp/off/connect")
  expect(writes).toHaveLength(6)

  await submenu.getByRole("button", { name: "Manage MCP servers", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "MCPs", exact: true })).toBeVisible()
  await expect(submenu).toBeHidden()
})

test("Extensions lists open on hover, hold course into the open list, and follow the keyboard", async ({ page }) => {
  await mockStressTimeline(page, {
    mcp: [{ name: "figma", status: { status: "connected" } }],
    plugins: [
      {
        id: "supermemory",
        source: { type: "package", target: "opencode-supermemory" },
        features: {},
        state: { status: "active" },
      },
    ],
  })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  const row = (name: string) => summary.getByRole("button", { name, exact: true })
  const list = (name: string) => page.getByRole("group", { name, exact: true })

  // Hovering opens a list without a click, and moving down the rows switches lists.
  await row("MCP").hover()
  await expect(row("MCP")).toHaveAttribute("aria-expanded", "true")
  await expect(list("MCP").getByRole("switch", { name: "figma", exact: true })).toBeVisible()
  await row("Plugins").hover()
  await expect(list("Plugins").getByText("supermemory", { exact: true })).toBeVisible()
  await expect(list("MCP")).toBeHidden()
  await row("MCP").hover()
  await expect(list("MCP")).toBeVisible()

  // A diagonal move from MCP into its list crosses the Plugins row without switching to it.
  const from = (await row("MCP").boundingBox())!
  const into = (await list("MCP").boundingBox())!
  await page.mouse.move(into.x + into.width - 24, from.y + from.height * 3, { steps: 12 })
  await expect(row("MCP")).toHaveAttribute("aria-expanded", "true")
  await expect(row("Plugins")).toHaveAttribute("aria-expanded", "false")
  await expect(list("MCP")).toBeVisible()

  // A pointer that comes to rest on Plugins while still heading for the list switches to Plugins.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  const plugins = (await row("Plugins").boundingBox())!
  await page.mouse.move(plugins.x + 12, plugins.y + plugins.height / 2, { steps: 6 })
  await expect(list("Plugins")).toBeVisible()

  // The keyboard opens a list into its first control and closes it back to its row; Escape closes only the list.
  await page.mouse.move(0, 0)
  await page.keyboard.press("Escape")
  await expect(list("Plugins")).toBeHidden()
  await expect(summary).toBeVisible()
  await row("MCP").focus()
  await page.keyboard.press("ArrowRight")
  await expect(list("MCP").getByRole("switch", { name: "figma", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(list("MCP")).toBeHidden()
  await expect(row("MCP")).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(list("MCP").getByRole("switch", { name: "figma", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(list("MCP")).toBeHidden()
  await expect(row("MCP")).toBeFocused()
  await expect(summary).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(summary).toBeHidden()
})

test("Extensions lists open config files and skills in a side tab and start setup sessions", async ({ page }) => {
  const global = "C:/Users/kit/.config/opencode/opencode.jsonc"
  const skill = `${fixture.directory}/.opencode/skills/release-notes/SKILL.md`

  await mockStressTimeline(page, {
    mcp: [{ name: "atlas-search", status: { status: "connected" } }],
    plugins: [],
    skills: [{ id: "release-notes", name: "release-notes", path: skill, content: "Release notes" }],
    configEntries: [
      {
        type: "document",
        path: global,
        info: { mcp: { servers: { "atlas-search": { type: "remote", url: "https://atlas.example" } } } },
      },
      // An empty project override used to win, so the servers' own file never opened.
      { type: "document", path: `${fixture.directory}/.opencode/opencode.jsonc`, info: { mcp: {} } },
    ],
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
  })
  await page.goto(sessionHref(fixture.targetID))
  const trigger = page.getByRole("button", { name: "Session details", exact: true })
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  const row = (name: string) => summary.getByRole("button", { name, exact: true })
  const list = (name: string) => page.getByRole("group", { name, exact: true })

  await trigger.click()
  await row("MCP").hover()
  // A file outside the workspace is read by name from its own directory.
  const read = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/api/fs/read/opencode.jsonc"))
  await list("MCP").getByRole("button", { name: "Configuration file", exact: true }).click()
  expect(new URL((await read).url()).searchParams.get("location[directory]")).toBe("C:/Users/kit/.config/opencode/")
  await expect(summary).toBeHidden()
  await expect(page.getByRole("tab", { name: "opencode.jsonc", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("contents:opencode.jsonc", { exact: true })).toBeVisible()

  await trigger.click()
  await row("Skills").hover()
  await list("Skills").getByRole("button", { name: "release-notes", exact: true }).click()
  await expect(summary).toBeHidden()
  await expect(page.getByRole("tab", { name: "SKILL.md", exact: true })).toHaveAttribute("aria-selected", "true")

  // An empty list offers a draft session in the global configuration's directory, its prompt filled in.
  await trigger.click()
  await row("Plugins").hover()
  await list("Plugins").getByRole("button", { name: "Add a plugin with OpenCode", exact: true }).click()
  await expect(page).toHaveURL(/\/new-session\?/)
  await expect(page.locator('[data-component="composer-editor"]')).toContainText(
    "Help me add a plugin to my global OpenCode config.",
  )
})

test("multiple desktop connections show the session's server name", async ({ page }) => {
  await mockStressTimeline(page)
  await page.route("http://secondary.test/**", (route) =>
    route.fulfill({
      json: { version: "2.0.0", pid: 1, urls: ["http://secondary.test"], paths: { tmp: "/tmp/opencode" } },
    }),
  )
  await seed(page, {
    servers: [
      { url: SERVER, name: "Design server" },
      { url: "http://secondary.test", name: "Other server" },
    ],
  })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await expect(summary.getByText("Design server", { exact: true })).toBeVisible()
  await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
})

test.describe("remote configuration", () => {
  test.use({ serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] })

  test("remote servers copy each service's configuration path", async ({ page }) => {
    const remote = "http://summary-remote.test:4096"
    const home = "/home/remote/.config/opencode"

    const entries = [
      { type: "document", path: `${home}/mcp.jsonc`, info: { mcp: { servers: {} } } },
      { type: "document", path: `${home}/plugins.json`, info: { plugins: [] } },
      { type: "document", path: `${home}/skills.jsonc`, info: { skills: [] } },
      { type: "document", path: `${home}/lsp.json`, info: { lsp: false } },
      { type: "document", path: `${fixture.directory}/opencode.json`, info: {} },
      { type: "document", path: `${fixture.directory}/.opencode/agents/review.md`, info: {} },
    ]

    await mockOpenCodeServer(page, {
      server: remote,
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
      configEntries: entries,
    })
    await seed(page, { servers: [{ url: remote, name: "Remote server" }] })
    await page.goto(sessionHref(fixture.targetID, remote))
    const trigger = page.getByRole("button", { name: "Session details", exact: true })
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    const tooltip = page.getByRole("tooltip")

    // Each service opens from a fresh summary: after a copy, the next submenu closes itself (reported defect).
    for (const [index, service] of [
      { name: "MCP", path: `${home}/mcp.jsonc` },
      { name: "Plugins", path: `${home}/plugins.json` },
      { name: "Skills", path: `${home}/skills.jsonc` },
      { name: "LSP", path: `${home}/lsp.json` },
    ].entries()) {
      await trigger.click()
      const item = summary.getByRole("button", { name: service.name, exact: true })
      await item.click()
      const menu = page.getByRole("group", { name: service.name, exact: true })
      await expect(menu).toBeVisible()
      const copy = menu.getByRole("button", { name: "Copy configuration file path", exact: true })
      await expect(tooltip).toHaveCount(0)
      await copy.hover()
      await expect(tooltip).toHaveText("Copy")

      if (index === 0) {
        await expect
          .poll(async () => {
            const icon = (await copy.locator("svg").boundingBox())!
            const tip = (await tooltip.boundingBox())!

            return Math.abs(tip.x + tip.width / 2 - icon.x - icon.width / 2)
          })
          .toBeLessThanOrEqual(1)
      }

      await copy.click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(service.path)
      await expect(tooltip).toHaveText("Copied")
      await expect(menu).toBeVisible()
      await trigger.click()
      await expect(summary).toBeHidden()
    }

    entries.length = 0
    await page.evaluate(() => navigator.clipboard.writeText("original clipboard"))
    await trigger.click()
    const skills = summary.getByRole("button", { name: "Skills", exact: true })
    await skills.click()
    await expect(page.getByRole("group", { name: "Skills", exact: true })).toBeVisible()

    const copy = page
      .getByRole("group", { name: "Skills", exact: true })
      .getByRole("button", { name: "Copy configuration file path", exact: true })

    await copy.click()
    await expect(page.getByText("No configuration file found", { exact: true })).toBeVisible()
    await expect(copy).toBeEnabled()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("original clipboard")
  })
})

test("long MCP lists stay in the viewport in a real RTL locale", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await mockStressTimeline(page, {
    mcp: Array.from({ length: 30 }, (_, index) => ({
      name: `server-${String(index).padStart(2, "0")}-בדיקה-${"long-name-".repeat(6)}`,
      status: { status: "connected" },
    })),
  })
  await seed(page, { locale: "he", theme: { id: "oc-2", scheme: "dark" } })
  await page.goto(sessionHref(fixture.targetID))
  await page.getByRole("button", { name: "פרטי ההפעלה", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "פרטי ההפעלה", exact: true })
  await summary.getByRole("button", { name: "MCP", exact: true }).click()
  const menu = page.getByRole("group", { name: "MCP", exact: true })
  await expect(menu.locator(".session-mcp-row")).toHaveCount(30)
  await expect.poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect
    .poll(async () => {
      const bounds = (await menu.boundingBox())!

      return bounds.x >= 15 && bounds.y >= 15 && bounds.x + bounds.width <= 785 && bounds.y + bounds.height <= 585
    })
    .toBe(true)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
})

// Moves the pointer straight across from a submenu's trigger into the open submenu, so it never crosses sibling items.
async function enter(page: Page, trigger: Locator, menu: Locator) {
  await expect(menu).toBeVisible()
  const from = (await trigger.boundingBox())!
  const to = (await menu.boundingBox())!
  await page.mouse.move(to.x + to.width / 2, from.y + from.height / 2, { steps: 5 })
}

// Solid reports reactive work created without an owner; the warning appears in dev builds only.
function ownerWarnings(page: Page) {
  const warnings: string[] = []
  page.on("console", (event) => {
    if (event.text().includes("computations created outside")) warnings.push(event.text())
  })

  return warnings
}

// The summary keeps the previous 12px inset from the header's inline end.
async function expectAlignedWithHeader(page: Page, direction: "ltr" | "rtl") {
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await expect(summary).toBeVisible()
  await expect
    .poll(async () => {
      const header = (await page.locator("[data-session-title]").boundingBox())!
      const menu = (await summary.boundingBox())!

      return direction === "ltr"
        ? Math.abs(header.x + header.width - menu.x - menu.width - 12)
        : Math.abs(menu.x - header.x - 12)
    })
    .toBeLessThanOrEqual(1)
}

// Reopens a service submenu while its next catalog request is held: the cached content stays, marked busy.
async function expectRefreshKeeps(page: Page, name: string, path: string, content: string) {
  const menu = page.getByRole("group", { name, exact: true })
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  const label = menu.getByText(content, { exact: true }).and(menu.locator(":not(.sr-only)")).filter({ visible: true })
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()

  if (!(await summary.isVisible())) await page.getByRole("button", { name: "Session details", exact: true }).click()
  const refresh = await holdRoute(page, (url) => url.pathname === path, { method: "GET" })
  await summary.getByRole("button", { name, exact: true }).click()
  await refresh.arrived
  await expect(menu).toHaveAttribute("aria-busy", "true")
  await expect(label).toBeVisible()
  await expect(menu.getByRole("status")).toHaveCount(0)
  await expect(summary).toBeVisible()
  refresh.release()
  await expect(menu).toHaveAttribute("aria-busy", "false")
  await expect(label).toBeVisible()
}
