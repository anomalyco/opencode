import { expect, test, type Page } from "@playwright/test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import {
  NO_PROVIDER,
  REMOTE_SERVER,
  SERVER,
  T0,
  draftHref,
  expectPath,
  holdRoute,
  pageMessagesFrom,
  project,
  seed,
  session,
  sessionHref,
  tabKey,
} from "../utils/app"
import { openFileLauncher, reviewTabs } from "../utils/side-panel"
import { mockServers } from "../utils/mock-server"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { fileNode, mockWorkspace, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"
import { openWithDirection } from "../utils/direction"

const a = { id: "ses_tab_a", title: "Tab A session" }

const b = { id: "ses_tab_b", title: "Tab B session" }

const c = { id: "ses_tab_c", title: "Tab C session" }

test.use({ serviceWorkers: "block" })

for (const locale of ["en", "ar"] as const) {
  test(`Side bar keeps opposite-direction titles clear of the close affordance in ${locale}`, async ({ page }) => {
    await mockWorkspace(page, {
      name: "Mixed direction",
      sessions: [{ ...a, title: locale === "ar" ? "Project task" : "مهمة المشروع" }],
      seed: { locale, tabs: [a.id], settings: { appearance: { tabLayout: "sidebar" } } },
    })
    await page.goto(sessionHref(a.id))
    const link = page.locator(`[data-slot="vertical-tabs-sidebar"] a[href="${sessionHref(a.id)}"]`)
    await expect(link).toBeVisible()
    await link.hover()
    await expect
      .poll(() =>
        link.evaluate((element) => {
          const title = element.querySelector("[data-titlebar-tab-title]")
          if (!title) throw new Error("Missing session title")
          const range = document.createRange()
          range.selectNodeContents(title)
          const text = range.getBoundingClientRect()
          const row = element.getBoundingClientRect()
          return getComputedStyle(element).direction === "rtl" ? text.left - row.left : row.right - text.right
        }),
      )
      .toBeGreaterThan(40)
  })
}

test("Side bar keeps project history and running sessions separate from the official interface modes", async ({
  page,
}) => {
  await mockWorkspace(page, {
    name: "ModeBoundary",
    project: { id: "proj_used", name: "Used project" },
    sessions: [{ ...a, time: { created: T0, updated: T0, idle: T0 } }, b, c],
    sessionStatus: { [c.id]: { type: "running" } },
    projects: [
      project({ id: "proj_used", directory: "C:/OpenCode/ModeBoundary", name: "Used project" }),
      project({ id: "proj_incidental", directory: "C:/", name: "Automatic directory" }),
    ],
    seed: {
      tabs: [a.id],
      usedProjects: { local: ["proj_used"] },
      settings: { appearance: { tabLayout: "vertical", tabGrouping: "project" } },
    },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const running = page.locator('[data-component="active-sessions"]')
  const projectRows = page.locator('[data-component="home-project-row"] [data-slot="home-row-label"]')
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([a.title])
  await expect(running).toHaveCount(0)
  await expect(sidebar.getByRole("heading", { name: "Recent sessions", exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole("button", { name: "Group sessions By project", exact: true })).toHaveCount(0)
  await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(a.id)}"]`).hover()
  const preview = page.locator('[data-component="session-tab-popover"]')
  await expect(preview).toContainText(a.title)
  await expect(preview).not.toContainText(/Branch:|Worktree:|Last run/)
  await sidebar.getByRole("button", { name: "Home", exact: true }).click()
  await expect(projectRows).toHaveText(["Used project"])

  for (const mode of ["Side bar", "Side tabs", "Inbox", "Top tabs", "Side bar"]) {
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    const interfaces = settings.getByRole("group", { name: "Interface layout", exact: true })
    await expect(interfaces.getByRole("radio")).toHaveCount(4)
    await interfaces.getByText(mode, { exact: true }).click()
    await expect(interfaces.getByRole("radio", { name: mode, exact: true })).toBeChecked()
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(running).toHaveCount(mode === "Side bar" ? 1 : 0)
    await expect(projectRows).toHaveText(
      mode === "Side bar" ? ["Used project", "Automatic directory"] : ["Used project"],
    )
    if (mode === "Side tabs") await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([a.title])
    if (mode === "Side bar") {
      await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveCount(3)
      await expect(running.getByRole("button").filter({ hasText: c.title })).toBeVisible()
      await expect(sidebar.getByRole("heading", { level: 3 })).toHaveText(["Automatic directory", "Used project"])
    }
  }
  await page.reload()
  await expect(running).toBeVisible()
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveCount(3)
  await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click()
  await expectPath(page, sessionHref(b.id))
  await expectSessionTitle(page, b.title)
})

test("Running sessions retains known shells after model execution finishes", async ({ page }) => {
  const status = { [b.id]: { type: "running" } }
  const shell = {
    id: "sh_legacy",
    status: "running",
    command: "Run checks",
    cwd: "C:/OpenCode/Legacy activity",
    shell: "pwsh.exe",
    file: "C:/OpenCode/Legacy activity/shell.out",
    metadata: { sessionID: b.id },
    time: { started: T0 },
  }
  let shells = [shell]
  const workspace = await mockWorkspace(page, {
    name: "Legacy activity",
    sessions: [a, b],
    sessionStatus: () => status,
    shellCommands: () => shells,
    seed: { tabs: [a.id], settings: { appearance: { tabLayout: "sidebar" } } },
  })
  await page.goto(sessionHref(b.id))
  const running = page.getByRole("region", { name: "Running sessions", exact: true })
  await expect(running.getByRole("button")).toHaveCount(1)
  await expect(running.getByRole("button")).toContainText(b.title)
  await expect(running).not.toContainText("Activity status is unavailable")
  status[b.id]!.type = "idle"
  await workspace.push([
    {
      id: "evt_legacy_activity_finished",
      created: T0 + 1,
      type: "session.execution.succeeded",
      durable: { aggregateID: b.id, seq: 1, version: 1 },
      data: { sessionID: b.id },
    },
  ])
  await expect(running.getByRole("button")).toHaveCount(1)
  await expect(running.getByRole("button")).toContainText("Background work")
  await expect(running.getByRole("button")).toHaveAttribute("title", /1 background shell/)
  await expect(page.getByRole("status", { name: "Background work", exact: true })).toBeVisible()
  await page.reload()
  await expect(running.getByRole("button")).toContainText("Background work")
  await expect(page.getByRole("status", { name: "Background work", exact: true })).toBeVisible()
  shells = []
  await workspace.push([
    {
      type: "shell.exited",
      id: "evt_legacy_shell_done",
      created: T0 + 2,
      location: { directory: workspace.directory },
      data: { id: shell.id, exit: 0, status: "exited" },
    },
  ])
  await expect(running.getByText("No running sessions", { exact: true })).toBeVisible()
  await expect(page.getByRole("status", { name: "Background work", exact: true })).toHaveCount(0)
  await expect(running).not.toContainText("Activity status is unavailable")
})

test("sidebar and Home share projects and history without opening session tabs", async ({ page }) => {
  await mockWorkspace(page, {
    name: "SharedHistory",
    sessions: [a, b],
    projects: [
      project({ id: "proj_sharedhistory", directory: "C:/OpenCode/SharedHistory", name: "Shared history" }),
      project({ id: "proj_empty", directory: "C:/OpenCode/Empty", name: "Empty project" }),
    ],
    seed: {
      tabs: [],
      usedProjects: { local: [] },
      settings: { appearance: { tabLayout: "sidebar" } },
    },
  })
  await page.goto("/")
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const home = page.locator('[data-slot="home-panel"]')
  const titles = sidebar.locator("[data-titlebar-tab-title]")
  const homeRow = (title: string) => home.locator('[data-component="home-session-row"]').filter({ hasText: title })
  await expect(homeRow(a.title)).toBeVisible()
  await expect(homeRow(b.title)).toBeVisible()
  await expect(titles).toHaveText([a.title, b.title])
  await expect(sidebar.getByRole("heading", { level: 3 })).toHaveText(["Empty project", "Shared history"])
  await expect(sidebar.getByRole("button", { name: "Close tab", exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole("heading", { name: "Recent sessions", exact: true })).toBeVisible()
  await expect(sidebar.getByRole("button", { name: "Group sessions By project", exact: true })).toBeVisible()
  await expect(home.locator('[data-component="home-project-row"] [data-slot="home-row-label"]')).toHaveText([
    "Shared history",
    "Empty project",
  ])

  for (const mode of ["Top tabs", "Side bar"]) {
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    await settings.getByRole("group", { name: "Interface layout", exact: true }).getByText(mode, { exact: true }).click()
    await expect(settings.getByRole("radio", { name: mode, exact: true })).toBeChecked()
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(homeRow(a.title)).toBeVisible()
  }
  await expect(titles).toHaveText([a.title, b.title])

  await homeRow(a.title).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const rename = home.locator('[data-component="home-session-rename"]')
  await rename.fill("Shared rename")
  await rename.press("Enter")
  await expect(titles).toHaveText(["Shared rename", b.title])
  await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click()
  await expectPath(page, sessionHref(b.id))
  await expectSessionTitle(page, b.title)
  await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expectPath(page, "/")
  await expect(titles).toHaveText(["Shared rename"])
  await expect(homeRow(b.title)).toBeVisible()
  await page.reload()
  await expect(titles).toHaveText(["Shared rename"])
  await expect(homeRow(b.title)).toBeVisible()
  await sidebar.getByRole("button", { name: "Search sessions", exact: true }).click()
  const search = page.getByRole("dialog")
  await search.getByRole("combobox").fill(b.title)
  await expect(search.getByRole("option")).toContainText(b.title)
  await search.getByRole("option").click()
  await expectPath(page, sessionHref(b.id))
  await expect(titles).toHaveText(["Shared rename", b.title])
  await sidebar.getByRole("button", { name: "Home", exact: true }).click()

  await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(a.id)}"]`).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete session…", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete session", exact: true }).click()
  await expect(titles).toHaveText([b.title])
  await expect(homeRow("Shared rename")).toHaveCount(0)
  await expect(sidebar.getByRole("heading", { level: 3 })).toHaveText(["Empty project", "Shared history"])
  await expect(sidebar.getByText("1/1", { exact: true })).toBeVisible()
  await sidebar.getByRole("heading", { name: "Empty project", exact: true }).hover()
  await sidebar.getByRole("button", { name: "New session in Empty project", exact: true }).click()
  await expect(page.locator('[data-component="new-session"] [data-action="prompt-project"]')).toContainText(
    "Empty project",
  )
  await expect(sidebar.locator('a[data-titlebar-tab-link][href^="/new-session?draftId="]')).toHaveText("Draft (unsent)")
  await expect(sidebar.getByText("0/0", { exact: true })).toBeVisible()
})

test("Side bar sorts project names independently of activity and persists alphabetized pins", async ({ page }) => {
  const projects = ["Zeta", "Beta", "Alpha"].map((name, index) =>
    project({
      id: `proj_order_${name}`,
      directory: `C:/OpenCode/${name}`,
      name,
      time: { created: T0, updated: T0, active: T0 + 3 - index },
    }),
  )
  const workspace = await mockWorkspace(page, {
    name: "ProjectOrder",
    projects: [
      ...projects,
      project({ id: "proj_projectorder", directory: "C:/OpenCode/ProjectOrder", name: "ProjectOrder" }),
    ],
    sessions: [
      ...projects.map((item) => ({
        id: `ses_order_${item.name}`,
        title: `${item.name} task`,
        directory: item.worktree,
        projectID: item.id,
      })),
      {
        id: "ses_order_alpha_newer",
        title: "Alpha newer task",
        directory: projects[2]!.worktree,
        projectID: projects[2]!.id,
        time: { created: T0, updated: T0 + 100 },
      },
    ],
    seed: { tabs: [], settings: { appearance: { tabLayout: "sidebar" } } },
  })
  await page.goto("/")
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const headings = sidebar.getByRole("heading", { level: 3 })
  // The workspace's otherwise empty default project is also part of the server catalogue.
  await expect(headings).toHaveText(["Alpha", "Beta", "ProjectOrder", "Zeta"])
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([
    "Alpha newer task",
    "Alpha task",
    "Beta task",
    "Zeta task",
  ])
  await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref("ses_order_Zeta")}"]`).click()
  await expectSessionTitle(page, "Zeta task")
  const active = { ...projects[0]!, time: { ...projects[0]!.time, active: T0 + 1000 } }
  projects[0] = active
  await workspace.push([{ id: "evt_order_project_active", created: T0 + 1000, type: "project.updated", data: active }])
  await expect(headings).toHaveText(["Alpha", "Beta", "ProjectOrder", "Zeta"])
  await sidebar.getByRole("heading", { name: "Zeta", exact: true }).hover()
  await sidebar.getByRole("button", { name: "Pin project Zeta", exact: true }).click()
  await expect(headings).toHaveText(["Zeta", "Alpha", "Beta", "ProjectOrder"])
  await sidebar.getByRole("heading", { name: "Beta", exact: true }).hover()
  await sidebar.getByRole("button", { name: "Pin project Beta", exact: true }).click()
  await expect(headings).toHaveText(["Beta", "Zeta", "Alpha", "ProjectOrder"])
  await sidebar.getByRole("button", { name: "Collapse project Zeta", exact: true }).click()
  await page.reload()
  await expect(headings).toHaveText(["Beta", "Zeta", "Alpha", "ProjectOrder"])
  await expect(sidebar.getByRole("button", { name: "Unpin project Zeta", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(sidebar.getByRole("button", { name: "Expand project Zeta", exact: true })).toBeVisible()
  await sidebar.getByRole("button", { name: "Unpin project Zeta", exact: true }).click()
  await expect(headings).toHaveText(["Beta", "Alpha", "ProjectOrder", "Zeta"])
  await sidebar.getByRole("button", { name: "Unpin project Beta", exact: true }).click()
  await expect(headings).toHaveText(["Alpha", "Beta", "ProjectOrder", "Zeta"])
})

test("Side bar tracks unread results while project rows are collapsed", async ({ page }) => {
  const sessionStatus = { ses_unread_background: { type: "running" } }
  const workspace = await mockWorkspace(page, {
    name: "UnreadCurrent",
    projects: [
      project({ id: "proj_unread_background", directory: "C:/OpenCode/UnreadBackground", name: "Background" }),
    ],
    sessions: [
      { id: "ses_unread_current", title: "Current task", time: { created: T0, updated: T0, idle: T0, viewed: T0 } },
      {
        id: "ses_unread_background",
        title: "Background task",
        directory: "C:/OpenCode/UnreadBackground",
        projectID: "proj_unread_background",
        time: { created: T0, updated: T0, idle: T0, viewed: T0 },
      },
    ],
    sessionStatus,
    seed: { tabs: ["ses_unread_current"], settings: { appearance: { tabLayout: "sidebar" } } },
  })
  await page.goto(sessionHref("ses_unread_current"))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const running = sidebar.getByRole("region", { name: "Running sessions", exact: true })
  const group = sidebar.getByRole("heading", { name: "Background", exact: true })
  const toggle = page.locator('[data-slot="collapsed-sidebar-toggle"]').getByRole("button")
  await expect(running.getByRole("button").filter({ hasText: "Background task" })).toBeVisible()
  await sidebar.getByRole("button", { name: "Collapse project Background", exact: true }).click()
  await sidebar.getByRole("button", { name: "Collapse project UnreadCurrent", exact: true }).click()
  await expect(sidebar.locator("[data-titlebar-tab-slot]")).toHaveCount(0)
  Object.assign(workspace.sessions[1]!.time, { updated: T0 + 2000, idle: T0 + 2000 })
  sessionStatus.ses_unread_background.type = "idle"
  await workspace.push([
    {
      id: "evt_unread_background_finished",
      created: T0 + 2000,
      type: "session.execution.succeeded",
      durable: { aggregateID: "ses_unread_background", seq: 1, version: 1 },
      data: { sessionID: "ses_unread_background" },
    },
  ])
  await expect(running.locator('[data-slot="active-sessions-empty"]')).toBeVisible()
  await expect(group.getByRole("img", { name: "Unread sessions", exact: true })).toBeVisible()
  await sidebar.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await expect(toggle).toHaveAttribute("aria-label", "Toggle sidebar, unread sessions")
  await toggle.click()
  await page.reload()
  await expect(sidebar.getByRole("button", { name: "Expand project Background", exact: true })).toBeVisible()
  await expect(group.getByRole("img", { name: "Unread sessions", exact: true })).toBeVisible()
  await sidebar.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await expect(toggle).toHaveAttribute("aria-label", "Toggle sidebar, unread sessions")
  Object.assign(workspace.sessions[1]!.time, { viewed: T0 + 2000 })
  await workspace.push([
    {
      id: "evt_unread_background_viewed",
      created: T0 + 3000,
      type: "session.viewed",
      durable: { aggregateID: "ses_unread_background", seq: 2, version: 1 },
      data: { sessionID: "ses_unread_background", idle: T0 + 2000 },
    },
  ])
  await expect(toggle).toHaveAttribute("aria-label", "Toggle sidebar")
  await toggle.click()
  await expect(group.getByRole("img", { name: "Unread sessions", exact: true })).toHaveCount(0)
})

test("Side bar keeps pinned projects fixed while the regular project list scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  const projects = Array.from({ length: 12 }, (_, index) =>
    project({ id: `proj_scroll_${index}`, directory: `C:/OpenCode/Project${index}`, name: `Project ${index}` }),
  )
  await mockWorkspace(page, {
    name: "SidebarScroll",
    projects: [
      ...projects,
      project({ id: "proj_sidebarscroll", directory: "C:/OpenCode/SidebarScroll", name: "SidebarScroll" }),
    ],
    sessions: projects.map((item, index) => ({
      id: `ses_scroll_${index}`,
      title: `Task ${index}`,
      directory: item.worktree,
      projectID: item.id,
    })),
    sessionStatus: Object.fromEntries(
      projects.slice(2, 8).map((_, index) => [`ses_scroll_${index + 2}`, { type: "running" }]),
    ),
    seed: { tabs: [], settings: { appearance: { tabLayout: "sidebar" } } },
  })
  await page.goto("/")
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const scroll = sidebar.locator('[data-slot="vertical-tabs-scroll"]')
  await expect(sidebar.getByRole("heading", { level: 3 })).toHaveCount(13)
  await expect(sidebar.locator('[data-slot="active-sessions-list"] button')).toHaveCount(6)
  await expect.poll(() => scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect(scroll).not.toHaveCSS("scrollbar-width", "none")
  await expect
    .poll(() => scroll.evaluate((element) => getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor))
    .not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/)
  await expect(sidebar.getByRole("heading", { name: "Project 0", exact: true })).toBeInViewport()
  expect(
    await sidebar
      .locator(
        '[data-action="vertical-tabs-home"], [data-action="vertical-tabs-new-session"], [data-action="vertical-tabs-search"]',
      )
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-action"))),
  ).toEqual(["vertical-tabs-home", "vertical-tabs-new-session", "vertical-tabs-search"])
  const heading = sidebar.getByRole("heading", { name: "Project 0", exact: true })
  const pin = sidebar.getByRole("button", { name: "Pin project Project 0", exact: true, includeHidden: true })
  const add = sidebar.getByRole("button", { name: "New session in Project 0", exact: true, includeHidden: true })
  await page.mouse.move(1100, 20)
  await expect(pin).toBeHidden()
  await expect(add).toBeHidden()
  await expect
    .poll(() => heading.evaluate((element) => element.clientWidth === element.parentElement!.clientWidth))
    .toBe(true)
  const width = await heading.evaluate((element) => element.clientWidth)
  await heading.hover()
  await expect(pin).toBeVisible()
  await expect(add).toBeVisible()
  expect((await add.boundingBox())!.x).toBeLessThan((await pin.boundingBox())!.x)
  expect(await heading.evaluate((element) => element.clientWidth)).toBe(width)
  await pin.focus()
  await page.mouse.move(1100, 20)
  await expect(pin).toBeVisible()
  await sidebar.getByRole("button", { name: "Home", exact: true }).focus()
  await expect(pin).toBeHidden()
  await sidebar.getByRole("heading", { name: "Project 0", exact: true }).hover()
  await pin.click()
  await sidebar.getByRole("heading", { name: "Project 1", exact: true }).hover()
  await sidebar.getByRole("button", { name: "Pin project Project 1", exact: true }).click()
  const pinned = sidebar.getByRole("region", { name: "Pinned projects", exact: true })
  await page.mouse.move(1100, 20)
  await sidebar.getByRole("button", { name: "Home", exact: true }).focus()
  await expect(pinned.getByRole("button", { name: "Unpin project Project 0", exact: true })).toBeVisible()
  await expect(pinned.getByRole("button", { name: "Unpin project Project 0", exact: true })).toBeInViewport({
    ratio: 1,
  })
  await expect(
    pinned.getByRole("button", { name: "New session in Project 0", exact: true, includeHidden: true }),
  ).toBeHidden()
  await expect(sidebar.getByRole("heading", { level: 2 })).toHaveText([
    "Pinned projects",
    "Recent sessions",
    "Running sessions",
  ])
  await expect
    .poll(() =>
      pinned.evaluate(
        (element) =>
          element.getBoundingClientRect().height <=
          element.closest('[data-slot="vertical-tabs"]')!.clientHeight * 0.4 + 1,
      ),
    )
    .toBe(true)
  await expect
    .poll(() =>
      pinned
        .locator('[data-slot="sidebar-pinned-scroll"]')
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true)
  await expect(pinned.getByRole("heading", { level: 3 })).toHaveText(["Project 0", "Project 1"])
  await expect(pinned.getByRole("heading", { name: "Project 0", exact: true })).toBeInViewport()
  const position = await pinned.boundingBox()
  if (!position) throw new Error("Pinned projects have no position")
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(sidebar.getByRole("heading", { name: "SidebarScroll", exact: true })).toBeInViewport()
  await expect(sidebar.getByRole("heading", { name: "Project 2", exact: true })).not.toBeInViewport()
  await expect(pinned.getByRole("heading", { name: "Project 0", exact: true })).toBeInViewport()
  expect(await pinned.boundingBox()).toEqual(position)
  await pinned.locator(`a[data-titlebar-tab-link][href="${sessionHref("ses_scroll_0")}"]`).click()
  await expectPath(page, sessionHref("ses_scroll_0"))
  await pinned.getByRole("button", { name: "Unpin project Project 0", exact: true }).click()
  await pinned.getByRole("button", { name: "Unpin project Project 1", exact: true }).click()
  await expect(pinned).toHaveCount(0)
})

test("project headers collapse every session independently of the recent preview and preserve the choice", async ({
  page,
}) => {
  await mockWorkspace(page, {
    name: "Collapse project",
    sessions: Array.from({ length: 7 }, (_, index) => ({ id: `ses_collapse_${index}`, title: `Task ${index}` })),
    seed: { tabs: [], settings: { appearance: { tabLayout: "sidebar" } } },
  })
  await page.goto("/")
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const titles = sidebar.locator("[data-titlebar-tab-title]")
  const collapse = sidebar.getByRole("button", { name: "Collapse project Collapse project", exact: true })
  await expect(titles).toHaveCount(5)
  await expect(collapse).toHaveAttribute("aria-expanded", "true")
  await collapse.focus()
  await page.keyboard.press("Enter")
  await expect(titles).toHaveCount(0)
  await expect(sidebar.getByRole("button", { name: /Show 2 more sessions/ })).toHaveCount(0)
  await expect(sidebar.getByRole("heading", { name: "Collapse project", exact: true })).toBeVisible()
  await expect(sidebar.getByRole("region", { name: "Running sessions", exact: true })).toBeVisible()
  await page.reload()
  await expect(titles).toHaveCount(0)
  await sidebar.getByRole("button", { name: "Expand project Collapse project", exact: true }).click()
  await expect(titles).toHaveCount(5)
  await sidebar.getByRole("button", { name: "Show 2 more sessions in Collapse project", exact: true }).click()
  await expect(titles).toHaveCount(7)
  await collapse.click()
  await expect(titles).toHaveCount(0)
  await sidebar.getByRole("button", { name: "Group sessions By project", exact: true }).click()
  await page.getByRole("option", { name: "List", exact: true }).click()
  await expect(titles).toHaveCount(7)
  await sidebar.getByRole("button", { name: "Group sessions List", exact: true }).click()
  await page.getByRole("option", { name: "By project", exact: true }).click()
  await expect(titles).toHaveCount(0)
  await sidebar.getByRole("heading", { name: "Collapse project", exact: true }).hover()
  await sidebar.getByRole("button", { name: "New session in Collapse project", exact: true }).click()
  await expect(collapse).toHaveAttribute("aria-expanded", "true")
  await expect(titles).toHaveCount(8)
  await expect(page.locator('[data-component="new-session"] [data-action="prompt-project"]')).toContainText(
    "Collapse project",
  )
})

test("recent parents stay busy while descendants execute and busy icons resume after idle", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const child = { id: "ses_busy_descendant", title: "Running child", parentID: a.id }
  const grandchild = { id: "ses_busy_grandchild", title: "Running grandchild", parentID: child.id }
  const workspace = await mockWorkspace(page, {
    name: "Family status",
    sessions: [
      a,
      child,
      grandchild,
      ...Array.from({ length: 24 }, (_, index) => ({ id: `ses_scroll_${index}`, title: `Scroll task ${index}` })),
    ],
    sessionStatus: { [grandchild.id]: { type: "running" } },
    seed: { tabs: [], settings: { appearance: { tabLayout: "sidebar", tabGrouping: "none" } } },
  })
  await page.goto("/")
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tab = sidebar.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`)
  const spinner = tab.locator('[data-component="activity-ring"]')
  await expect(tab.locator("[data-titlebar-tab]")).toHaveAttribute("data-status", "busy")
  await expect(spinner).toBeVisible()
  await spinner.scrollIntoViewIfNeeded()
  await expect(
    page
      .locator('[data-component="home-session-row"]')
      .filter({ hasText: a.title })
      .locator('[data-component="activity-ring"]'),
  ).toBeVisible()
  const animations = (target = spinner) =>
    target.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .map((animation) => ({ state: animation.playState, time: Number(animation.currentTime) })),
    )
  await expect.poll(async () => (await animations()).every((animation) => animation.state === "running")).toBe(true)
  const childSpinner = sidebar
    .getByRole("region", { name: "Running sessions", exact: true })
    .getByRole("button")
    .filter({ hasText: grandchild.title })
    .locator('[data-component="activity-ring"]')
  await expect
    .poll(async () => {
      const values = await animations(childSpinner)
      return values.length > 0 && values.every((animation) => animation.state === "running")
    })
    .toBe(true)
  await workspace.push([
    {
      id: "evt_family_shell_started",
      created: T0 + 1,
      type: "shell.created",
      location: { directory: workspace.directory },
      data: {
        info: {
          id: "sh_family",
          status: "running",
          command: "Check in background",
          cwd: workspace.directory,
          shell: "pwsh.exe",
          file: `${workspace.directory}/shell.out`,
          metadata: { sessionID: grandchild.id },
          time: { started: T0 + 1 },
        },
      },
    },
    {
      id: "evt_family_finish",
      created: 1700000002000,
      type: "session.execution.succeeded",
      durable: { aggregateID: grandchild.id, seq: 1, version: 1 },
      data: { sessionID: grandchild.id },
    },
  ])
  await expect(tab.locator("[data-titlebar-tab]")).toHaveAttribute("data-status", "busy")
  await expect(
    sidebar.getByRole("region", { name: "Running sessions", exact: true }).getByRole("button"),
  ).toContainText("Background work")
  await workspace.push([
    {
      id: "evt_family_shell_ended",
      created: T0 + 2,
      type: "shell.exited",
      location: { directory: workspace.directory },
      data: { id: "sh_family", status: "exited", exit: 0 },
    },
  ])
  await expect(tab.locator("[data-titlebar-tab]")).not.toHaveAttribute("data-status", "busy")
  await workspace.push([
    {
      id: "evt_family_restart",
      created: 1700000003000,
      type: "session.execution.started",
      durable: { aggregateID: grandchild.id, seq: 2, version: 1 },
      data: { sessionID: grandchild.id },
    },
  ])
  await expect(spinner).toBeVisible()
  await expect
    .poll(async () => {
      const values = await animations()
      return values.length > 0 && values.every((animation) => animation.state === "running")
    })
    .toBe(true)
  const time = (await animations())[0]!.time
  await expect.poll(async () => (await animations())[0]!.time).toBeGreaterThan(time)
  const scroll = sidebar.locator('[data-slot="vertical-tabs-scroll"]')
  await scroll.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(spinner).toHaveAttribute("data-offscreen", "")
  await spinner.scrollIntoViewIfNeeded()
  await expect(spinner).not.toHaveAttribute("data-offscreen")
  await expect.poll(async () => (await animations()).every((animation) => animation.state === "running")).toBe(true)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce")
  await expect.poll(async () => (await animations()).length).toBe(0)
  await expect.poll(async () => (await animations(childSpinner)).length).toBe(0)
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect
    .poll(async () => {
      const values = await animations()
      return values.length > 0 && values.every((animation) => animation.state === "running")
    })
    .toBe(true)
  await expect
    .poll(async () => {
      const values = await animations(childSpinner)
      return values.length > 0 && values.every((animation) => animation.state === "running")
    })
    .toBe(true)
})

test("recent sessions caps each project at five and can reveal a selected overflow session", async ({ page }) => {
  const large = Array.from({ length: 10 }, (_, index) => ({
    id: `ses_limit_${index}`,
    title: `Large task ${index}`,
    time: { created: T0, updated: T0, viewed: T0, idle: index === 9 ? T0 + 1 : undefined },
  }))
  const small = Array.from({ length: 3 }, (_, index) => ({
    id: `ses_small_${index}`,
    title: `Small task ${index}`,
    directory: "C:/OpenCode/Small",
    projectID: "proj_small",
  }))
  await mockWorkspace(page, {
    name: "ProjectLimit",
    sessions: [...large, ...small],
    projects: [
      project({ id: "proj_projectlimit", directory: "C:/OpenCode/ProjectLimit", name: "Large project" }),
      project({ id: "proj_small", directory: "C:/OpenCode/Small", name: "Small project" }),
    ],
    seed: {
      tabs: [],
      usedProjects: { local: ["proj_projectlimit", "proj_small"] },
      settings: { appearance: { tabLayout: "sidebar" } },
    },
  })
  await page.goto("/")
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const titles = sidebar.locator("[data-titlebar-tab-title]")
  const names = (items: { title: string }[]) => items.map((item) => item.title)
  const group = sidebar
    .locator("div[title]")
    .filter({ has: page.getByRole("heading", { name: "Large project", exact: true }) })
  await expect(titles).toHaveText(names([...large.slice(0, 5), ...small]))
  await expect(group.getByRole("img", { name: "Unread sessions", exact: true })).toBeVisible()
  await expect(group.getByText("10/10", { exact: true })).toBeVisible()
  await expect(group).toHaveAttribute("title", /5 shown · 10 recent · 10 sessions in project history/)
  const more = sidebar.getByRole("button", { name: "Show 5 more sessions in Large project", exact: true })
  await expect(more).toHaveText("More (5)")
  await expect(more).toHaveAttribute("aria-expanded", "false")
  await more.click()
  await expect(titles).toHaveText(names([...large, ...small]))
  await expect(group).toHaveAttribute("title", /10 shown · 10 recent · 10 sessions in project history/)
  const less = sidebar.getByRole("button", { name: "Collapse sessions in Large project", exact: true })
  await expect(less).toHaveAttribute("aria-expanded", "true")
  await less.click()
  await expect(titles).toHaveText(names([...large.slice(0, 5), ...small]))

  await sidebar
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(large[0]!.id)}"])`)
    .getByRole("button", { name: "Hide from recent sessions", exact: true })
    .click()
  await expect(titles).toHaveText(names([...large.slice(1, 6), ...small]))
  await expect(group.getByText("9/10", { exact: true })).toBeVisible()
  await expect(
    sidebar.getByRole("button", { name: "Show 4 more sessions in Large project", exact: true }),
  ).toBeVisible()
  const home = page.locator('[data-slot="home-panel"]')
  await expect(home.locator('[data-component="home-session-row"]').filter({ hasText: large[0]!.title })).toBeVisible()
  await home.getByRole("textbox", { name: /Search sessions/ }).fill(large[9]!.title)
  await expect(home.getByRole("option")).toContainText(large[9]!.title)
  await home.getByRole("option").click()
  await expectPath(page, sessionHref(large[9]!.id))
  await expect(sidebar.locator(`[data-titlebar-tab-link][href="${sessionHref(large[9]!.id)}"]`)).toBeVisible()
  await expect(titles).toHaveText(names([large[9]!, ...large.slice(1, 5), ...small]))
  await expect(sidebar.locator(`[data-titlebar-tab-link][href="${sessionHref(large[0]!.id)}"]`)).toHaveCount(0)
})

test("project activity takes priority and completed sessions keep their saved positions", async ({ page }) => {
  const sessions = Array.from({ length: 7 }, (_, index) => ({
    id: `ses_project_active_${index}`,
    title: `Task ${index}`,
  }))
  const first = sessions[0]!
  const older = sessions[5]!
  const current = sessions[6]!
  const workspace = await mockWorkspace(page, {
    name: "Activity priority",
    sessions,
    seed: {
      tabs: [first.id],
      settings: { appearance: { tabLayout: "sidebar", tabGrouping: "project" } },
      storage: { "opencode.window.browser.dat:sidebar.order": sessions.map((row) => tabKey(row.id)) },
    },
  })

  const execution = (
    type: "session.execution.started" | "session.execution.succeeded",
    sessionID: string,
  ): OpenCodeEvent => ({
    id: `evt_${sessionID}_${type}`,
    created: T0 + 1,
    type,
    durable: { aggregateID: sessionID, seq: type === "session.execution.started" ? 1 : 2, version: 1 },
    data: { sessionID },
  })

  await page.goto(sessionHref(first.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const titles = sidebar.locator("[data-titlebar-tab-title]")
  const row = (id: string) => sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(id)}"]`)
  await expect(titles).toHaveText(sessions.slice(0, 5).map((item) => item.title))

  await workspace.push([
    execution("session.execution.started", older.id),
    execution("session.execution.started", current.id),
  ])
  await expect(titles).toHaveText([older.title, current.title, "Task 0", "Task 1", "Task 2"])
  await row(current.id).click()
  await expectSessionTitle(page, current.title)
  await expect(titles).toHaveText([current.title, older.title, "Task 0", "Task 1", "Task 2"])

  const source = await row(sessions[2]!.id).boundingBox()
  const target = await row(sessions[1]!.id).boundingBox()
  if (!source || !target) throw new Error("history row has no bounding box")
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 - 8, { steps: 2 })
  await expect(
    sidebar
      .getByRole("link")
      .filter({ has: page.locator(`a[data-titlebar-tab-link][href="${sessionHref(sessions[2]!.id)}"]`) })
      .locator("[data-titlebar-tab]"),
  ).toHaveAttribute("data-dragging", "true")
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(titles).toHaveText([older.title, current.title, "Task 0", "Task 2", "Task 1"])
  await row(current.id).click()
  await expectSessionTitle(page, current.title)
  await expect(titles).toHaveText([current.title, older.title, "Task 0", "Task 2", "Task 1"])

  await workspace.push([execution("session.execution.succeeded", current.id)])
  const completed = [older.title, current.title, "Task 0", "Task 2", "Task 1"]
  await expect(titles).toHaveText(completed)
  await row(first.id).click()
  await expectSessionTitle(page, first.title)
  await expect(titles).toHaveText(completed)

  await workspace.push([execution("session.execution.succeeded", older.id)])
  await expect(
    sidebar
      .getByRole("region", { name: "Running sessions", exact: true })
      .getByText("No running sessions", { exact: true }),
  ).toBeVisible()
  await expect(titles).toHaveText(completed)
  await page.reload()
  await expect(titles).toHaveText(completed)
})

test("recent sessions follow last activity and preview the previous run completion", async ({ page }) => {
  const ended = 1700000100000
  const worktree = "C:/OpenCode/Activity order/task"
  const loaded: string[] = []
  const workspace = await mockWorkspace(page, {
    name: "Activity order",
    project: { sandboxes: [worktree] },
    vcs: (directory) => ({ current: directory === worktree ? "task-branch" : "main", default: "main" }),
    sessions: [
      { ...a, time: { created: ended - 10000, updated: ended - 3000 } },
      { ...b, directory: worktree, time: { created: ended - 10000, updated: ended, idle: ended } },
      { ...c, time: { created: ended - 10000, updated: ended - 2000 } },
      { id: "ses_child_sidebar", title: "Child task", parentID: a.id },
    ],
    onSession: (id) => loaded.push(id),
    seed: { tabs: [a.id, "ses_child_sidebar"], settings: { appearance: { tabLayout: "sidebar" } } },
  })
  await page.goto("/")
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([b.title, c.title, a.title])
  const tab = sidebar.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  await tab.hover()
  const preview = page.locator('[data-component="session-tab-popover"]')
  await expect(preview).toContainText(b.title)
  await expect(preview).toContainText("Last run ended:")
  await expect(preview).toContainText("Branch: task-branch")
  await expect(preview).toContainText(`Worktree: ${worktree}`)
  await expect(preview).toContainText(
    new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" }).format(ended),
  )
  await expect.poll(() => loaded.includes(a.id)).toBe(true)
  await workspace.push([
    {
      id: "evt_sidebar_last_activity",
      created: ended + 5000,
      type: "session.agent.selected",
      durable: { aggregateID: a.id, seq: 1, version: 1 },
      data: { sessionID: a.id, agent: "plan" },
    },
  ])
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title, c.title])
})

test("sidebar loads history before Home mounts and shares live additions and removals", async ({ page }) => {
  const directory = "C:/OpenCode/SidebarLive"
  const records = [
    session({ ...a, directory, projectID: "proj_live" }),
    session({ ...b, directory, projectID: "proj_live" }),
  ]
  const messages: string[] = []
  const mock = await mockServers(page, {
    [SERVER]: {
      directory,
      project: project({ id: "proj_live", directory, name: "Live project" }),
      provider: NO_PROVIDER,
      sessions: records,
      pageMessages: () => ({ items: [] }),
      onMessages: (input) => {
        if (input.phase === "start") messages.push(input.sessionID)
      },
    },
  })
  await seed(page, {
    usedProjects: { local: ["proj_live"] },
    tabs: [a.id],
    settings: { appearance: { tabLayout: "sidebar" } },
  })
  await page.goto(sessionHref(a.id))
  await expectSessionTitle(page, a.title)
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const titles = sidebar.locator("[data-titlebar-tab-title]")
  await expect(titles).toHaveText([a.title, b.title])
  await expect(sidebar.getByRole("button", { name: "Close tab", exact: true })).toHaveCount(1)
  expect(messages.filter((id) => id !== a.id)).toEqual([])
  const added = session({ ...c, directory, projectID: "proj_live" })
  records.push(added)
  await mock[SERVER]!.transport.burst([
    {
      id: "evt_sidebar_created",
      created: 1700000001000,
      type: "session.created",
      durable: { aggregateID: c.id, seq: 0, version: 1 },
      location: { directory },
      data: {
        sessionID: c.id,
        projectID: "proj_live",
        location: { directory },
        slug: added.slug,
        title: added.title,
        version: added.version,
      },
    },
  ])
  await expect(titles).toHaveText([a.title, b.title, c.title])
  await sidebar.getByRole("button", { name: "Home", exact: true }).click()
  await expectPath(page, "/")
  const home = page.locator('[data-slot="home-panel"]')
  await expect(home.locator('[data-component="home-session-row"]').filter({ hasText: c.title })).toBeVisible()
  records.splice(
    records.findIndex((item) => item.id === b.id),
    1,
  )
  await mock[SERVER]!.transport.burst([
    {
      id: "evt_sidebar_deleted",
      created: 1700000002000,
      type: "session.deleted",
      durable: { aggregateID: b.id, seq: 1, version: 2 },
      location: { directory },
      data: { sessionID: b.id },
    },
  ])
  await expect(titles).toHaveText([a.title, c.title])
  await expect(home.locator('[data-component="home-session-row"]').filter({ hasText: b.title })).toHaveCount(0)
})

test("the running shelf includes unopened sessions across projects and servers in a bounded scrolling area", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const directory = "C:/OpenCode/Local"
  const remoteDirectory = "C:/OpenCode/Remote"
  const sandbox = "C:/OpenCode/Local-feature"
  const now = 1800000000000
  await page.clock.install({ time: now })

  const local = Array.from({ length: 5 }, (_, index) =>
    session({
      id: `ses_running_local_${index}`,
      title: `Local task ${index}`,
      directory,
      projectID: "proj_local",
      time: { created: now - 3600000, updated: now, busy: now - 109000, idle: now - 1800000 },
    }),
  )

  const child = session({
    id: "ses_running_child",
    title: "Local subagent",
    directory: sandbox,
    projectID: "proj_local",
    parentID: local[1]!.id,
  })

  const remote = Array.from({ length: 6 }, (_, index) =>
    session({
      id: `ses_running_remote_${index}`,
      title: `Remote task ${index}`,
      directory: remoteDirectory,
      projectID: "proj_remote",
    }),
  )

  const messages: string[] = []
  await mockServers(page, {
    [SERVER]: {
      directory,
      project: project({ id: "proj_local", directory, name: "Local project", sandboxes: [sandbox] }),
      vcs: (location) => ({ current: location === sandbox ? "feature/sidebar" : "main", default: "main" }),
      provider: NO_PROVIDER,
      sessions: [
        session({ ...a, directory }),
        ...local,
        child,
        ...Array.from({ length: 205 }, (_, index) =>
          session({ id: `ses_idle_${index}`, directory, created: 1800000000000 + index }),
        ),
      ],
      sessionStatus: Object.fromEntries([...local, child].map((value) => [value.id, { type: "running" }])),
      sessionPermissions: {
        [local[0]!.id]: [
          {
            id: "permission-active",
            sessionID: local[0]!.id,
            action: "shell",
            resources: ["git status"],
            metadata: {},
            save: [],
          },
        ],
      },
      pageMessages: () => ({ items: [] }),
      onMessages: (input) => {
        if (input.phase === "start") messages.push(input.sessionID)
      },
    },
    [REMOTE_SERVER]: {
      directory: remoteDirectory,
      project: project({ id: "proj_remote", directory: remoteDirectory, name: "Remote project" }),
      provider: NO_PROVIDER,
      vcs: { current: "dev-my", default: "main" },
      sessions: remote,
      sessionStatus: Object.fromEntries(remote.map((value) => [value.id, { type: "running" }])),
      pageMessages: () => ({ items: [] }),
      onMessages: (input) => {
        if (input.phase === "start") messages.push(input.sessionID)
      },
    },
  })
  await seed(page, {
    servers: [SERVER, { url: REMOTE_SERVER, name: "Remote server" }],
    tabs: [a.id],
    settings: { appearance: { tabLayout: "sidebar" } },
  })
  await page.goto(sessionHref(a.id))
  const shelf = page.getByRole("region", { name: "Running sessions", exact: true })
  await expect(shelf.getByRole("button")).toHaveCount(12)
  await expect(shelf.getByLabel("12 running sessions", { exact: true })).toHaveText("12")
  await expect(shelf.getByText("Local subagent", { exact: true })).toBeVisible()
  await expect(shelf.getByRole("button").filter({ hasText: "Local task 0" })).toContainText("Approval")
  const working = shelf.getByRole("button").filter({ hasText: "Local task 1" })
  await expect(working).toContainText("main")
  await page.clock.pauseAt(now + 10000)
  await expect(working.locator('[data-slot="active-session-status"]')).toHaveText("Working1m")
  await page.clock.runFor(1000)
  await expect(working.locator('[data-slot="active-session-status"]')).toHaveText("Working2m")
  await expect(working).toHaveAttribute("title", /Last run ended:/)
  await expect(shelf.getByRole("button").filter({ hasText: "Local subagent" })).toContainText("feature/sidebar")
  const scroll = shelf.locator("[data-scrollable]")

  const rows = await scroll.evaluate(
    (element) => element.clientHeight / element.querySelector("button")!.getBoundingClientRect().height,
  )

  expect(rows).toBe(5)
  expect(messages.filter((id) => id !== a.id)).toEqual([])
  await scroll.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  const target = shelf.getByRole("button").filter({ hasText: "Remote task 5" })
  await expect(target).toBeInViewport()
  await expect(target).toContainText("Remote project")
  await expect(target).toContainText("dev-my")
  await target.click()
  await expectPath(page, sessionHref(remote[5]!.id, REMOTE_SERVER))
  await expectSessionTitle(page, remote[5]!.title)
})

