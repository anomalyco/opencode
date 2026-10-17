import { expect, test, type Browser, type Page } from "@playwright/test"
import { expectPath, holdRoute, NO_PROVIDER, project, REMOTE_SERVER, seed, session, sessionHref } from "../utils/app"
import { mockOpenCodeServer, mockSharedServer, type MockServerConfig } from "../utils/mock-server"
import { fixture, mockStressTimeline, pageMessages } from "../utils/session-fixture"
import { mockRemoteServer } from "../utils/workspace"
import { APP_READY_TIMEOUT, expectAppVisible } from "../utils/waits"

test.use({ serviceWorkers: "block" })

const row = (page: Page, title: string) =>
  page.locator('[data-component="home-session-row"]').filter({ hasText: title })

async function openHome(page: Page, input: Parameters<typeof mockStressTimeline>[1] = {}) {
  await mockStressTimeline(page, input)
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
  })
  await page.goto("/")
}

test("the session context menu renames, exports, and deletes a Home session", async ({ page }) => {
  await openHome(page)
  const target = row(page, fixture.expected.targetTitle)
  await expect(target).toBeVisible()

  await target.focus()
  await target.press("Shift+F10")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeHidden()
  await expect(target).toBeFocused()

  const box = await target.boundingBox()
  await target.click({ button: "right", position: { x: 48, y: 12 } })
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Export…", "Delete…"])
  const menu = await page.locator('[data-component="menu-v2-content"]').boundingBox()
  expect(Math.abs((menu?.x ?? 0) - (box?.x ?? 0) - 48)).toBeLessThan(4)

  await page.getByRole("menuitem", { name: "Rename" }).click()
  const title = page.locator('[data-component="home-session-rename"]')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue(fixture.expected.targetTitle)
  await title.fill("Renamed from Home")

  const renamed = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname.endsWith(`/session/${fixture.targetID}`),
  )

  await title.press("Enter")
  expect((await renamed).postDataJSON()).toEqual({ title: "Renamed from Home" })
  const renamedRow = row(page, "Renamed from Home")
  await renamedRow.click()
  await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
  await expect(page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: "Renamed from Home" })).toBeVisible()
  await page.getByRole("button", { name: "Home" }).click()
  await expect(page).toHaveURL("/")

  await renamedRow.click({ button: "right" })
  const download = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Export…" }).click()
  expect((await download).suggestedFilename()).toBe("renamed-from-home.json")

  await renamedRow.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete…" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText('Delete session "Renamed from Home"?')

  const removed = page.waitForRequest(
    (request) => request.method() === "DELETE" && new URL(request.url()).pathname.endsWith(`/${fixture.targetID}`),
  )

  await dialog.getByRole("button", { name: "Delete session" }).click()
  await removed
  await expect(renamedRow).toBeHidden()
})

test("the Home shortcut focuses session search, and the Home button leaves focus alone", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
    tabs: [fixture.sourceID],
  })
  await page.goto(sessionHref(fixture.sourceID))
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable({ timeout: APP_READY_TIMEOUT })
  await editor.click()

  await page.keyboard.press("ControlOrMeta+b")
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  await expect(search).toBeFocused()
  await page.keyboard.type("jump")
  await expect(page.getByRole("option")).toHaveCount(1)
  await expect(page.getByRole("option")).toContainText(fixture.expected.targetTitle)

  await page.keyboard.press("ControlOrMeta+b")
  await expectPath(page, sessionHref(fixture.sourceID))

  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(search).toHaveValue("")
  await expect(search).not.toBeFocused()
})

test("Home shows loaded sessions before the location request resolves", async ({ page }) => {
  const location = await holdRoute(page, (url) => url.pathname === "/api/location")
  await openHome(page)
  await expectAppVisible(row(page, fixture.expected.sourceTitle))
  location.release()
})

