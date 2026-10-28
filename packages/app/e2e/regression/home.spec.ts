import type { OpenCodeEvent } from "@opencode/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { expectPath, holdRoute, NO_PROVIDER, project, REMOTE_SERVER, seed, sessionHref, T0 } from "../utils/app"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { mockRemoteServer, mockWorkspace, newSessionLocation } from "../utils/workspace"
import { APP_READY_TIMEOUT, expectAppVisible } from "../utils/waits"

test.use({ serviceWorkers: "block" })

const row = (page: Page, title: string) =>
  page.locator('[data-component="home-session-row"]').filter({ hasText: title })

async function openHome(page: Page, input: Parameters<typeof mockStressTimeline>[1] = {}) {
  await mockStressTimeline(page, input)
  await seed(page, { usedProjects: { local: [fixture.project.id] } })
  await page.goto("/")
}

test("Home keeps the session list in every interface mode", async ({ page }) => {
  const earlier = { id: "ses_home_earlier", title: "Finished earlier" }
  await mockWorkspace(page, { name: "Home", sessions: [earlier] })
  await page.goto("/")
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  await expect(search).toBeVisible()
  await expect(row(page, earlier.title)).toBeVisible()

  // The Inbox mode moves session tabs into the sidebar inbox; Home stays the session list.
  for (const mode of ["Side tabs", "Inbox", "Top tabs"]) {
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    const option = settings.getByRole("radio", { name: mode, exact: true })
    await settings.getByRole("group", { name: "Interface", exact: true }).getByText(mode, { exact: true }).click()
    await expect(option).toBeChecked()
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(page).toHaveURL("/")
    await expect(search).toBeVisible()
    await expect(row(page, earlier.title)).toBeVisible()
  }
})

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
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused()

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

const entry = (name: string, active: number, id = `proj_${name}`) =>
  project({
    id,
    directory: `C:/OpenCode/${name}`,
    name,
    time: { created: T0, updated: T0, active: T0 + active },
  })

async function homeProjects(page: Page, projects: unknown[]) {
  const directory = "C:/OpenCode/home"

  const server = await mockOpenCodeServer(page, {
    directory,
    project: project({ id: "proj_home", directory }),
    projects: () => projects,
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })

  return { server, rows: page.locator('[data-component="home-project-row"] [data-slot="home-row-label"]') }
}

test("Home lists the used server projects by recent activity, hides them, and lists them again once used", async ({
  page,
}) => {
  // `recent` was first resolved under another ID, so one directory has two projects.
  const listed = [entry("unused", 4), entry("recent", 3), entry("older", 2), entry("oldest", 1)]
  listed.push(entry("recent", 0, "proj_recent_before_git"))
  const view = await homeProjects(page, listed)
  await seed(page, { usedProjects: { local: ["proj_recent_before_git", "proj_older", "proj_oldest"] } })
  await page.goto("/")
  await expect(view.rows).toHaveText(["recent", "older", "oldest"])

  // Activity moves a project up and an archived project leaves; a project this client never used stays out.
  const active = { ...listed[3]!, time: { ...listed[3]!.time, active: T0 + 5 } }
  const archived = { ...listed[2]!, time: { ...listed[2]!.time, archived: T0 + 6 } }
  const fresh = entry("fresh", 7)
  listed.splice(0, listed.length, fresh, active, listed[0]!, listed[1]!, listed[4]!)
  await view.server.push(
    [active, archived, fresh].map(
      (data, index): OpenCodeEvent => ({
        id: `evt_home_project_${index}`,
        created: T0 + index,
        type: "project.updated",
        data,
      }),
    ),
  )
  await expect(view.rows).toHaveText(["oldest", "recent"])

  const recent = page.locator('[data-component="home-project-row"]').filter({ hasText: "recent" })
  await recent.locator("..").getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(view.rows).toHaveText(["oldest"])

  // The location dialog lists every server project once: used ones first, then the rest, each by recency.
  await page
    .locator('[data-component="home-project-row"]')
    .filter({ hasText: "oldest" })
    .locator("..")
    .getByRole("button", { name: "New session", exact: true })
    .click()
  await newSessionLocation(page).click()
  const options = page.getByRole("dialog").getByRole("option")
  await expect(options.locator(".command-palette-title")).toHaveText([
    "Add project",
    "oldest",
    "fresh",
    "unused",
    "recent",
  ])
  await options.filter({ hasText: "C:/OpenCode/recent" }).click()
  await expect(newSessionLocation(page)).toContainText("recent")
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(view.rows).toHaveText(["oldest", "recent"])
})

test("Home migrates the directories an older build listed to the server's current projects", async ({ page }) => {
  const view = await homeProjects(page, [
    entry("api", 3),
    entry("web", 2),
    entry("api", 1, "proj_api_before_remote"),
    entry("docs", 0),
  ])

  await seed(page, {
    legacyProjects: {
      local: [
        { worktree: "C:/OpenCode/api", expanded: true },
        { worktree: "C:/OpenCode/web/packages/app" },
        { worktree: "C:/OpenCode/gone" },
      ],
    },
  })
  await page.goto("/")
  await expect(view.rows).toHaveText(["api", "web"])
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}")))
    .toMatchObject({ usedProjectIDs: { local: ["proj_api", "proj_web"] }, projects: {} })
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
  { name: "local", directory: fixture.directory },
  { name: "worktree", directory: worktree, worktree: "another-long-folder-name" },
  { name: "unopened worktree", directory: recovery, worktree: "project-menu-recovery", recovery: "unopened" },
]) {
  test(`the session location card opens settings and Home for a ${state.name} project`, async ({ page }) => {
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

    // An unopened project has no stored tabs.
    if (state.recovery !== "unopened") await seed(page, { tabs: [fixture.sourceID, fixture.targetID] })
    const name = fixture.project.name
    await page.goto(sessionHref(fixture.targetID))

    const header = page.locator("[data-session-title]")
    const trigger = header.locator('[data-slot="session-location-trigger"]')
    const menu = page.locator('[data-slot="session-location-card"]')
    const projectItem = menu.getByRole("menuitem", { name, exact: true })
    const settings = page.getByTestId("settings-screen")
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)

    for (const loaded of state.recovery ? [false, true] : [true]) {
      if (state.recovery && loaded) {
        messages.resolve()
        await expect(header.getByRole("button", { name: "Session details", exact: true })).toBeVisible()
      }

      await expect(trigger.locator('[data-slot="session-location-project"]')).toHaveText(name)
      await expect(trigger.locator('[data-slot="session-location-worktree"]')).toHaveText(
        state.worktree ? [state.worktree] : [],
      )
      await trigger.click()
      await expect(menu.locator('[data-slot="session-location-path"]')).toHaveText(state.directory)
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press("ArrowDown")
      await expect(projectItem).toBeFocused()
      await menu.getByRole("menuitem", { name: "Edit project", exact: true }).press("Enter")
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