test("the running shelf stays visible when empty and follows live execution independently of tabs and grouping", async ({
  page,
}) => {
  const workspace = await mockWorkspace(page, {
    name: "RunningShelf",
    sessions: [a, b],
    seed: { tabs: [a.id], settings: { appearance: { tabLayout: "sidebar", tabGrouping: "none" } } },
  })

  await page.goto(sessionHref(a.id))
  const shelf = page.getByRole("region", { name: "Running sessions", exact: true })
  await expect(shelf.getByText("No running sessions", { exact: true })).toBeVisible()
  await expect(shelf.getByRole("button")).toHaveCount(0)
  await workspace.push([
    {
      id: "evt_running_shelf_start",
      created: 1700000001000,
      type: "session.execution.started",
      durable: { aggregateID: b.id, seq: 1, version: 1 },
      data: { sessionID: b.id },
    },
  ])
  await expect(shelf.getByRole("button").filter({ hasText: b.title })).toBeVisible()
  await page.getByRole("button", { name: "Group sessions List", exact: true }).click()
  await page.getByRole("option", { name: "By project", exact: true }).click()
  await expect(shelf.getByRole("button")).toHaveCount(1)
  await expect
    .poll(() =>
      shelf
        .locator('[data-slot="active-sessions-list"]')
        .evaluate((element) => element.clientHeight / element.querySelector("button")!.getBoundingClientRect().height),
    )
    .toBe(1)
  await shelf.getByRole("button").click()
  await expectPath(page, sessionHref(b.id))
  await page
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expectPath(page, sessionHref(a.id))
  await expect(shelf.getByRole("button")).toHaveCount(1)
  await expect(page.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`)).toHaveCount(0)
  await shelf.getByRole("button").click()
  await expectPath(page, sessionHref(b.id))
  await expect(page.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`)).toBeVisible()
  await workspace.push([
    {
      id: "evt_running_shelf_end",
      created: 1700000002000,
      type: "session.execution.succeeded",
      durable: { aggregateID: b.id, seq: 2, version: 1 },
      data: { sessionID: b.id },
    },
  ])
  await expect(shelf.getByText("No running sessions", { exact: true })).toBeVisible()
  await expect(shelf).toBeVisible()
})