test("Home and the directory picker load without newer browser APIs", async ({ page }) => {
  await page.addInitScript(() => {
    // Safari 16.6 has none of these APIs. Remove them before the web entry runs.
    // SAFETY: `Partial` only makes the static method optional so `delete` type-checks; the target is the real global.
    delete (Map as Partial<typeof Map>).groupBy
    // SAFETY: as above, for the real global `Promise`.
    delete (Promise as Partial<typeof Promise>).withResolvers
    // SAFETY: as above, for the real global `Promise`.
    delete (Promise as Partial<typeof Promise>).try
  })
  await openHome(page, { fileList: () => [] })
  const target = row(page, fixture.expected.targetTitle)
  await expect(target).toBeVisible()

  await page.getByRole("button", { name: "Add project", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(target).toBeVisible()
})

test("adding a project to a signed-out server re-pairs it, then continues at the paired address", async ({ page }) => {
  // The saved address rejects the new token, so saving moves the server to the link's address.
  const paired = "http://127.0.0.1:4098"
  await mockRemoteServer(page, { name: "Remote", password: "old-password" })
  await mockOpenCodeServer(page, {
    server: paired,
    directory: "/remote/paired",
    project: project({ id: "proj_paired", directory: "/remote/paired" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
    password: "session-token",
    pairing: { code: "one-time-code", token: "session-token" },
  })
  await openHome(page, { fileList: () => [] })
  const remote = page.locator("[data-home-row]").filter({ hasText: "Remote" })
  await expect(page.getByRole("button", { name: "Authenticate", exact: true })).toBeVisible()

  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Edit server" })
  await editor.getByLabel("Pairing link", { exact: true }).fill(`${paired}/auth/connect/one-time-code`)
  await editor.getByRole("button", { name: "Save", exact: true }).click()

  // The folder picker reads the paired address; the removed one would reject the request.
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Select folder" }) })
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect(picker.getByText("Unable to read this folder")).toHaveCount(0)
})

test("a server whose saved password changes works with the new password", async ({ page }) => {
  const accepted = { password: "old-password" }
  await mockOpenCodeServer(page, {
    server: REMOTE_SERVER,
    directory: "/remote/project",
    project: project({ id: "proj_remote", directory: "/remote/project" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
    password: () => accepted.password,
  })
  // Saved with the password the server accepts until the test changes it.
  await seed(page, {
    storage: {
      "opencode.global.dat:server": {
        list: [{ type: "http", displayName: "Remote", http: { url: REMOTE_SERVER, password: "old-password" } }],
      },
    },
  })
  await openHome(page, { fileList: () => [] })
  const remote = page.locator("[data-home-row]").filter({ hasText: "Remote" })
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Select folder" }) })

  // Use the server once, so its controller exists with the old password.
  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await picker.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(picker).toHaveCount(0)

  await remote.getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Edit server" })
  await editor.getByPlaceholder("password").fill("new-password")
  // The server now rejects the old password, as after `opencode service set password`.
  accepted.password = "new-password"
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor).toHaveCount(0)

  // The picker reads the folder through the server's controller, which must use the saved password now.
  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect(picker.getByText("Unable to read this folder")).toHaveCount(0)
})

const recovery = "C:/OpenCode/Worktrees/project-menu-recovery"

const worktree =
  "C:/OpenCode/Worktrees/project-42/long-folder-name-for-checking-wrapped-worktree-paths/another-long-folder-name"

for (const state of [
  { name: "local", directory: fixture.directory, icon: "monitor" },
  { name: "worktree", directory: worktree, icon: "outline-worktree" },
  { name: "closed worktree", directory: recovery, icon: "outline-worktree", recovery: "closed" },
  { name: "unopened worktree", directory: recovery, icon: "outline-worktree", recovery: "unopened" },
]) {
  test(`the session project menu opens settings and Home for a ${state.name} project`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const workspace = state.directory !== fixture.directory
    const messages = Promise.withResolvers<void>()
    await mockStressTimeline(page, {
      directory: state.directory,
      // An image icon keeps the avatar initial out of the menu item text.
      project: {
        ...fixture.project,
        sandboxes: workspace ? [state.directory] : [],
        icon: {
          url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>')}`,
        },
      },
      sessions: fixture.sessions.map((item) => ({ ...item, directory: state.directory })),
      beforeMessagesResponse: (input) =>
        state.recovery && input.sessionID === fixture.targetID ? messages.promise : Promise.resolve(),
    })

    // An unopened project has no stored project list or tabs.
    if (state.recovery !== "unopened")
      await seed(page, {
        projects: { local: [{ worktree: fixture.directory, expanded: true }] },
        lastProject: { local: fixture.directory },
        tabs: [fixture.sourceID, fixture.targetID],
      })
    const name = fixture.project.name

    if (state.recovery === "closed") {
      await page.goto("/")
      const project = page.locator('[data-component="home-project-row"]').filter({ hasText: name })
      await project.locator("..").getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menuitem", { name: "Close", exact: true }).click()
      await expect(project).toHaveCount(0)
      await page.locator(`[data-titlebar-tab-link][href="${sessionHref(fixture.targetID)}"]`).click()
    }

    if (state.recovery !== "closed") await page.goto(sessionHref(fixture.targetID))

    const header = page.locator("[data-session-title]")
    const trigger = header.getByRole("button", { name, exact: true })
    const menu = page.getByRole("menu", { name, exact: true })
    const projectItem = menu.getByRole("menuitem", { name, exact: true })
    const pathItem = menu.getByRole("menuitem", { name: state.directory, exact: true })
    const settings = page.getByTestId("settings-screen")
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)

    for (const loaded of state.recovery ? [false, true] : [true]) {
      if (state.recovery && loaded) {
        messages.resolve()
        await expect(header.getByRole("button", { name: "More options", exact: true })).toBeVisible()
      }

      await expect(trigger.locator("use")).toHaveAttribute("href", `#opencode-v2-icon-${state.icon}`)
      await trigger.click()
      await expect(menu.getByRole("menuitem")).toHaveText([name, state.directory, "Edit project"])
      await expect(pathItem).toBeDisabled()
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press("ArrowDown")
      await expect(projectItem).toBeFocused()
      await page.keyboard.press("ArrowDown")
      await expect(pathItem).toBeFocused()

      for (const key of ["Enter", "Space"]) {
        await page.keyboard.press(key)
        await expect(menu).toBeVisible()
        await expect(pathItem).toBeFocused()
      }

      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      await expect(settings.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(name)
      await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
      await settings.getByRole("button", { name: "Back to app", exact: true }).click()
      await expect(settings).toBeHidden()
    }

    await trigger.click()
    await projectItem.click()
    await expect(page).toHaveURL(new URL("/", page.url()).href)
    const project = page.locator('[data-component="home-project-row"]').filter({ hasText: name })
    await expect(project).toHaveAttribute("data-selected", "")
    await expect(
      page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`),
    ).toBeVisible()
  })
}

test("the project menu path arrow has a glyph when the page has an older icon sprite", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, { projects: { local: [{ worktree: fixture.directory, expanded: true }] }, tabs: [fixture.targetID] })
  // A page cached before the arrow icon shipped carries a sprite without it.
  await page.route(
    (url) => url.pathname === sessionHref(fixture.targetID),
    async (route) => {
      const response = await route.fetch()
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          '<div id="root"',
          '<svg id="opencode-v2-icon-sprite" width="0" height="0" aria-hidden="true"><symbol id="opencode-v2-icon-monitor" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></symbol></svg><div id="root"',
        ),
      })
    },
  )
  await page.goto(sessionHref(fixture.targetID))
  const header = page.locator("[data-session-title]")
  await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)
  await header.getByRole("button", { name: fixture.project.name, exact: true }).click()

  const arrow = page
    .getByRole("menu")
    .getByRole("menuitem", { name: fixture.directory, exact: true })
    .locator('[data-slot="session-project-open-icon"]')

  await expect(arrow).toHaveCount(1)
  await expect
    .poll(() => arrow.locator("svg").evaluate((element: SVGSVGElement) => element.getBBox().width))
    .toBeGreaterThan(0)
  await expect(page.locator("#opencode-v2-icon-sprite")).toHaveCount(1)
})

// Two isolated browser contexts on one server: A opened the fixture project, B is a fresh browser with empty storage.
const betaDirectory = "/srv/beta"

const betaName = "beta-project"

const betaProject = project({ id: "proj_beta", directory: betaDirectory, name: betaName })

const projectRow = (page: Page, name: string) =>
  page.locator('[data-component="home-project-row"]').filter({ hasText: name })

async function sharedClients(browser: Browser, baseURL: string | undefined, input: Partial<MockServerConfig> = {}) {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL, serviceWorkers: "block" })))
  const [a, b] = await Promise.all(contexts.map((context) => context.newPage()))

  const sessions = [
    ...fixture.sessions.map((item) => ({ ...item })),
    session({ id: "ses_beta", directory: betaDirectory, projectID: betaProject.id, title: "Beta plan" }),
  ]

  const server = await mockSharedServer([a, b], {
    sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    projects: [{ ...fixture.project, canonical: fixture.directory }, betaProject],
    pageMessages,
    fileList: () => [],
    eventRetry: 20,
    ...input,
  })

  await seed(a, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
  })

  return { a, b, sessions, server, close: () => Promise.all(contexts.map((context) => context.close())) }
}

async function expectDiscovered(page: Page) {
  await expect(projectRow(page, fixture.project.name)).toBeVisible()
  await expect(projectRow(page, betaName)).toBeVisible()
  await expect(row(page, fixture.expected.targetTitle)).toBeVisible()
  await expect(row(page, "Beta plan")).toBeVisible()
}

test("a fresh browser discovers the server's projects and sessions after reload and cleared storage", async ({
  browser,
  baseURL,
}) => {
  const { a, b, close } = await sharedClients(browser, baseURL)
  await b.goto("/")
  await expectDiscovered(b)
  // Discovery reads the server; it does not copy the inventory into this browser's own project list.
  const stored = await b.evaluate(() => localStorage.getItem("opencode.global.dat:server"))
  expect(JSON.parse(stored ?? "{}").projects?.local ?? []).toEqual([])

  await b.reload()
  await expectDiscovered(b)
  await b.evaluate(() => localStorage.clear())
  await b.reload()
  await expectDiscovered(b)

  // Closing a discovered project is this browser's preference: it stays hidden here and listed elsewhere.
  await projectRow(b, betaName).locator("..").getByRole("button", { name: "More options", exact: true }).click()
  await b.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(projectRow(b, betaName)).toHaveCount(0)
  await b.reload()
  await expect(projectRow(b, fixture.project.name)).toBeVisible()
  await expect(projectRow(b, betaName)).toHaveCount(0)
  await a.goto("/")
  await expect(projectRow(a, betaName)).toBeVisible()
  await close()
})

test("a session created in one browser appears in another, which opens the same conversation", async ({
  browser,
  baseURL,
}) => {
  const { a, b, close } = await sharedClients(browser, baseURL, { createdSessionTitle: "Created in browser A" })
  await Promise.all([a.goto("/"), b.goto("/")])
  await expectDiscovered(b)
  await expect(row(b, "Created in browser A")).toHaveCount(0)

  await projectRow(a, fixture.project.name).hover()
  await a
    .locator('[data-home-project-row-container], [data-component="home-project-row"]')
    .filter({ hasText: fixture.project.name })
    .locator("..")
    .locator('[data-action="home-project-new-session"]')
    .click()
  const editor = a.locator('[data-component="composer-editor"]')
  await editor.fill("Plan the shared rollout")
  await a.locator('[data-action="composer-submit"]').click()
  await expect(a).toHaveURL(/\/session\/ses_[^/]+$/)
  const createdID = new URL(a.url()).pathname.split("/").at(-1)!

  // B learns about the session from the server, without its URL.
  const created = b.locator(`[data-component="home-session-row-container"][data-session-id="${createdID}"]`)
  await expect(created).toContainText("Created in browser A")

  // Both browsers open the same stored conversation.
  for (const page of [a, b]) {
    await page.goto("/")
    await row(page, fixture.expected.targetTitle).click()
    await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
    await expect(
      page.locator(`[data-timeline-row="UserMessage"][data-message-id="${fixture.expected.targetMessageIDs.at(-1)}"]`),
    ).toBeVisible()
  }

  await close()
})

test("renames and deletes in one browser reach another browser's Home", async ({ browser, baseURL }) => {
  const { a, b, close } = await sharedClients(browser, baseURL)
  await Promise.all([a.goto("/"), b.goto("/")])
  await expect(row(b, fixture.expected.targetTitle)).toBeVisible()

  await row(a, fixture.expected.targetTitle).click({ button: "right" })
  await a.getByRole("menuitem", { name: "Rename" }).click()
  const title = a.locator('[data-component="home-session-rename"]')
  await title.fill("Renamed in browser A")
  await title.press("Enter")
  await expect(row(b, "Renamed in browser A")).toBeVisible()
  await expect(row(b, fixture.expected.targetTitle)).toHaveCount(0)

  await row(a, "Renamed in browser A").click({ button: "right" })
  await a.getByRole("menuitem", { name: "Delete…" }).click()
  await a.getByRole("dialog").getByRole("button", { name: "Delete session" }).click()
  await expect(row(a, "Renamed in browser A")).toHaveCount(0)
  await expect(row(b, "Renamed in browser A")).toHaveCount(0)
  await expect(row(b, "Beta plan")).toBeVisible()
  await close()
})

test("a project the server registers while a browser is open appears there", async ({ browser, baseURL }) => {
  const delta = project({ id: "proj_delta", directory: "/srv/delta", name: "delta-project" })
  const projects: unknown[] = [{ ...fixture.project, canonical: fixture.directory }, betaProject]
  const { b, sessions, server, close } = await sharedClients(browser, baseURL, { projects: () => projects })
  await b.goto("/")
  await expectDiscovered(b)
  await expect(projectRow(b, "delta-project")).toHaveCount(0)

  // Another client's first session in a new directory registers it; the server announces it with project.updated.
  // The real server lists the new project and publishes session.created for the session; it sends no project.updated.
  projects.push(delta)
  const created = session({ id: "ses_delta", directory: "/srv/delta", projectID: delta.id, title: "Delta plan" })
  sessions.push(created)
  server.publish([
    {
      id: "evt_session_delta",
      created: Date.now(),
      type: "session.created",
      location: { directory: "/srv/delta" },
      durable: { aggregateID: created.id, seq: 1, version: 1 },
      data: {
        sessionID: created.id,
        projectID: delta.id,
        location: { directory: "/srv/delta" },
        slug: "delta-plan",
        title: created.title,
        version: "local",
      },
    },
  ])
  await expect(projectRow(b, "delta-project")).toBeVisible()
  await expect(row(b, "Delta plan")).toBeVisible()
  await close()
})

test("a session deleted in one browser leaves another browser's Home", async ({ browser, baseURL }) => {
  const { a, b, close } = await sharedClients(browser, baseURL)
  await Promise.all([a.goto("/"), b.goto("/")])
  // B knows this row only from its fetched session index.
  await expect(row(b, fixture.expected.sourceTitle)).toBeVisible()

  await row(a, fixture.expected.sourceTitle).click({ button: "right" })
  await a.getByRole("menuitem", { name: "Delete…" }).click()
  await a.getByRole("dialog").getByRole("button", { name: "Delete session" }).click()
  await expect(row(a, fixture.expected.sourceTitle)).toHaveCount(0)
  await expect(row(b, fixture.expected.sourceTitle)).toHaveCount(0)
  await expect(row(b, "Beta plan")).toBeVisible()
  await close()
})

test("a browser reconnecting to the server lists sessions created while it was offline", async ({
  browser,
  baseURL,
}) => {
  const { b, sessions, server, close } = await sharedClients(browser, baseURL)
  await b.goto("/")
  await expectDiscovered(b)
  const before = (await server.transports[1]!.connections()).length

  // Another client created this while B's stream was down, so B never receives its event.
  sessions.push(
    session({ id: "ses_offline", directory: betaDirectory, projectID: betaProject.id, title: "Made offline" }),
  )
  await server.transports[1]!.disconnect()
  await server.transports[1]!.waitForConnection({ after: before })
  await expect(row(b, "Made offline")).toBeVisible()
  await close()
})

test("projects, sessions, and worktrees stay with their own server and project", async ({ browser, baseURL }) => {
  const { b, close } = await sharedClients(browser, baseURL)
  const remoteDirectory = "/remote/gamma"
  await mockOpenCodeServer(b, {
    server: REMOTE_SERVER,
    directory: remoteDirectory,
    project: project({ id: "proj_gamma", directory: remoteDirectory, name: "gamma-remote" }),
    provider: NO_PROVIDER,
    sessions: [session({ id: "ses_gamma", directory: remoteDirectory, projectID: "proj_gamma", title: "Gamma plan" })],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
  })
  await seed(b, { servers: [{ url: REMOTE_SERVER, name: "Remote" }] })
  await b.goto("/")
  await expectDiscovered(b)
  // Each server lists only its own projects, under its own row, and the focused server only its own sessions.
  await expect(b.locator("[data-home-row]")).toHaveText([
    /127\.0\.0\.1:4096/,
    new RegExp(betaName),
    new RegExp(fixture.project.name),
    /Remote/,
    /gamma-remote/,
  ])
  await expect(row(b, "Gamma plan")).toHaveCount(0)
  await b
    .locator("[data-home-row]")
    .filter({ hasText: "Remote" })
    .getByRole("button", { name: /Remote/ })
    .click()
  await expect(row(b, "Gamma plan")).toBeVisible()
  await expect(row(b, "Beta plan")).toHaveCount(0)
  await b.locator("[data-home-row]").filter({ hasText: "4096" }).getByRole("button", { name: /4096/ }).click()
  await expect(row(b, "Beta plan")).toBeVisible()

  // Selecting a project scopes the sessions to its directories.
  await projectRow(b, betaName).click()
  await expect(row(b, "Beta plan")).toBeVisible()
  await expect(row(b, fixture.expected.targetTitle)).toHaveCount(0)
  await projectRow(b, fixture.project.name).click()
  await expect(row(b, fixture.expected.targetTitle)).toBeVisible()
  await expect(row(b, "Beta plan")).toHaveCount(0)
  await close()
})

test("a failed project or session fetch does not erase projects, sessions, or the selection", async ({
  browser,
  baseURL,
}) => {
  const { a, close } = await sharedClients(browser, baseURL)
  await a.goto("/")
  await expectDiscovered(a)
  await projectRow(a, betaName).click()
  await expect(projectRow(a, betaName)).toHaveAttribute("data-selected", "")

  // The server inventory answers after storage loads; the restored selection must wait for it.
  const projects = await holdRoute(a, (url) => url.pathname === "/api/project")
  await a.reload()
  await projects.arrived
  // Until the server answers, the opened project shows its folder name.
  await expect(projectRow(a, "SmokeProject")).toBeVisible()
  await expect(projectRow(a, betaName)).toHaveCount(0)
  projects.release()
  await expect(projectRow(a, betaName)).toHaveAttribute("data-selected", "")
  await a.unroute((url) => url.pathname === "/api/project")

  const fail = (url: URL) => url.pathname === "/api/project" || url.pathname === "/api/session"
  await a.route(fail, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 500, json: { name: "UnknownError", data: { message: "offline" } } })
      : route.fallback(),
  )
  const failed = a.waitForResponse((response) => fail(new URL(response.url())) && response.status() === 500)
  await a.reload()
  await failed
  // The project this browser opened stays listed, and its stored list is not overwritten.
  await expect(projectRow(a, "SmokeProject")).toBeVisible()
  const stored = await a.evaluate(() => localStorage.getItem("opencode.global.dat:server"))
  expect(JSON.parse(stored ?? "{}").projects.local).toEqual([{ worktree: fixture.directory, expanded: true }])

  await a.unroute(fail)
  await a.reload()
  // The selection survived the failure, so the list is scoped to the selected project again.
  await expect(projectRow(a, fixture.project.name)).toBeVisible()
  await expect(projectRow(a, betaName)).toHaveAttribute("data-selected", "")
  await expect(row(a, "Beta plan")).toBeVisible()
  await expect(row(a, fixture.expected.targetTitle)).toHaveCount(0)
  await close()
})