test("sidebar grouping keeps servers separate and reorders only the chosen project", async ({ page }) => {
  const directory = "C:/OpenCode/Tabs"
  const sessionA = session({ ...a, directory, projectID: "proj_tabs" })
  const sessionB = session({ ...b, directory, projectID: "proj_tabs" })
  const sessionC = session({ ...c, directory, projectID: "proj_tabs" })
  await mockServers(page, {
    [SERVER]: {
      directory,
      project: project({ id: "proj_tabs", directory, name: "Tabs" }),
      provider: NO_PROVIDER,
      sessions: [sessionA, sessionC],
      pageMessages: () => ({ items: [] }),
    },
    [REMOTE_SERVER]: {
      directory,
      project: project({ id: "proj_tabs", directory, name: "Tabs" }),
      provider: NO_PROVIDER,
      sessions: [sessionB],
      pageMessages: () => ({ items: [] }),
    },
  })
  await seed(page, {
    servers: [SERVER, { url: REMOTE_SERVER, name: "Remote" }],
    tabs: [a.id, { session: b.id, server: REMOTE_SERVER }, c.id],
    settings: { appearance: { tabLayout: "sidebar", tabGrouping: "project" } },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const titles = sidebar.locator("[data-titlebar-tab-title]")
  await expect(sidebar.getByRole("heading", { level: 3 })).toHaveText(["Tabs", "Tabs"])
  await expect(sidebar.getByText("Remote", { exact: true })).toBeVisible()
  await expect(titles).toHaveText([a.title, c.title, b.title])
  await expectSessionTitle(page, a.title)
  const source = await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(c.id)}"]`).boundingBox()
  const target = await sidebar.locator(`a[data-titlebar-tab-link][href="${sessionHref(a.id)}"]`).boundingBox()

  if (!source || !target) throw new Error("session tab has no bounding box")
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 - 8, { steps: 2 })
  await expect(
    sidebar
      .getByRole("link")
      .filter({ has: page.locator(`a[data-titlebar-tab-link][href="${sessionHref(c.id)}"]`) })
      .locator("[data-titlebar-tab]"),
  ).toHaveAttribute("data-dragging", "true")
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(titles).toHaveText([c.title, a.title, b.title])
  const headers = sidebar
    .locator("div[title]")
    .filter({ has: page.getByRole("heading", { name: "Tabs", exact: true }) })
  const remote = headers.filter({ hasText: "Remote" })
  const local = headers.filter({ hasNotText: "Remote" })
  await remote.hover()
  await remote.getByRole("button", { name: "Pin project Tabs", exact: true }).click()
  await expect(titles).toHaveText([b.title, c.title, a.title])
  await expect(
    local.getByRole("button", { name: "Pin project Tabs", exact: true, includeHidden: true }),
  ).toHaveAttribute("aria-pressed", "false")
  await remote.getByRole("button", { name: "Unpin project Tabs", exact: true }).click()
  await expect(titles).toHaveText([c.title, a.title, b.title])
  await sidebar.getByRole("button", { name: "Group sessions By project", exact: true }).click()
  await page.getByRole("option", { name: "List", exact: true }).click()
  await expect(titles).toHaveText([c.title, b.title, a.title])
})

test("sidebar project grouping preserves the flat order and navigates in display order", async ({ page }) => {
  const directory = "C:/OpenCode/Tabs"
  const other = "C:/OpenCode/Other"
  const sandbox = "C:/OpenCode/Tabs-worktree"
  await mockWorkspace(page, {
    name: "Tabs",
    project: { sandboxes: [sandbox] },
    projects: [
      project({ id: "proj_tabs", directory, name: "Tabs", sandboxes: [sandbox] }),
      project({ id: "proj_other", directory: other, name: "Other" }),
    ],
    sessions: [a, { ...b, directory: other, projectID: "proj_other" }, { ...c, directory: sandbox }],
    seed: {
      settings: { appearance: { tabLayout: "sidebar", tabGrouping: "none" } },
      tabs: [a.id, b.id, c.id, { draft: "draft_grouped", directory: sandbox }],
    },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const titles = sidebar.locator("[data-titlebar-tab-title]")
  await expect(titles).toHaveText([a.title, b.title, c.title, "Draft (unsent)"])
  await expect(sidebar.getByRole("heading", { level: 3 })).toHaveCount(0)
  await sidebar.getByRole("button", { name: "Group sessions List", exact: true }).click()
  await page.getByRole("option", { name: "By project", exact: true }).click()
  await expect(sidebar.getByRole("heading", { level: 3 })).toHaveText(["Other", "Tabs"])
  await expect(titles).toHaveText([b.title, a.title, c.title, "Draft (unsent)"])
  await page.keyboard.press("Alt+ArrowDown")
  await expectPath(page, sessionHref(c.id))
  await page.keyboard.press("Control+1")
  await expectPath(page, sessionHref(b.id))
  await page.reload()
  await expect(titles).toHaveText([b.title, a.title, c.title, "Draft (unsent)"])
  await sidebar.getByRole("button", { name: "Group sessions By project", exact: true }).click()
  await page.getByRole("option", { name: "List", exact: true }).click()
  await expect(sidebar.getByRole("heading", { level: 3 })).toHaveCount(0)
  await expect(titles).toHaveText([a.title, b.title, c.title, "Draft (unsent)"])
  await sidebar
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(c.id)}"])`)
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(titles).toHaveText([a.title, b.title, "Draft (unsent)"])
})

test("recently closed shows ten sessions and searches older closures in close order", async ({ page }) => {
  const sessions = Array.from({ length: 100 }, (_, index) => ({
    id: `ses_closed_${index}`,
    title: `Closed session ${index}`,
  }))

  await mockWorkspace(page, {
    name: "ClosedTabs",
    sessions,
    seed: {
      servers: [SERVER],
      tabs: [sessions[0]!.id],
      storage: {
        "opencode.window.browser.dat:tabs.closed": sessions.slice(1).map((session, index) => ({
          tab: { type: "session", server: SERVER, sessionId: session.id },
          index,
          info: { title: session.title, directory: "C:/OpenCode/ClosedTabs", prompted: true },
        })),
      },
    },
  })
  await page.goto(sessionHref(sessions[0]!.id))
  await expect(page.locator("[data-titlebar-tab-title]")).toHaveText("Closed session 0")
  const trigger = page.getByRole("button", { name: "New session", exact: true })
  await trigger.click({ button: "right" })
  const menu = page.getByRole("menu")
  const items = menu.getByRole("menuitem")
  const search = menu.getByRole("searchbox", { name: "Search recently closed" })
  await expect(search).toBeFocused()
  await expect(items).toHaveText(Array.from({ length: 10 }, (_, index) => `CClosed session ${99 - index}`))
  await search.pressSequentially("SESSION 2")
  await expect(search).toHaveValue("SESSION 2")
  await expect(items).toHaveText(Array.from({ length: 10 }, (_, index) => `CClosed session ${29 - index}`))
  await search.fill("not found")
  await expect(menu.getByRole("status")).toHaveText("No matches")
  await expect(items).toHaveCount(0)
  await menu.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(search).toHaveValue("")
  await expect(search).toBeFocused()
  await expect(items).toHaveCount(10)
  await search.fill("session 1")
  await expect(items).toHaveText(Array.from({ length: 10 }, (_, index) => `CClosed session ${19 - index}`))
  await search.press("ArrowDown")
  await expect(menu.getByRole("menuitem", { name: "C Closed session 19", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expectPath(page, sessionHref("ses_closed_19"))
  await expect(menu).toBeHidden()
  await trigger.click({ button: "right" })
  await expect(search).toHaveValue("")
  await expect(items).toHaveCount(10)
  await search.press("Escape")
  await expect(menu).toBeHidden()
})

test("recently closed keeps the keyboard-focused session in view when the menu overflows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 })

  const sessions = Array.from({ length: 11 }, (_, index) => ({
    id: `ses_overflow_${index}`,
    title: `Overflow session ${index}`,
  }))

  await mockWorkspace(page, {
    name: "ClosedOverflow",
    sessions,
    seed: {
      servers: [SERVER],
      tabs: [sessions[0]!.id],
      storage: {
        "opencode.window.browser.dat:tabs.closed": sessions.slice(1).map((item, index) => ({
          tab: { type: "session", server: SERVER, sessionId: item.id },
          index,
          info: { title: item.title, directory: "C:/OpenCode/ClosedOverflow", prompted: true },
        })),
      },
    },
  })
  await page.goto(sessionHref(sessions[0]!.id))
  await expect(page.locator("[data-titlebar-tab-title]")).toHaveText("Overflow session 0")
  await page.getByRole("button", { name: "New session", exact: true }).click({ button: "right" })
  const menu = page.getByRole("menu")
  const last = menu.getByRole("menuitem", { name: "C Overflow session 1", exact: true })

  await expect(menu.getByRole("menuitem")).toHaveCount(10)
  await menu.getByRole("searchbox", { name: "Search recently closed" }).press("ArrowDown")
  await page.keyboard.press("End")
  await expect(last).toBeFocused()
  await expect(last).toBeInViewport({ ratio: 1 })
})

test("recently closed fills remaining slots in Home order without open or duplicate sessions", async ({ page }) => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    id: `ses_other_${index}`,
    title: `Other session ${index}`,
    time: { created: 1700000000000, updated: 1700000000000 + (12 - index) * 1000 },
  }))

  await mockWorkspace(page, {
    name: "OtherTabs",
    sessions: [
      ...sessions,
      { id: "ses_other_archived", title: "Archived session", time: { created: Date.now(), archived: Date.now() } },
      { id: "ses_other_child", title: "Child session", parentID: sessions[0]!.id },
    ],
    seed: {
      servers: [SERVER],
      tabs: [sessions[0]!.id, sessions[2]!.id],
      storage: {
        "opencode.window.browser.dat:tabs.closed": sessions.slice(10).map((session, index) => ({
          tab: { type: "session", server: SERVER, sessionId: session.id },
          index,
          info: { title: session.title, directory: "C:/OpenCode/OtherTabs", prompted: true },
        })),
      },
    },
  })
  await page.goto(sessionHref(sessions[0]!.id))
  await expect(page.locator("[data-titlebar-tab-title]")).toHaveText(["Other session 0", "Other session 2"])
  const trigger = page.getByRole("button", { name: "New session", exact: true })
  await trigger.click({ button: "right" })
  const menu = page.getByRole("menu")
  const items = menu.getByRole("menuitem")
  await expect(items).toHaveText([11, 10, 1, 3, 4, 5, 6, 7, 8, 9].map((index) => `OOther session ${index}`))
  await expect(menu.getByRole("group", { name: "Recently closed", exact: true }).getByRole("menuitem")).toHaveText([
    "OOther session 11",
    "OOther session 10",
  ])
  await expect(menu.getByRole("group", { name: "Recent sessions", exact: true }).getByRole("menuitem")).toHaveCount(8)
  await menu.getByRole("menuitem", { name: "O Other session 1", exact: true }).click()
  await expectPath(page, sessionHref("ses_other_1"))
  await expect(menu).toBeHidden()
  await trigger.click({ button: "right" })
  await expect(items).toHaveText([11, 10, 3, 4, 5, 6, 7, 8, 9].map((index) => `OOther session ${index}`))
  await menu.getByRole("searchbox", { name: "Search recently closed" }).fill("session 9")
  await expect(items).toHaveText(["OOther session 9"])
})

test("tab strip keeps draft tabs as wide as session tabs and navigates on mouse down", async ({ page }) => {
  const workspace = await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b],
    seed: { tabs: [a.id, { draft: "draft_tab_width", directory: "C:/OpenCode/Tabs" }, b.id] },
  })

  await page.goto(sessionHref(a.id))

  const tabs = page.locator("[data-titlebar-tab-slot]")
  await expect(tabs.locator("[data-titlebar-tab-title]")).toHaveText([a.title, "Session", b.title])
  await expect
    .poll(() =>
      tabs.evaluateAll((tabs) => {
        const widths = tabs.map((tab) => tab.getBoundingClientRect().width)

        return Math.max(...widths) - Math.min(...widths)
      }),
    )
    .toBeLessThan(1)

  const link = page.locator(`a[data-titlebar-tab-link][href="${sessionHref(b.id, workspace.server)}"]`)
  const box = await link.boundingBox()

  if (!box) throw new Error("tab link has no bounding box")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expectPath(page, sessionHref(b.id))
  await page.mouse.up()
  await expectPath(page, sessionHref(b.id))
})

test("inactive session attention dots share the close control without marking the avatar or active tab", async ({
  page,
}) => {
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b],
    sessionPermissions: {
      [b.id]: [
        { id: "permission-tab-b", sessionID: b.id, action: "shell", resources: ["git status"], metadata: {}, save: [] },
      ],
    },
  })

  await page.goto(sessionHref(a.id))
  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`)
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  const dot = tabB.locator('[data-mark="attention"]')
  const status = tabB.locator('[data-slot="tab-status"]')
  const close = tabB.getByRole("button", { name: "Close tab", exact: true })
  await expect(tabA.locator('[data-slot="tab-title"]')).toHaveText(a.title)
  await expect(tabB.locator('[data-slot="tab-title"]')).toHaveText(b.title)
  await page.mouse.move(0, 0)
  await expect(dot).toBeVisible()
  await expect(tabB.locator('[data-slot="tab-avatar-unread-dot"]')).toBeHidden()
  await expect(close).toHaveCSS("opacity", "0")
  await expect(tabB.locator('[data-slot="project-avatar-unread-dot"]')).toHaveCount(0)
  await expect
    .poll(() =>
      dot.evaluate((element) => {
        const dot = element.getBoundingClientRect()
        const slot = element.parentElement!.getBoundingClientRect()

        return (
          Math.abs(dot.x + dot.width / 2 - slot.x - slot.width / 2) +
          Math.abs(dot.y + dot.height / 2 - slot.y - slot.height / 2)
        )
      }),
    )
    .toBeLessThan(1)

  await tabB.hover()
  await expect(status).toHaveCSS("opacity", "0")
  await expect(close).toHaveCSS("opacity", "1")
  await page.mouse.move(0, 0)
  await tabB.locator("[data-titlebar-tab-link]").focus()
  await page.keyboard.press("Tab")
  await expect(close).toBeFocused()
  await expect(status).toHaveCSS("opacity", "0")
  await expect(close).toHaveCSS("opacity", "1")
  await close.blur()
  await expect(status).toHaveCSS("opacity", "1")

  await tabB.locator("[data-titlebar-tab-link]").click()
  await expectPath(page, sessionHref(b.id))
  await expect(tabB).toHaveAttribute("data-active", "true")
  await expect(dot).toBeHidden()
  await tabA.locator("[data-titlebar-tab-link]").click()
  await expectPath(page, sessionHref(a.id))
  await page.mouse.move(0, 0)
  await expect(dot).toBeVisible()
  await tabB.hover()
  await close.click()
  await expect(tabB).toHaveCount(0)
  await expectPath(page, sessionHref(a.id))
})

test("the browser title names the open session and resets after leaving it", async ({ page }) => {
  await mockWorkspace(page, { name: "Tabs", sessions: [a, b] })
  await page.goto(sessionHref(a.id))
  await expect(page).toHaveTitle(`${a.title} · OpenCode`)

  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  await tabB.locator("[data-titlebar-tab-link]").click()
  await expectPath(page, sessionHref(b.id))
  await expect(page).toHaveTitle(`${b.title} · OpenCode`)

  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expectPath(page, "/")
  await expect(page).toHaveTitle("OpenCode")
})

for (const [tabLayout, direction, label] of [
  ["horizontal", "ltr", "Close tabs to the right"],
  ["horizontal", "rtl", "Close tabs to the left"],
  ["vertical", "ltr", "Close tabs below"],
] as const) {
  test(`${tabLayout} ${direction} tab menus bulk close in visible order and reopen sessions`, async ({ page }) => {
    await mockWorkspace(page, {
      name: "Tabs",
      sessions: [a, b, c],
      seed: {
        tabs: [a.id, { draft: "draft_bulk_close", directory: "C:/OpenCode/Tabs" }, b.id, c.id],
        settings: { appearance: { tabLayout } },
      },
    })
    await openWithDirection(page, sessionHref(a.id), direction)

    const titles = page.locator("[data-titlebar-tab-slot] [data-titlebar-tab-title]")

    const draft = page.locator(`a[data-titlebar-tab-link][href="${draftHref("draft_bulk_close")}"]`)

    const tabB = page.locator(`a[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`)

    const menu = page.getByRole("menu")

    const active = page.locator('[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-title]')

    const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))

    await expect(titles).toHaveText([a.title, "Session", b.title, c.title])
    await draft.click({ button: "right" })
    await expect(menu.getByRole("menuitem")).toHaveText(["Close tab", "Close other tabs", label])
    await menu.getByRole("menuitem", { name: label, exact: true }).click()
    await expect(titles).toHaveText([a.title, "Session"])
    await expect(active).toHaveText(a.title)

    for (const expected of [
      [a.title, "Session", b.title],
      [a.title, "Session", b.title, c.title],
    ]) {
      await page.keyboard.press(`${modifier}+Shift+t`)
      await expect(titles).toHaveText(expected)
    }

    await page.locator(`a[data-titlebar-tab-link][href="${sessionHref(a.id)}"]`).click()
    await expect(active).toHaveText(a.title)
    await tabB.click({ button: "right" })
    await menu.getByRole("menuitem", { name: label, exact: true }).click()
    await expect(titles).toHaveText([a.title, "Session", b.title])
    await expect(active).toHaveText(a.title)
    await page.keyboard.press(`${modifier}+Shift+t`)
    await expect(titles).toHaveText([a.title, "Session", b.title, c.title])

    await tabB.click({ button: "right" })
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Rename",
      "Close tab",
      "Close other tabs",
      label,
      "Delete session…",
    ])
    await menu.getByRole("menuitem", { name: "Close other tabs", exact: true }).click()
    await expect(titles).toHaveText([b.title])
    await expect(active).toHaveText(b.title)
    await tabB.click({ button: "right" })
    await expect(menu.getByRole("menuitem", { name: "Close other tabs", exact: true })).toBeDisabled()
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeDisabled()
    await page.keyboard.press("Escape")

    for (const expected of [
      [a.title, b.title],
      [a.title, b.title, c.title],
    ]) {
      await page.keyboard.press(`${modifier}+Shift+t`)
      await expect(titles).toHaveText(expected)
    }

    await expect(draft).toHaveCount(0)
  })
}

for (const tabLayout of ["horizontal", "vertical"] as const) {
  test(`a ${tabLayout} tab can be renamed again while its previous rename is still saving`, async ({ page }) => {
    await mockWorkspace(page, { name: "Tabs", sessions: [a, b], seed: { settings: { appearance: { tabLayout } } } })
    await page.goto(sessionHref(a.id))
    const title = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"]) [data-slot="tab-title"]`)
    const editor = page.locator('[data-slot="tab-title"][contenteditable="plaintext-only"]')
    await expect(title).toHaveText(a.title)
    const save = await holdRoute(page, (url) => url.pathname === `/api/session/${a.id}`, { method: "PATCH" })

    await title.dblclick()
    await expect(editor).toBeFocused()
    await editor.fill("First name")
    await editor.press("Enter")
    expect((await save.arrived).postDataJSON()).toEqual({ title: "First name" })
    await expect(editor).toHaveCount(0)

    await title.dblclick()
    await expect(editor).toBeFocused()
    await editor.fill("Second name")
    await editor.press("Enter")
    await expect(title).toHaveText("Second name")

    await title.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    await expect(editor).toBeFocused()
    await editor.fill("Third name")
    await editor.press("Enter")
    await expect(title).toHaveText("Third name")

    save.release()
    await expect
      .poll(() => save.requests.map((request) => request.postDataJSON()))
      .toEqual([{ title: "First name" }, { title: "Second name" }, { title: "Third name" }])
    await expect(title).toHaveText("Third name")
  })
}

test("a tab whose overlapping renames both fail shows its saved title again", async ({ page }) => {
  await mockWorkspace(page, { name: "Tabs", sessions: [a, b] })
  await page.goto(sessionHref(a.id))
  const title = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"]) [data-slot="tab-title"]`)
  const editor = page.locator('[data-slot="tab-title"][contenteditable="plaintext-only"]')
  await expect(title).toHaveText(a.title)
  const released = Promise.withResolvers<void>()
  const saves: string[] = []
  await page.route(new RegExp(`/api/session/${a.id}(\\?|$)`), async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    saves.push(route.request().postDataJSON().title)
    await released.promise
    await route.fulfill({ status: 500, json: { message: "Rename failed" } })
  })

  for (const name of ["First name", "Second name"]) {
    await title.dblclick()
    await expect(editor).toBeFocused()
    await editor.fill(name)
    await editor.press("Enter")
    await expect(title).toHaveText(name)
  }

  await expect.poll(() => saves).toEqual(["First name", "Second name"])
  released.resolve()
  // The rollback restores the title the server holds, never the first rename that was never saved.
  await expect(title).toHaveText(a.title)
  await expect(page.locator('[data-testid^="toast-v2-"]').filter({ hasText: "Request failed" })).toHaveCount(1)
})

for (const tabLayout of ["horizontal", "vertical"] as const) {
  test(`a ${tabLayout} tab deletes its session after confirmation`, async ({ page }) => {
    await mockWorkspace(page, { name: "Tabs", sessions: [a, b], seed: { settings: { appearance: { tabLayout } } } })
    await page.goto(sessionHref(a.id))
    const title = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"]) [data-slot="tab-title"]`)

    const remove = page.waitForRequest(
      (request) => request.method() === "DELETE" && request.url().endsWith(`/api/session/${a.id}`),
    )

    await expect(title).toHaveText(a.title)

    await title.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Delete session…", exact: true }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(title).toHaveText(a.title)

    await title.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Delete session…", exact: true }).click()
    await dialog.getByRole("button", { name: "Delete session", exact: true }).click()
    await remove
    await expect(title).toHaveCount(0)
    await expectPath(page, sessionHref(b.id))
  })
}

test("keyboard navigation and numbered shortcuts follow the visible tab order and skip unresolved tabs", async ({
  page,
}) => {
  await mockWorkspace(page, { name: "Tabs", sessions: [a, c], seed: { tabs: [a.id, "ses_tab_unresolved", c.id] } })
  await page.route(
    (url) => url.pathname === "/api/session/ses_tab_unresolved",
    () => new Promise(() => {}),
  )
  await page.goto(sessionHref(a.id))
  await expect(page.locator("[data-titlebar-tab-slot]:visible")).toHaveCount(2)
  await expect(page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(c.id)}"])`)).toBeVisible()

  await page.keyboard.press("Control+Alt+ArrowRight")

  await expectPath(page, sessionHref(c.id))

  await page.keyboard.press("ControlOrMeta+1")
  await expectPath(page, sessionHref(a.id))
  await page.keyboard.press("ControlOrMeta+2")
  await expectPath(page, sessionHref(c.id))
})

test("option arrows move to the previous or next tab, and with shift to the next unread one", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b, c],
    sessionPermissions: {
      [c.id]: [
        { id: "permission-tab-c", sessionID: c.id, action: "shell", resources: ["git status"], metadata: {}, save: [] },
      ],
    },
  })
  await page.goto(sessionHref(a.id))
  await page.mouse.move(0, 0)
  await expect(
    page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(c.id)}"]) [data-mark="attention"]`),
  ).toBeVisible()

  await page.keyboard.press("Alt+ArrowDown")
  await expectPath(page, sessionHref(b.id))

  await page.keyboard.press("Alt+ArrowUp")
  await expectPath(page, sessionHref(a.id))

  await page.keyboard.press("Shift+Alt+ArrowDown")
  await expectPath(page, sessionHref(c.id))
})

for (const navigation of ["horizontal", "vertical", "keyboard"] as const) {
  test(`switching session tabs restores the caret and pastes into the destination draft (${navigation})`, async ({
    page,
    context,
  }) => {
    const tabLayout = navigation === "vertical" ? "vertical" : "horizontal"

    const strip = page.locator(
      tabLayout === "vertical" ? '[data-slot="vertical-tabs-sidebar"]' : '[data-slot="titlebar-tabs"]',
    )

    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await openSession(page, {
      name: "TabFocus",
      sessions: [a, b],
      seed: { settings: { appearance: { tabLayout } } },
    })
    const editor = page.locator('[data-component="composer-editor"]')
    const tabB = strip.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`)
    await editor.fill("Draft A")

    await (navigation === "keyboard" ? page.keyboard.press("Control+Alt+ArrowRight") : tabB.click())
    await expectPath(page, sessionHref(b.id))
    await expect(editor).toBeFocused()
    await page.evaluate(() => navigator.clipboard.writeText("Draft B"))
    await page.keyboard.press("ControlOrMeta+V")
    await expect(editor).toHaveText("Draft B")

    await page.keyboard.press("Control+Alt+ArrowLeft")
    await expectPath(page, sessionHref(a.id))
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("Draft A")
    await page.evaluate(() => navigator.clipboard.writeText(" appended"))
    await page.keyboard.press("ControlOrMeta+V")
    await expect(editor).toHaveText("Draft A appended")

    await tabB.click()
    await expectPath(page, sessionHref(b.id))
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("Draft B")
  })
}

for (const row of [
  { tabLayout: "horizontal", width: 360, hasTouch: false, direction: "ltr" },
  { tabLayout: "vertical", width: 390, hasTouch: true, direction: "rtl" },
]) {
  test.describe(`mobile drawer (${row.tabLayout})`, () => {
    test.use({ hasTouch: row.hasTouch })
    test(`mobile drawer exposes close controls and navigates between tabs (${row.tabLayout})`, async ({ page }) => {
      await page.setViewportSize({ width: row.width, height: 720 })
      await mockWorkspace(page, {
        name: "Tabs",
        sessions: [a, b, c],
        sessionPermissions: {
          [b.id]: [
            {
              id: "permission-mobile-b",
              sessionID: b.id,
              action: "shell",
              resources: ["git status"],
              metadata: {},
              save: [],
            },
          ],
        },
        seed: { settings: { appearance: { tabLayout: row.tabLayout } } },
      })
      await page.goto(sessionHref(a.id))
      await page.locator("html").evaluate((element, direction) => element.setAttribute("dir", direction), row.direction)
      // The session location bar also names the "Tabs" project, so scope to the titlebar.
      await page.locator('[data-slot="titlebar-v2"]').getByRole("button", { name: "Tabs", exact: true }).click()

      const drawer = page.locator('[data-slot="mobile-tabs-drawer"]')
      const tabA = drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`)
      const tabB = drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
      await expect(tabA).toHaveAttribute("data-active", "true")
      await expect(tabA.locator('[data-slot="tab-close"]')).toBeVisible()
      await expect(tabB.locator('[data-slot="tab-close"]')).toBeVisible()
      await expect(tabB.locator('[data-mark="attention"]')).toBeVisible()
      await expect(tabB.locator('[data-slot="tab-status"]')).toHaveCSS("width", "20px")
      await expect(tabB.locator('[data-slot="tab-status"]')).toHaveCSS("height", "20px")
      await expect
        .poll(() =>
          tabB.evaluate((element) => {
            const dot = element.querySelector('[data-slot="tab-status"]')!.getBoundingClientRect()
            const close = element.querySelector('[data-slot="tab-close"]')!.getBoundingClientRect()

            return dot.right <= close.left || dot.left >= close.right
          }),
        )
        .toBe(true)
      await expect(tabB.locator('[data-slot="tab-avatar-unread-dot"]')).toBeHidden()
      await expect(tabB.getByRole("button", { name: "Close tab", exact: true })).toHaveCSS("opacity", "1")
      await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)

      await tabB.locator(`a[href="${sessionHref(b.id)}"]`).click()

      await expectPath(page, sessionHref(b.id))
      await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()

      if (row.tabLayout !== "vertical") return
      await page.setViewportSize({ width: 1280, height: 720 })
      await expect(
        page
          .locator('[data-slot="vertical-tabs-sidebar"]')
          .locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`),
      ).toBeVisible()
      await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
    })
  })
}

test("icon-only inactive tabs retain their avatar and attention badge instead of showing a close overlay", async ({
  page,
}) => {
  await mockWorkspace(page, {
    name: "CompactTabs",
    sessions: [
      a,
      b,
      ...Array.from({ length: 30 }, (_, index) => ({ id: `ses_compact_${index}`, title: `Compact ${index}` })),
    ],
    sessionPermissions: {
      [b.id]: [
        {
          id: "permission-compact-b",
          sessionID: b.id,
          action: "shell",
          resources: ["git status"],
          metadata: {},
          save: [],
        },
      ],
    },
  })
  await page.goto(sessionHref(a.id))
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  await expect(tabB.locator('[data-slot="tab-title"]')).toBeHidden()
  await expect(tabB.locator('[data-component="project-avatar-v2"]')).toBeVisible()
  await expect(tabB.locator('[data-slot="tab-avatar-unread-dot"]')).toBeVisible()
  await expect(tabB.locator('[data-slot="tab-avatar-unread-dot"]')).toHaveCSS("width", "6px")
  await expect(tabB.locator('[data-slot="tab-avatar-unread-dot"]')).toHaveCSS("height", "6px")
  await expect(tabB.locator('[data-slot="tab-close"]')).toBeHidden()
  await tabB.hover()
  await expect(tabB.locator('[data-slot="tab-close"]')).toBeHidden()
  await tabB.locator("[data-titlebar-tab-link]").click()
  await expectPath(page, sessionHref(b.id))
  await expect(tabB.locator('[data-slot="tab-avatar-unread-dot"]')).toHaveCount(0)
})

test("vertical tabs resize, scroll, show shortcut hints, and navigate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  const directory = "C:/OpenCode/Tabs"
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b],
    seed: {
      settings: {
        appearance: { tabLayout: "vertical", tabGrouping: "none" },
        keybinds: { "home.toggle": "ctrl+alt+h", "tab.new": "ctrl+shift+n" },
      },
      tabs: [
        a.id,
        ...Array.from({ length: 24 }, (_, index) => ({ draft: `draft_vertical_${index}`, directory })),
        b.id,
      ],
    },
  })
  await page.goto(sessionHref(a.id))

  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tabB = sidebar.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`)
  await expect(sidebar.locator("[data-titlebar-tab-slot]")).toHaveCount(26)
  await expect(sidebar).toHaveCSS("width", "240px")
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)

  // Actions and session rows share one icon lane, and the resize handle fills only the gap after the rows.
  const [homeIcon, avatar, row, gutter, chat] = await Promise.all([
    sidebar.locator('[data-action="vertical-tabs-home"] svg').boundingBox(),
    sidebar.locator('[data-slot="project-avatar-slot"]').first().boundingBox(),
    sidebar.locator("[data-titlebar-tab]").first().boundingBox(),
    sidebar.locator('[data-component="resize-handle"]').boundingBox(),
    page.locator('[data-slot="session-chat-panel"]').boundingBox(),
  ])

  if (!homeIcon || !avatar || !row || !gutter || !chat) throw new Error("vertical tabs layout is not rendered")
  expect(avatar.x).toBe(homeIcon.x)
  expect(gutter.x).toBe(row.x + row.width)
  expect(gutter.x + gutter.width).toBe(chat.x)

  const actions = await Promise.all(
    ["vertical-tabs-home", "vertical-tabs-search", "vertical-tabs-new-session"].map(async (action) => {
      const box = await sidebar.locator(`[data-action="${action}"]`).boundingBox()

      if (!box) throw new Error(`${action} is not rendered`)

      return box
    }),
  )

  const gaps = actions.slice(1).map((box, index) => box.y - (actions[index].y + actions[index].height))
  expect(gaps).toEqual([3, 3])

  const handle = sidebar.locator('[data-component="resize-handle"]')

  const resize = async (offset: number, width: string) => {
    const box = await handle.boundingBox()

    if (!box) throw new Error("vertical tab resize handle has no bounding box")
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + offset, box.y + box.height / 2)
    await page.mouse.up()
    await expect(sidebar).toHaveCSS("width", width)
  }

  await resize(-44, "196px")
  await resize(-40, "156px")

  for (const name of ["Home", "New session"]) {
    const label = sidebar.getByRole("button", { name, exact: true }).getByText(name, { exact: true })
    await expect(label).toBeVisible()
    await expect
      .poll(() => label.evaluate((element) => element.scrollWidth - element.clientWidth), { message: name })
      .toBeLessThanOrEqual(1)
  }

  await resize(-200, "136px")
  const homeLabel = sidebar.getByRole("button", { name: "Home", exact: true }).getByText("Home", { exact: true })
  await expect
    .poll(() => homeLabel.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await resize(800, "640px")
  await resize(-380, "260px")

  const scroll = sidebar.locator('[data-slot="vertical-tabs-scroll"]')

  // The list feathers only the edges with more rows past them.
  const feather = () =>
    scroll.evaluate((element) => {
      const style = getComputedStyle(element)

      return [style.getPropertyValue("--vertical-tabs-fade-top"), style.getPropertyValue("--vertical-tabs-fade-bottom")]
    })

  await expect.poll(feather).toEqual(["0px", "16px"])
  await scroll.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(tabB).toBeInViewport({ ratio: 1 })
  await expect.poll(feather).toEqual(["16px", "0px"])

  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"))
  const home = sidebar.locator('[data-action="vertical-tabs-home"]')

  const hint = home.locator('div[aria-hidden="true"]')
  await expect(hint.locator('[data-slot="keybind-v2-label"]')).toHaveText(["Ctrl", "Alt", "H"])
  await expect(hint.locator('[data-component="keybind-v2"]')).toHaveCSS("direction", "ltr")
  await expect(hint).toBeHidden()
  await home.focus()
  await expect(hint).toBeVisible()

  await tabB.click()
  await expectPath(page, sessionHref(b.id))
})

test.describe("vertical tabs on a touch desktop", () => {
  test.use({ hasTouch: true })

  test("long titles fade out before the always-visible close button", async ({ page }) => {
    const long = {
      id: "ses_tab_long",
      title: "A long session title that would otherwise run underneath the close button",
    }

    await mockWorkspace(page, {
      name: "Tabs",
      sessions: [long],
      seed: { settings: { appearance: { tabLayout: "vertical" } } },
    })
    await page.goto(sessionHref(long.id))

    const tab = page.locator('[data-slot="vertical-tabs-sidebar"] [data-titlebar-tab]')
    await expect(tab).toHaveAttribute("data-title-overflow", "true")
    await expect(tab.getByRole("button", { name: "Close tab", exact: true })).toHaveCSS("opacity", "1")
    await expect
      .poll(() =>
        tab.evaluate((element) => {
          const link = element.querySelector('[data-slot="tab-link"]')!.getBoundingClientRect()

          const close = element.querySelector('[data-slot="tab-close"]')!.getBoundingClientRect()

          const stops = [
            ...getComputedStyle(element.querySelector('[data-slot="tab-link"]')!).maskImage.matchAll(
              /calc\(100% - ([\d.]+)px\)/g,
            ),
          ].map((match) => Number(match[1]))

          return link.right - Math.min(...stops) <= close.left
        }),
      )
      .toBe(true)
  })
})

for (const [screen, href] of [
  ["home", "/"],
  ["new session", draftHref("draft_collapsed_sidebar")],
  ["settings", "/settings"],
  ["session", sessionHref(a.id)],
] as const) {
  test(`collapsed vertical tabs sidebar reopens from the ${screen} screen`, async ({ page }) => {
    await mockWorkspace(page, {
      name: "Tabs",
      sessions: [a],
      seed: {
        settings: { appearance: { tabLayout: "vertical", tabGrouping: "none", sidebarOpen: false } },
        tabs: [a.id, { draft: "draft_collapsed_sidebar", directory: "C:/OpenCode/Tabs" }],
      },
    })
    await page.goto(href)

    const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
    await expect(sidebar).toHaveAttribute("data-state", "closed")
    await page
      .locator('[data-slot="collapsed-sidebar-toggle"]')
      .getByRole("button", { name: "Toggle sidebar", exact: true })
      .click()
    await expect(sidebar).toHaveAttribute("data-state", "open")
    await expect(sidebar.getByRole("button", { name: "Toggle sidebar", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })
}

test("the collapsed sidebar peeks from a resting toggle, Escape cancels a pending peek, and a click docks it", async ({
  page,
}) => {
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a],
    seed: { settings: { appearance: { tabLayout: "vertical", sidebarOpen: false } } },
  })
  await page.goto(sessionHref(a.id))

  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')

  const toggle = page
    .locator('[data-slot="collapsed-sidebar-toggle"]')
    .getByRole("button", { name: "Toggle sidebar", exact: true })

  await expect(sidebar).toHaveAttribute("data-state", "closed")
  await expect(toggle).toBeVisible()
  // See "tab preview opens cold": pause at a fixed offset from an explicit install time.
  const start = Date.now()
  await page.clock.install({ time: start })
  await page.clock.pauseAt(start + 10_000)

  // The toggle's 500ms dwell, cut short by Escape, never peeks.
  await toggle.hover()
  await page.keyboard.press("Escape")
  await page.clock.runFor(600)
  await expect(sidebar).not.toHaveAttribute("data-peek")

  await page.mouse.move(600, 400)
  await toggle.hover()
  await page.clock.runFor(600)
  await expect(sidebar).toHaveAttribute("data-peek", "")

  // Docking from the peek hands the sidebar over, and the peek ends once the dock lands.
  await toggle.click()
  await page.clock.runFor(2000)
  await expect(sidebar).toHaveAttribute("data-state", "open")
  await expect(sidebar).not.toHaveAttribute("data-peek")
})

test("vertical tab gaps hover and select the nearest row", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b, c],
    seed: { settings: { appearance: { tabLayout: "vertical", tabGrouping: "none" } } },
  })
  await page.goto(sessionHref(a.id))

  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const rows = sidebar.locator("[data-titlebar-tab]")
  const tabB = rows.filter({ has: page.locator(`a[href="${sessionHref(b.id)}"]`) })
  const tabC = rows.filter({ has: page.locator(`a[href="${sessionHref(c.id)}"]`) })
  await expect(rows.locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title, c.title])
  const upper = await tabB.boundingBox()
  const lower = await tabC.boundingBox()

  if (!upper || !lower) throw new Error("vertical tabs have no bounding boxes")
  expect(lower.y - upper.y - upper.height).toBe(3)

  const middle = upper.y + upper.height + 1.5

  // The two halves belong to their nearest row; an exact tie belongs to the next row.
  for (const [offset, id] of [
    [-1, b.id],
    [0, c.id],
  ] as const) {
    await page.mouse.move(upper.x + upper.width / 2, middle + offset)
    await expect(sidebar.locator("[data-titlebar-tab]:hover [data-titlebar-tab-link]")).toHaveAttribute(
      "href",
      sessionHref(id),
    )
  }

  await page.mouse.click(upper.x + upper.width / 2, middle)
  await expectPath(page, sessionHref(c.id))

  await page.mouse.move(upper.x + upper.width / 2, middle - 1)
  await page.mouse.down()
  await page.mouse.move(upper.x + upper.width / 2, lower.y + lower.height - 2, { steps: 8 })
  await page.mouse.up()
  await expect(rows.locator("[data-titlebar-tab-title]")).toHaveText([a.title, c.title, b.title])

  await tabB.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(rows.locator("[data-titlebar-tab-title]")).toHaveText([a.title, c.title])
  await expectPath(page, sessionHref(c.id))

  const list = await sidebar.locator("[data-titlebar-tab-list]").boundingBox()

  if (!list) throw new Error("vertical tab list has no bounding box")

  for (const [x, y] of [
    [list.x + list.width / 2, list.y - 1],
    [list.x + list.width / 2, list.y + list.height + 1],
    [list.x - 1, list.y + list.height / 2],
    [list.x + list.width + 1, list.y + list.height / 2],
  ]) {
    await page.mouse.move(x, y)
    await expect(sidebar.locator("[data-titlebar-tab]:hover")).toHaveCount(0)
  }
})

test("tab preview opens cold, switches immediately between tabs, and closes outside the strip", async ({ page }) => {
  const d = { id: "ses_tab_d", title: "Library" }
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b, c, d],
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const rows = sidebar.locator("[data-titlebar-tab]")
  const tabB = rows.filter({ has: page.locator(`a[href="${sessionHref(b.id)}"]`) })
  const tabC = rows.filter({ has: page.locator(`a[href="${sessionHref(c.id)}"]`) })
  const preview = page.locator('[data-component="session-tab-popover"]')
  await expect(rows.locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title, c.title, d.title])
  // Until it is paused the installed clock follows real time, and it starts slightly ahead of the runner's wall clock,
  // so `pauseAt(new Date())` can name an instant the page has already passed. Pause at a fixed offset from an explicit
  // install time instead; the offset only has to outlast the real time between the two calls.
  const start = Date.now()
  await page.clock.install({ time: start })
  await page.clock.pauseAt(start + 10_000)
  await tabB.hover()
  await page.clock.runFor(700)
  await expect(preview).toHaveCount(0)
  await page.clock.runFor(50)
  await expect(preview).toContainText(b.title)
  await page.clock.runFor(10_000)
  await expect(preview).toContainText(b.title)

  const box = await tabB.boundingBox()

  if (!box) throw new Error("vertical tab has no bounding box")
  // The 3px gap cannot split evenly into whole pixels; the upper row keeps the first one.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 0.5)
  await page.clock.runFor(1000)
  await expect(preview).toContainText(b.title)
  await tabB.getByRole("button", { name: "Close tab", exact: true }).hover()
  await page.clock.runFor(1000)
  await expect(preview).toContainText(b.title)
  await tabC.hover({ position: { x: box.width - 1, y: box.height / 2 } })
  await page.clock.runFor(20)
  await expect(preview).toHaveCount(1)
  await expect(preview).toContainText(c.title)

  await expect(preview).toHaveCSS("pointer-events", "none")
  await rows.filter({ has: page.locator(`a[href="${sessionHref(d.id)}"]`) }).hover()
  await page.clock.runFor(20)
  await expect(preview).toHaveCount(1)
  await expect(preview).toContainText(d.title)
  const card = await preview.boundingBox()

  if (!card) throw new Error("tab preview has no bounding box")
  // The card is informational: entering its painted area leaves the tab strip.
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
  await page.clock.runFor(20)
  await expect(preview).toHaveCount(0)

  await tabB.hover()
  await page.clock.runFor(800)
  await expect(preview).toContainText(b.title)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 20, { steps: 8 })
  await page.clock.runFor(1000)
  await expect(preview).toHaveCount(0)
  await page.mouse.up()

  // Removing an open tab must not leave the shared preview state permanently warm.
  await tabB.hover()
  await page.clock.runFor(800)
  await expect(preview).toContainText(b.title)
  await tabB.getByRole("button", { name: "Close tab", exact: true }).click()
  await page.mouse.move(900, 500)
  await page.clock.runFor(600)
  await tabC.hover()
  await page.clock.runFor(700)
  await expect(preview).toHaveCount(0)
  await page.clock.runFor(50)
  await expect(preview).toContainText(c.title)
})

test("closing the active server's last tab opens the remaining server tab", async ({ page }) => {
  const sessionA = session({ id: "ses_server_a", directory: "C:/server-a", title: "Server A session" })
  const sessionB = session({ id: "ses_server_b", directory: "/home/server-b", title: "Server B session" })
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "OPTIONS") requests.push(request.url())
  })
  await twoServers(page, { a: [sessionA], b: [sessionB] })
  await page.goto(sessionHref(sessionA.id))
  await expectSessionTitle(page, sessionA.title)

  await page
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionA.id)}"])`)
    .getByRole("button", { name: "Close tab", exact: true })
    .click()

  await expectPath(page, sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)
  const reads = requests.filter((url) => url.includes(`/session/${sessionB.id}`))
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.filter((url) => !url.startsWith(REMOTE_SERVER))).toEqual([])
})

test("a remote tab stays busy while a child session runs", async ({ page }) => {
  const sessionA = session({ id: "ses_server_a", directory: "C:/server-a", title: "Server A session" })
  const sessionB = session({ id: "ses_server_b", directory: "/home/server-b", title: "Server B session" })
  const child = session({ id: "ses_server_b_child", directory: sessionB.directory, parentID: sessionB.id })
  await twoServers(page, { a: [sessionA], b: [sessionB, child], running: child.id })
  await page.goto(sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)

  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionB.id, REMOTE_SERVER)}"])`)
  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionA.id)}"])`)
  await expect(tabB.locator('[data-component="activity-ring"]')).toBeVisible()
  await expect(tabA.locator("[data-titlebar-tab-title]")).toHaveText(sessionA.title)
  await expect(tabA.locator('[data-component="activity-ring"]')).toBeHidden()
})

test("inactive tabs stay busy while work waits in their inbox, and pulse on a new prompt, as in the TUI", async ({
  page,
}) => {
  const workspace = await openSession(page, {
    name: "TabInbox",
    sessions: [a, b, c],
    inbox: [
      {
        id: "inb_tab_b",
        sessionID: b.id,
        time: { created: 1 },
        type: "user",
        payload: { text: "Queued follow-up" },
        delivery: "queue",
      },
      // Parked synthetic context, such as a user shell's output, waits without work.
      {
        id: "inb_tab_c",
        sessionID: c.id,
        time: { created: 1 },
        type: "synthetic",
        payload: { text: "Shell output", description: "Shell finished" },
        delivery: "steer",
      },
    ],
  })

  const tab = (id: string) => page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(id)}"])`)
  const progress = '[data-component="activity-ring"]'

  await expect(tab(b.id).locator(progress)).toBeVisible()
  await expect(tab(c.id).locator("[data-titlebar-tab-title]")).toHaveText(c.title)
  await expect(tab(c.id).locator(progress)).toBeHidden()
  await expect(tab(c.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
  // The pulse lasts one animation, so record that it appeared rather than racing its removal.
  await tab(c.id).evaluate((element) => {
    const observer = new MutationObserver(() => {
      if (!element.querySelector('[data-slot="tab-prompt-pulse"]')) return
      element.setAttribute("data-test-pulsed", "")
      observer.disconnect()
    })

    observer.observe(element, { childList: true, subtree: true })
  })

  await workspace.push([
    {
      id: "evt_tab_c_prompt",
      created: 2,
      type: "session.inbox.enqueued",
      durable: { aggregateID: c.id, seq: 1, version: 1 },
      data: {
        sessionID: c.id,
        inboxID: "inb_tab_c_prompt",
        item: { type: "user", payload: { text: "Another client's prompt" }, delivery: "queue" },
      },
    } satisfies Extract<OpenCodeEvent, { type: "session.inbox.enqueued" }>,
  ])

  await expect(tab(c.id)).toHaveAttribute("data-test-pulsed", "")
  await expect(tab(c.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
  await expect(tab(c.id).locator(progress)).toBeVisible()
  await expect(tab(a.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
})

test("switching between busy sessions keeps the busy indicators and the activity capsule at rest", async ({ page }) => {
  const children = [
    { id: "ses_tab_a_child", title: "Map the orchard", parentID: a.id },
    { id: "ses_tab_b_child", title: "Chart the harbor", parentID: b.id },
  ]

  await mockWorkspace(page, {
    name: "TabActivity",
    sessions: [a, b, ...children],
    sessionStatus: Object.fromEntries(children.map((child) => [child.id, { type: "running" as const }])),
    seed: { settings: { appearance: { tabLayout: "vertical" } }, tabs: [a.id, b.id] },
  })
  await page.goto(sessionHref(a.id))
  await expectSessionTitle(page, a.title)

  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const indicators = sidebar.locator('[data-titlebar-tab-slot] [data-component="activity-ring"]')
  const capsule = page.locator('[data-slot="session-activity-chip"]')
  await expect(indicators).toHaveCount(2)
  await expect(capsule).toHaveText("1 subagent")
  await expect(capsule).toHaveCSS("opacity", "1")

  // Record any capsule animation or any moment without a capsule, and mark the indicators to compare them later. The
  // capsule's spinner always runs its own phase-synced loop, so only an animation of the capsule itself counts.
  await page.evaluate(() => {
    const record = document.documentElement
    document.addEventListener("animationstart", (event) => {
      if (event.target instanceof Element && event.target.matches('[data-slot="session-activity-chip"]'))
        record.setAttribute("data-test-capsule-animated", "")
    })
    new MutationObserver(() => {
      if (!document.querySelector('[data-slot="session-activity-chip"]'))
        record.setAttribute("data-test-capsule-missing", "")
    }).observe(document.body, { childList: true, subtree: true })
    document
      .querySelectorAll('[data-slot="vertical-tabs-sidebar"] [data-titlebar-tab-slot] [data-component="activity-ring"]')
      .forEach((element) => element.setAttribute("data-test-before-switch", ""))
  })

  await sidebar.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click()
  await expectSessionTitle(page, b.title)
  await expect(page.locator('[data-component="session-activity-chips"]')).toHaveCount(1)
  await expect(capsule).toHaveText("1 subagent")
  await capsule.click()
  await expect(page.locator('[data-slot="session-activity-panel"]')).toContainText(children[1]!.title)

  await expect(indicators.and(page.locator("[data-test-before-switch]"))).toHaveCount(2)
  await expect(page.locator("html")).not.toHaveAttribute("data-test-capsule-missing")
  await expect(page.locator("html")).not.toHaveAttribute("data-test-capsule-animated")
})

test("selecting a tab with waiting work waits for its transcript instead of showing only the inbox", async ({
  page,
}) => {
  await openSession(page, {
    name: "TabInboxTranscript",
    sessions: [a, b],
    pageMessages: (id) => ({
      items:
        id === b.id ? [{ id: "msg_tab_b_history", type: "user", text: "Earlier prompt", time: { created: 1 } }] : [],
    }),
    inbox: [
      {
        id: "inb_tab_b_steer",
        sessionID: b.id,
        time: { created: 2 },
        type: "user",
        payload: { text: "Pending steer" },
        delivery: "steer",
      },
    ],
  })
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  // The inactive tab read its inbox, which materializes the pending steer as a transcript row.
  await expect(tabB.locator('[data-component="activity-ring"]')).toBeVisible()

  const transcript = await holdRoute(page, (url) => url.pathname === `/api/session/${b.id}/message`)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click()
  await transcript.arrived
  await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(0)

  transcript.release()
  await expect(page.locator('[data-timeline-row="UserMessage"][data-message-id="msg_tab_b_history"]')).toContainText(
    "Earlier prompt",
  )
  await expect(page.locator('[data-timeline-row="UserMessage"][data-message-id="inb_tab_b_steer"]')).toContainText(
    "Pending steer",
  )
})

test("inactive tabs load attention and inbox, but read the transcript only on selection", async ({ page }) => {
  const reads: string[] = []
  const mutations: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && !response.ok())
      errors.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (!path.startsWith("/api/")) return

    if (request.method() === "GET") reads.push(path)

    if (request.method() === "DELETE" || /\/(interrupt|prompt)$/.test(path)) mutations.push(path)
  })
  const state = { text: "Original fixture answer" }
  await mockStressTimeline(page, {
    sessionStatus: { [fixture.childID]: { type: "running" } },
    pageMessages: (id) => ({
      items: [
        { id: `msg_${id}_user`, type: "user", text: "Review the renderer change", time: { created: 1 } },
        {
          id: `msg_${id}_assistant`,
          type: "assistant",
          agent: "build",
          model: { id: "claude-opus-4-6", providerID: "opencode" },
          content: [{ type: "text", text: state.text }],
          time: { created: 2, completed: 3 },
        },
      ],
    }),
  })
  await seed(page, {
    tabs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })

  const attention = Promise.all([
    ...["permission", "form", "inbox"].map((kind) =>
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/session/${fixture.childID}/${kind}`,
      ),
    ),
    page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${fixture.targetID}/inbox`),
  ])

  await page.goto(sessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.sourceID}_assistant:text:0"]`)).toContainText(
    state.text,
  )
  await attention
  expect(reads.filter((path) => path === `/api/session/${fixture.targetID}/permission`)).toEqual([])
  expect(reads.filter((path) => path === `/api/session/${fixture.targetID}/form`)).toEqual([])

  const child = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(fixture.childID)}"])`)
  await child.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(child).toHaveCount(0)
  await expectPath(page, sessionHref(fixture.sourceID))

  state.text = "Latest fixture answer after tab restoration"
  await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(fixture.targetID)}"]`).click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.targetID}_assistant:text:0"]`)).toContainText(
    state.text,
  )

  // Every tab reads its inbox once, since waiting work keeps a tab busy; selection reuses that read.
  for (const id of [fixture.sourceID, fixture.targetID, fixture.childID])
    expect(reads.filter((path) => path === `/api/session/${id}/inbox`)).toHaveLength(1)

  for (const id of [fixture.sourceID, fixture.targetID])
    expect(reads.filter((path) => path === `/api/session/${id}/message`)).toHaveLength(1)

  expect(reads.filter((path) => path === `/api/session/${fixture.childID}/message`)).toEqual([])
  expect(mutations).toEqual([])
  expect(errors).toEqual([])
})

test("five loaded workspace tabs stay rendered and reactive through repeated switches", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  const sessions = Array.from({ length: 5 }, (_, index) => ({
    ...fixture.sessions[0]!,
    id: `ses_workspace_cycle_${index}`,
    directory: `${fixture.directory}/worktree-${index}`,
    title: `Workspace session ${index}`,
  }))

  const mock = await mockStressTimeline(page, {
    sessions,
    pageMessages: (id) => ({
      items: [
        { id: `msg_user_${id}`, type: "user", text: `Prompt for ${id}`, time: { created: 1 } },
        {
          id: `msg_assistant_${id}`,
          type: "assistant",
          agent: "build",
          model: { id: "claude-opus-4-6", providerID: "opencode" },
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: `Answer for ${id}` }],
        },
      ] satisfies SessionMessageInfo[],
    }),
  })

  // Each worktree session resolves to its own location in the shared project (the mock echoes the requested one).
  await seed(page, {
    tabs: sessions.map((item) => item.id),
  })
  await page.goto(sessionHref(sessions[0]!.id))
  await expect(page.getByText(`Answer for ${sessions[0]!.id}`, { exact: true })).toBeVisible()

  for (const item of [...sessions.slice(1), ...sessions, ...sessions.toReversed()]) {
    await page.locator(`[data-titlebar-tab-link][href="${sessionHref(item.id)}"]`).click()
    await expect(page.locator(`[data-timeline-part-id="msg_assistant_${item.id}:text:0"]`)).toBeVisible()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
  }

  const active = sessions[0]!
  await mock.push([
    {
      id: "evt_workspace_cycle_update",
      created: 4,
      type: "session.text.ended",
      location: { directory: active.directory },
      durable: { aggregateID: active.id, seq: 0, version: 1 },
      data: {
        sessionID: active.id,
        assistantMessageID: `msg_assistant_${active.id}`,
        ordinal: 0,
        text: "Still receiving updates",
      },
    },
  ])
  await expect(page.getByText("Still receiving updates", { exact: true })).toBeVisible()
})

test("each session tab shows its own file tab after a switch to a session in another folder", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/OpenCode/FolderSwitch"
  const alpha = { id: "ses_folderswitch_alpha", title: "Folder switch alpha" }
  const beta = { id: "ses_folderswitch_beta", title: "Folder switch beta" }
  const other = { id: "ses_folderswitch_other", title: "Folder switch other", directory: "C:/OpenCode/FolderOther" }
  await openSession(page, {
    name: "FolderSwitch",
    sessions: [alpha, beta, other],
    fileList: (path) => (path ? [] : ["greet.ts", "guide.md", "notes.txt"].map((file) => fileNode(directory, file))),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: { panes: Object.fromEntries([alpha, beta, other].map((item) => [item.id, { review: true }])) },
  })
  const panel = page.locator("#review-panel")

  const shows = async (file: string) => {
    await expect(panel.getByRole("tab", { name: file, exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(panel.getByText(`contents:${file}`, { exact: true })).toBeVisible()
  }

  const visit = async (target: { id: string; title: string }) => {
    await page.locator(`[data-titlebar-tab-link][href="${sessionHref(target.id)}"]`).click()
    await expectSessionTitle(page, target.title)
  }

  const open = async (file: string) => {
    await openFileLauncher(panel)
    await panel.getByRole("treeitem", { name: file, exact: true }).click()
    await shows(file)
  }

  await open("greet.ts")
  await visit(other)
  await open("notes.txt")
  await visit(beta)
  await open("guide.md")

  // The session screen stays mounted while the route moves between folders, and each tab reads its own folder.
  for (const [target, file] of [
    [alpha, "greet.ts"],
    [other, "notes.txt"],
    [beta, "guide.md"],
    [other, "notes.txt"],
    [alpha, "greet.ts"],
  ] as const) {
    await visit(target)
    await shows(file)
  }
})

test("tab shortcuts cycle side-panel tabs when the side panel is focused with multiple tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/OpenCode/SidePanelTabs"
  const alpha = { id: "ses_side_tabs_alpha", title: "Side tabs alpha" }
  const beta = { id: "ses_side_tabs_beta", title: "Side tabs beta" }
  await openSession(page, {
    name: "SidePanelTabs",
    sessions: [alpha, beta],
    fileList: (path) => (path ? [] : ["README.md"].map((file) => fileNode(directory, file))),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { [alpha.id]: { review: true }, [beta.id]: { review: true } },
      storage: reviewTabs(directory, alpha.id),
    },
  })

  const panel = page.locator("#review-panel")
  const reviewTab = panel.getByRole("tab", { name: "Review", exact: true })
  const fileTab = panel.getByRole("tab", { name: "README.md", exact: true })
  const composer = page.getByRole("textbox", { name: "Prompt", exact: true })

  await openFileLauncher(panel)
  await panel.getByRole("treeitem", { name: "README.md", exact: true }).click()
  await expect(fileTab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()

  // Focus outside the side panel still cycles session tabs even when multiple side-panel tabs are open.
  await composer.click()
  await page.keyboard.press("Control+Tab")
  await expectPath(page, sessionHref(beta.id))
  await page.keyboard.press("ControlOrMeta+Alt+ArrowLeft")
  await expectPath(page, sessionHref(alpha.id))
  await expect(fileTab).toHaveAttribute("aria-selected", "true")

  // Focus inside the side panel cycles the drawn side-panel tabs and keeps focus inside the side panel.
  await panel.getByText("contents:README.md", { exact: true }).click()
  await page.keyboard.press("Control+Tab")
  await expect(reviewTab).toHaveAttribute("aria-selected", "true")
  await expectPath(page, sessionHref(alpha.id))

  await page.keyboard.press("Control+Tab")
  await expect(fileTab).toHaveAttribute("aria-selected", "true")
  await expectPath(page, sessionHref(alpha.id))

  await page.keyboard.press("Control+Shift+Tab")
  await expect(reviewTab).toHaveAttribute("aria-selected", "true")
  await expectPath(page, sessionHref(alpha.id))

  await page.keyboard.press("ControlOrMeta+Alt+ArrowRight")
  await expect(fileTab).toHaveAttribute("aria-selected", "true")
  await expectPath(page, sessionHref(alpha.id))

  await page.keyboard.press("ControlOrMeta+Alt+ArrowLeft")
  await expect(reviewTab).toHaveAttribute("aria-selected", "true")
  await expectPath(page, sessionHref(alpha.id))

  // Once only one side-panel tab remains, the shortcut returns to cycling session tabs.
  await page.keyboard.press("Control+Tab")
  await expect(fileTab).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ControlOrMeta+w")
  await expect(fileTab).toHaveCount(0)
  await expect(reviewTab).toHaveAttribute("aria-selected", "true")
  await reviewTab.click()
  await page.keyboard.press("Control+Tab")
  await expectPath(page, sessionHref(beta.id))
})

test("⌘W past the side panel's last tab keeps the session tab", async ({ page }) => {
  const sessions = await emptySidePanel(page)
  await page.keyboard.press("ControlOrMeta+w")

  // From the composer ⌘W closes the session tab, so only a swallowed press above leaves Beta to land on.
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click()
  await page.keyboard.press("ControlOrMeta+w")
  await expectPath(page, sessionHref(sessions.beta.id))
  await expect(sessions.alphaTab).toHaveCount(0)
})

test("⌘W past the side panel's last tab keeps the session tab when focus leaves the panel just after", async ({
  page,
}) => {
  // Stands in for a panel that hands focus back after its close rather than during it.
  await page.addInitScript(() => {
    const observer = new MutationObserver((records) => {
      const hidden = records.some(
        (record) =>
          record.target instanceof Element &&
          record.target.id === "review-panel" &&
          record.target.getAttribute("aria-hidden") === "true",
      )

      if (!hidden) return
      observer.disconnect()
      document.querySelector<HTMLElement>('[data-component="composer-editor"]')?.focus()
    })

    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ["aria-hidden"] })
  })

  const sessions = await emptySidePanel(page)
  const composer = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(composer).toBeFocused()
  await page.keyboard.press("ControlOrMeta+w")

  // Only a swallowed press above leaves Beta for this one to land on.
  await composer.click()
  await page.keyboard.press("ControlOrMeta+w")
  await expectPath(page, sessionHref(sessions.beta.id))
  await expect(sessions.alphaTab).toHaveCount(0)
})

test("⌘W closes the session tab again once the window loses focus after the side panel empties", async ({ page }) => {
  const sessions = await emptySidePanel(page)
  // ⌘Tab away and back sends no click or key the page sees.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")))
  await page.keyboard.press("ControlOrMeta+w")
  await expectPath(page, sessionHref(sessions.beta.id))
  await expect(sessions.alphaTab).toHaveCount(0)
})

test("⌘W in the side panel closes its last New tab with the panel, and only then the session tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const alpha = { id: "ses_side_new_alpha", title: "Side new alpha" }
  const beta = { id: "ses_side_new_beta", title: "Side new beta" }
  await openSession(page, { name: "SideCloseNewTab", sessions: [alpha, beta] })

  const panel = page.locator("#review-panel")
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  const newTab = panel.getByRole("tab", { name: "New tab", exact: true })
  const composer = page.getByRole("textbox", { name: "Prompt", exact: true })
  const alphaTab = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(alpha.id)}"])`)

  await composer.click()
  await page.keyboard.press("ControlOrMeta+Shift+R")
  await expect(newTab).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => panel.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  // A launcher row in the New tab view holds focus as ⌘W removes it.
  await panel.getByRole("button", { name: /^Open file/ }).focus()

  // The New tab was the panel's last tab, so closing it closes the panel too, and focus goes back.
  await page.keyboard.press("ControlOrMeta+w")
  await expect(newTab).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(composer).toBeFocused()

  // One press too many closes nothing rather than the session.
  await page.keyboard.press("ControlOrMeta+w")
  await expect(alphaTab).toHaveCount(1)
  await expectPath(page, sessionHref(alpha.id))

  // With no panel open, ⌘W from the composer closes the session tab.
  await composer.click()
  await page.keyboard.press("ControlOrMeta+w")
  await expectPath(page, sessionHref(beta.id))
  await expect(alphaTab).toHaveCount(0)
})

// Windows has no native menu bar: the titlebar menu owns Paste, which only the desktop edit action can perform.
test("the Windows titlebar menu pastes through the desktop edit action", async ({ page }) => {
  await mockWorkspace(page, { name: "WindowsMenu", sessions: [] })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER })}`)
  await page.getByRole("button", { name: "OpenCode menu", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const paste = page.getByRole("menuitem", { name: /^Paste/ })
  await expect(paste).toHaveText("PasteCtrl+V")
  await paste.click()
  await expect(page.getByRole("status", { name: "Desktop menu actions" })).toHaveText("edit.paste")
})

test("the Windows menu shares the vertical sidebar's icon lane", async ({ page }) => {
  await mockWorkspace(page, {
    name: "WindowsMenu",
    sessions: [],
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
  })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER })}`)

  const menu = page.getByRole("button", { name: "OpenCode menu", exact: true }).locator("svg")

  const home = page.locator('[data-action="vertical-tabs-home"] svg')
  await expect(home).toBeVisible()
  await expect.poll(async () => [(await menu.boundingBox())?.x, (await home.boundingBox())?.x]).toEqual([19, 19])
})

for (const row of [
  { name: "left tabs", width: 1280, settings: { appearance: { tabLayout: "vertical" } }, position: { x: 20, y: 25 } },
  { name: "top tabs", width: 1280, settings: { appearance: { tabLayout: "horizontal" } }, position: { x: 14, y: 15 } },
  {
    name: "a bottom titlebar",
    width: 700,
    settings: { general: { mobileTitlebarPosition: "bottom" } },
    position: { x: 14, y: 14 },
  },
]) {
  test(`macOS traffic lights center on the header line with ${row.name}`, async ({ page }) => {
    await page.setViewportSize({ width: row.width, height: 720 })
    await mockWorkspace(page, { name: "TrafficLights", sessions: [], seed: { settings: row.settings } })
    await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER, os: "macos" })}`)
    await expect(page.getByRole("status", { name: "Traffic lights" })).toHaveText(JSON.stringify(row.position))
  })
}

// Server A is the default origin; B is a remote that answers only for its own directories.
async function twoServers(
  page: Page,
  input: {
    a: ReturnType<typeof session>[]
    b: ReturnType<typeof session>[]
    running?: string
  },
) {
  const config = (sessions: ReturnType<typeof session>[], id: string) => {
    const directory = String(sessions[0]!.directory)

    return {
      directory,
      project: project({ id, directory }),
      provider: NO_PROVIDER,
      sessions,
      pageMessages: () => ({ items: [] }),
      strictDirectory: true,
    }
  }

  await mockServers(page, {
    [SERVER]: config(input.a, "proj_server_a"),
    [REMOTE_SERVER]: {
      ...config(input.b, "proj_server_b"),
      sessionStatus: input.running ? { [input.running]: { type: "running" } } : {},
    },
  })
  await seed(page, {
    servers: [REMOTE_SERVER],
    tabs: [input.a[0]!.id, { session: input.b[0]!.id, server: REMOTE_SERVER }],
  })
}

for (const layout of ["vertical", "sidebar"] as const) {
  test(`loads a tab's transcript while the pointer rests on it, and not when it passes over in ${layout}`, async ({
    page,
  }) => {
    const requested: string[] = []
    const warnings: string[] = []
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("computations created outside"))
        warnings.push(message.text())
    })
    page.on("request", (request) => {
      const id = new URL(request.url()).pathname.match(/^\/api\/session\/([^/]+)\/message$/)?.[1]

      if (id && request.method() === "GET") requested.push(id)
    })

    await mockWorkspace(page, {
      name: "HoverPrefetch",
      sessions: [a, b, c],
      pageMessages: pageMessagesFrom(
        Object.fromEntries(
          [a, b, c].map((item): [string, SessionMessageInfo[]] => [
            item.id,
            [{ id: `msg_${item.id}`, type: "user", time: { created: 1700000000000 }, text: item.title }],
          ]),
        ),
      ),
      seed: { settings: { appearance: { tabLayout: layout } } },
    })
    await page.goto(sessionHref(a.id))
    await expectSessionTitle(page, a.title)
    const tab = (id: string) => page.locator(`[data-slot="vertical-tabs"] a[href="${sessionHref(id, SERVER)}"]`)
    const message = (id: string) => page.locator(`[data-timeline-virtual-content] [data-message-id="msg_${id}"]`)
    await expect(message(a.id)).toBeVisible()

    // Raw moves keep the pass well under the dwell, which hover() actionability checks can exceed on slow runners.
    const [passed, rest] = await Promise.all([tab(c.id).boundingBox(), tab(a.id).boundingBox()])

    await page.mouse.move(passed!.x + passed!.width / 2, passed!.y + passed!.height / 2)
    await page.mouse.move(rest!.x + rest!.width / 2, rest!.y + rest!.height / 2)
    await tab(b.id).hover()
    await expect.poll(() => requested.includes(b.id)).toBe(true)
    // A dwell started by the pass would have fired before the one on the rested tab.
    expect(requested).not.toContain(c.id)

    await tab(b.id).click()
    await expect(message(b.id)).toBeVisible()
    expect(requested.filter((id) => id === b.id)).toHaveLength(1)
    // Solid's development runtime reports computations created by event handlers without a component owner.
    expect(warnings).toEqual([])
  })
}

test("⌘W in a focused Context tab closes it, then the panel, and keeps the session tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const alpha = { id: "ses_side_context_alpha", title: "Side context alpha" }
  const beta = { id: "ses_side_context_beta", title: "Side context beta" }
  await openSession(page, { name: "SideCloseContext", sessions: [alpha, beta] })

  const panel = page.locator("#review-panel")
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  const context = panel.getByRole("tab", { name: "Context", exact: true })
  const alphaTab = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(alpha.id)}"])`)

  await page.getByRole("button", { name: "Toggle session context" }).click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await panel.click({ position: { x: 100, y: 300 } })
  await page.keyboard.press("ControlOrMeta+w")
  await expect(context).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(alphaTab).toHaveCount(1)
  await expectPath(page, sessionHref(alpha.id))
})

// Closes Alpha's side tabs with ⌘W until the side panel empties and collapses, as an overshooting hand would.
async function emptySidePanel(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/OpenCode/SideCloseOvershoot"
  const alpha = { id: "ses_side_close_alpha", title: "Side close alpha" }
  const beta = { id: "ses_side_close_beta", title: "Side close beta" }
  await openSession(page, {
    name: "SideCloseOvershoot",
    sessions: [alpha, beta],
    fileList: (path) => (path ? [] : ["README.md"].map((file) => fileNode(directory, file))),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { [alpha.id]: { review: true }, [beta.id]: { review: true } },
      storage: reviewTabs(directory, alpha.id),
    },
  })

  const panel = page.locator("#review-panel")
  const reviewTab = panel.getByRole("tab", { name: "Review", exact: true })
  const fileTab = panel.getByRole("tab", { name: "README.md", exact: true })

  await openFileLauncher(panel)
  await panel.getByRole("treeitem", { name: "README.md", exact: true }).click()
  await expect(fileTab).toHaveAttribute("aria-selected", "true")
  await panel.getByText("contents:README.md", { exact: true }).click()
  await page.keyboard.press("ControlOrMeta+w")
  await expect(fileTab).toHaveCount(0)
  await expect(reviewTab).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ControlOrMeta+w")
  await expect(panel).toHaveAttribute("aria-hidden", "true")

  return { beta, alphaTab: page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(alpha.id)}"])`) }
}

test("opening a session from the inbox keeps the list's scroll position and rows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })

  const sessions = Array.from({ length: 24 }, (_, index) => ({
    id: `ses_inbox_${String(index).padStart(2, "0")}`,
    title: `Inbox session ${index}`,
    directory: index === 14 ? "C:/OpenCode/Inbox/worktrees/unopened" : "C:/OpenCode/Inbox",
    time: { created: T0, updated: T0 + 100 - index, idle: T0 + index, viewed: T0 + 100 },
  }))

  await mockWorkspace(page, {
    name: "Inbox",
    sessions,
    vcs: { current: "dev", default: "dev" },
    seed: {
      settings: { appearance: { tabLayout: "inbox" } },
      tabs: [],
      storage: { "opencode.global.dat:sidebar.inbox": { workingExpanded: true } },
    },
  })
  await page.goto("/")

  const list = page.locator('[data-slot="sidebar-inbox-scroll"]')
  const items = list.locator('[data-slot="sidebar-inbox-item"]')
  const target = items.filter({ hasText: "Inbox session 14" })
  await expect(items).toHaveCount(10)
  await expect(items).toContainText(Array.from({ length: 10 }, (_, index) => `Inbox session ${23 - index}`))
  await expect(list.getByText("Recent", { exact: true })).toBeVisible()
  await list.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(target).toBeInViewport({ ratio: 1 })
  // Git metadata must load for an unopened worktree, not only after selecting its session.
  await target.locator('[data-component="tooltip-v2-trigger"]:has(use[href="#opencode-v2-icon-branch"])').hover()
  await expect(page.getByRole("tooltip")).toHaveText("dev")
  const offset = await list.evaluate((element) => element.scrollTop)
  expect(offset).toBeGreaterThan(0)
  const row = await target.elementHandle()

  await target.click()
  await expectPath(page, sessionHref("ses_inbox_14"))
  await expect(target).toHaveAttribute("data-state", "active")
  // Opening a session loads it into the client, which updates every section.
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  expect(await target.evaluate((element, before) => element === before, row)).toBe(true)
  expect(await list.evaluate((element) => element.scrollTop)).toBe(offset)
})

test("the inbox Archived dialog searches only archived sessions and restores the selected session", async ({
  page,
}) => {
  await page.clock.install({ time: T0 + 41 * 60_000 })
  await mockWorkspace(page, {
    name: "ArchivedInbox",
    sessions: [
      { id: "ses_archive_active", title: "Active inbox session", time: { created: T0, updated: T0, idle: T0 } },
      ...["First archived session", "Second archived session"].map((title, index) => ({
        id: `ses_archive_${index}`,
        title,
        time: { created: T0 - 100, updated: T0 + index, idle: index ? T0 - 100 : T0, archived: T0 + 10 },
      })),
    ],
    seed: {
      settings: { appearance: { tabLayout: "inbox" } },
      tabs: [],
      storage: { "opencode.global.dat:sidebar.inbox": { workingExpanded: true } },
    },
  })
  await page.goto("/")

  const inbox = page.locator('[data-slot="sidebar-inbox"]')

  const archived = inbox.getByRole("button", { name: "Archived", exact: true })

  const rows = inbox.locator('[data-slot="sidebar-inbox-item"]')

  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText("Active inbox session")
  await expect(archived).toBeVisible()
  await archived.focus()
  await archived.press("Enter")

  const dialog = page.getByRole("dialog")

  const search = dialog.getByRole("combobox")

  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute("placeholder", "Search sessions")
  await expect(dialog.getByText("Archived sessions", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("option")).toHaveCount(2)
  await expect(dialog.getByRole("option", { name: /First archived session/ })).toBeVisible()
  await expect(dialog.getByRole("option", { name: /Second archived session/ })).toBeVisible()
  await search.fill("Active inbox session")
  await expect(dialog.getByText("No results found", { exact: true })).toBeVisible()
  await search.fill("First archived")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await expect(dialog.getByRole("option", { name: /First archived session/ })).toHaveAttribute("aria-selected", "true")
  await search.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expectPath(page, sessionHref("ses_archive_0"))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(rows.filter({ hasText: "First archived session" })).toHaveAttribute("data-state", "active")
})

test("opening a working session expands its shelf and still allows manual collapse", async ({ page }) => {
  await openSession(page, {
    name: "WorkingInbox",
    sessions: [{ id: "ses_working_selected", title: "Selected working session" }],
    sessionStatus: { ses_working_selected: { type: "running" } },
    seed: {
      settings: { appearance: { tabLayout: "inbox" } },
      storage: { "opencode.global.dat:sidebar.inbox": { workingExpanded: false } },
    },
  })

  const inbox = page.locator('[data-slot="sidebar-inbox"]')

  const shelf = inbox.locator('[data-slot="sidebar-inbox-working"]')

  const toggle = shelf.getByRole("button", { name: "Working", exact: true })

  const row = shelf.locator('[data-slot="sidebar-inbox-item"]')

  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(row).toHaveAttribute("data-state", "active")
  await expect(toggle.locator('[data-component="text-shimmer"]')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(row).toHaveCount(0)
  await expect(toggle.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
  await expectPath(page, sessionHref("ses_working_selected"))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await toggle.press("Enter")
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(row).toHaveAttribute("data-state", "active")
  await expect(toggle.locator('[data-component="text-shimmer"]')).toHaveCount(0)
})

test("sessions opened from Home and Search get a temporary Current session row without duplicating Recent", async ({
  page,
}) => {
  await mockWorkspace(page, {
    name: "CurrentInbox",
    sessions: [
      { id: "ses_current_home", title: "Older Home session", time: { created: T0, updated: T0, idle: T0, viewed: T0 } },
      {
        id: "ses_current_search",
        title: "Older Search session",
        time: { created: T0, updated: T0, idle: T0, viewed: T0 },
      },
      {
        id: "ses_current_recent",
        title: "Recent inbox session",
        time: { created: T0, updated: T0 + 2, idle: T0 + 2, viewed: T0 + 2 },
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `ses_current_extra_${index}`,
        title: `Other recent session ${index}`,
        time: { created: T0, updated: T0 + 3 + index, idle: T0 + 3 + index, viewed: T0 + 3 + index },
      })),
    ],
    seed: {
      settings: { appearance: { tabLayout: "inbox" } },
      tabs: [],
      storage: { "opencode.global.dat:sidebar.inbox": { workingExpanded: true } },
    },
  })
  await page.goto("/")

  const inbox = page.locator('[data-slot="sidebar-inbox"]')

  const rows = inbox.locator('[data-slot="sidebar-inbox-item"]')

  await expect(rows).toHaveCount(10)
  await page.locator('[data-component="home-session-row"]').filter({ hasText: "Older Home session" }).click()
  await expectPath(page, sessionHref("ses_current_home"))
  await expect(rows.filter({ hasText: "Older Home session" })).toHaveAttribute("data-state", "active")
  await expect(inbox.getByText("Current session", { exact: true })).toHaveCount(0)
  await expect(rows).toHaveCount(11)
  await rows.filter({ hasText: "Recent inbox session" }).click()
  await expectPath(page, sessionHref("ses_current_recent"))
  await expect(rows).toHaveCount(10)
  await expect(rows.filter({ hasText: "Recent inbox session" })).toHaveAttribute("data-state", "active")
  await page.getByRole("button", { name: "Search sessions", exact: true }).click()

  const dialog = page.getByRole("dialog")

  const search = dialog.getByRole("combobox")

  await expect(search).toBeFocused()
  await search.fill("Older Search session")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await search.press("Enter")
  await expectPath(page, sessionHref("ses_current_search"))
  await expect(rows.filter({ hasText: "Older Search session" })).toHaveAttribute("data-state", "active")
  await expect(rows.filter({ hasText: "Older Home session" })).toHaveCount(0)
  await expect(rows).toHaveCount(11)
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expectPath(page, "/")
  await expect(rows).toHaveCount(10)
})

test("the inbox keeps every unread result separate from expandable Recent, including never-run sessions", async ({
  page,
}) => {
  await mockWorkspace(page, {
    name: "InboxSections",
    sessions: [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `ses_unread_${index}`,
        title: `Unread result ${index}`,
        outcome: index === 0 ? "failed" : "succeeded",
        time: { created: T0, updated: T0 + index, idle: T0 + index },
      })),
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `ses_read_${index}`,
        title: index === 0 ? "Never-run session" : `Read session ${index}`,
        time: { created: T0, updated: T0 + 100 - index, idle: index ? T0 + 100 - index : undefined, viewed: T0 + 200 },
      })),
    ],
    seed: { settings: { appearance: { tabLayout: "inbox" } }, tabs: [] },
  })
  await page.goto("/")

  const inbox = page.locator('[data-slot="sidebar-inbox"]')

  const unread = inbox.getByRole("group", { name: "Unread", exact: true }).locator('[data-slot="sidebar-inbox-item"]')

  const recent = inbox.getByRole("group", { name: "Recent", exact: true }).locator('[data-slot="sidebar-inbox-item"]')

  await expect(unread).toContainText(Array.from({ length: 12 }, (_, index) => `Unread result ${11 - index}`))
  await expect(unread.filter({ hasText: "Unread result 0" })).toHaveAttribute("data-status", "failed")
  await expect(recent).toContainText([
    "Never-run session",
    ...Array.from({ length: 9 }, (_, index) => `Read session ${index + 1}`),
  ])
  await expect(recent).toHaveCount(10)
  await expect(inbox.locator('[data-slot="sidebar-inbox-item"][tabindex="0"]')).toHaveCount(1)

  await unread.filter({ hasText: "Unread result 11" }).focus()
  await page.keyboard.press("ArrowDown")
  await expect(unread.filter({ hasText: "Unread result 10" })).toBeFocused()
  await page.keyboard.press("End")
  await expect(recent.filter({ hasText: "Read session 9" })).toBeFocused()
  await page.keyboard.press("Home")
  await expect(unread.filter({ hasText: "Unread result 11" })).toBeFocused()

  await inbox.getByRole("button", { name: "Show more", exact: true }).click()
  await expect(recent).toHaveCount(12)
  await expect(recent.filter({ hasText: "Read session 11" })).toHaveCount(1)
  await expect(unread).toHaveCount(12)
  await page.reload()
  await expect(recent).toHaveCount(12)
  await inbox.getByRole("button", { name: "Show less", exact: true }).click()
  await expect(recent).toHaveCount(10)
  await expect(unread).toHaveCount(12)
})

test("the inbox waits for initial requests and orders attention by waiting age rather than last update", async ({
  page,
}) => {
  await page.clock.install({ time: T0 + 10 * 60_000 })

  const workspace = await mockWorkspace(page, {
    name: "InboxWaiting",
    sessions: [
      {
        id: "ses_waiting_old",
        title: "Oldest waiting session",
        time: { created: T0, updated: T0 + 60_000, busy: T0 },
      },
      {
        id: "ses_waiting_new",
        title: "Newer waiting session",
        time: { created: T0, updated: T0 + 9 * 60_000, busy: T0 + 5 * 60_000 },
      },
      {
        id: "ses_waiting_live",
        title: "New live question",
        time: { created: T0, updated: T0 + 2 * 60_000, busy: T0 + 60_000 },
      },
    ],
    sessionStatus: {
      ses_waiting_old: { type: "running" },
      ses_waiting_new: { type: "running" },
      ses_waiting_live: { type: "running" },
    },
    sessionPermissions: {
      ses_waiting_old: [{ id: "perm_inbox_old", sessionID: "ses_waiting_old", action: "shell", resources: ["build"] }],
      ses_waiting_new: [{ id: "perm_inbox_new", sessionID: "ses_waiting_new", action: "shell", resources: ["test"] }],
    },
    seed: { settings: { appearance: { tabLayout: "inbox" } }, tabs: [] },
  })

  const pending = await holdRoute(page, /\/api\/session\/ses_waiting_old\/permission(?:\?|$)/)
  const activity = await holdRoute(page, "**/api/session/active")

  await page.goto("/")
  const [permission] = await Promise.all([pending.arrived, activity.arrived])

  const inbox = page.locator('[data-slot="sidebar-inbox"]')

  await expect(inbox).toHaveAttribute("aria-busy", "true")
  await expect(inbox.getByText("Sessions you work on will appear here", { exact: true })).toHaveCount(0)
  pending.release()
  await (await permission.response())?.finished()
  await expect(inbox).toHaveAttribute("aria-busy", "true")
  activity.release()

  const needs = inbox
    .getByRole("group", { name: "Needs attention", exact: true })
    .locator('[data-slot="sidebar-inbox-item"]')

  await expect(needs).toContainText(["Oldest waiting session", "Newer waiting session"])
  await expect(inbox).toHaveAttribute("aria-busy", "false")
  await expect(inbox.getByRole("group", { name: "Working", exact: true })).toContainText("New live question")
  await expect(inbox.getByRole("status")).toBeEmpty()
  workspace.push([
    {
      id: "evt_inbox_question",
      type: "form.created",
      created: T0 + 8 * 60_000,
      location: { directory: workspace.directory },
      data: {
        form: {
          id: "form_inbox_question",
          sessionID: "ses_waiting_live",
          title: "Choose a library",
          metadata: { kind: "question" },
          fields: [{ key: "library", type: "string", title: "Library" }],
        },
      },
    } satisfies Extract<OpenCodeEvent, { type: "form.created" }>,
  ])
  await expect(needs).toContainText(["Oldest waiting session", "Newer waiting session", "New live question"])
  await expect(needs.filter({ hasText: "New live question" })).toContainText("2m")
  await expect(inbox.getByRole("status")).toHaveText("New live question has a question.")
  await expect(inbox.getByRole("status")).toHaveCount(1)
})

test("an inactive tab shows attention once auto-accept gives up on its permission", async ({ page }) => {
  const reply = await mockGaveUpPermission(page, "horizontal")
  await page.goto(sessionHref(a.id))
  const tab = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  const dot = tab.locator('[data-mark="attention"]')

  // The first reply proves the client holds the request; auto-accept still owns it, so the tab only shows work.
  await reply.arrived
  await expect(tab.locator('[data-mark="busy"]')).toBeVisible()
  await expect(dot).toBeHidden()

  reply.release()
  await expect(dot).toBeVisible()
  await expect(tab.locator('[data-mark="busy"]')).toBeHidden()
  expect(reply.attempts()).toBe(3)
})

test("the inbox moves a session to Needs attention once auto-accept gives up on its permission", async ({ page }) => {
  const reply = await mockGaveUpPermission(page, "inbox")
  await page.goto(sessionHref(a.id))

  const inbox = page.locator('[data-slot="sidebar-inbox"]')

  const row = inbox.locator('[data-slot="sidebar-inbox-item"]').filter({ hasText: b.title })

  const needs = inbox
    .getByRole("group", { name: "Needs attention", exact: true })
    .locator('[data-slot="sidebar-inbox-item"]')

  await reply.arrived
  await expect(row).toHaveAttribute("data-status", "working")
  await expect(needs).toHaveCount(0)

  reply.release()
  await expect(needs).toHaveCount(1)
  await expect(needs).toContainText(b.title)
  await expect(needs).toHaveAttribute("data-status", "approval")
  expect(reply.attempts()).toBe(3)
})

// Auto-accept is on and every reply to session B's permission fails. The first reply waits for `release()`; then it
// and both retries fail, and auto-accept gives up.
async function mockGaveUpPermission(page: Page, tabLayout: "horizontal" | "inbox") {
  const permissionID = "permission-gave-up"
  const released = Promise.withResolvers<void>()
  const arrived = Promise.withResolvers<void>()
  const attempts = { count: 0 }

  await mockWorkspace(page, {
    name: "GaveUp",
    sessions: [a, b],
    sessionPermissions: {
      [b.id]: [
        { id: permissionID, sessionID: b.id, action: "shell", resources: ["git status"], metadata: {}, save: [] },
      ],
    },
    seed: {
      settings: { appearance: { tabLayout }, permissions: { autoApprove: true } },
      storage: { "opencode.global.dat:sidebar.inbox": { workingExpanded: true } },
    },
  })
  await page.route(new RegExp(`/api/session/${b.id}/permission/${permissionID}/reply(\\?|$)`), async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    attempts.count++
    arrived.resolve()

    if (attempts.count === 1) await released.promise
    await route.fulfill({ status: 500, json: { message: "Reply failed" } })
  })

  return {
    arrived: arrived.promise,
    release: () => released.resolve(),
    attempts: () => attempts.count,
  }
}
