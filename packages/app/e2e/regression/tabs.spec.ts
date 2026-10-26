import { expect, test, type Page } from "@playwright/test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import {
  NO_PROVIDER,
  REMOTE_SERVER,
  SERVER,
  draftHref,
  expectPath,
  holdRoute,
  pageMessagesFrom,
  project,
  seed,
  session,
  sessionHref,
} from "../utils/app"
import { openFileLauncher, reviewTabs } from "../utils/side-panel"
import { mockServers } from "../utils/mock-server"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { fileNode, mockWorkspace, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const a = { id: "ses_tab_a", title: "Tab A session" }

const b = { id: "ses_tab_b", title: "Tab B session" }

const c = { id: "ses_tab_c", title: "Tab C session" }

test.use({ serviceWorkers: "block" })

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

test("keyboard navigation follows the visible tab order and skips unresolved tabs", async ({ page }) => {
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
        appearance: { tabLayout: "vertical" },
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
  await expect(sidebar).toHaveCSS("width", "276px")
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)

  const actions = await Promise.all(
    ["vertical-tabs-home", "vertical-tabs-search", "vertical-tabs-new-session"].map(async (action) => {
      const box = await sidebar.locator(`[data-action="${action}"]`).boundingBox()

      if (!box) throw new Error(`${action} is not rendered`)

      return box
    }),
  )

  const gaps = actions.slice(1).map((box, index) => box.y - (actions[index].y + actions[index].height))
  expect(gaps).toEqual([4, 4])

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

  await resize(-80, "196px")
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
  await scroll.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(tabB).toBeInViewport({ ratio: 1 })

  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"))
  const home = sidebar.locator('[data-action="vertical-tabs-home"]')
  const hint = home.locator('span[aria-hidden="true"]')
  await expect(hint).toHaveText("Ctrl+Alt+H")
  await expect(hint.getByText("Ctrl+Alt+H", { exact: true })).toHaveCSS("direction", "ltr")
  await expect(hint).toBeHidden()
  await home.focus()
  await expect(hint).toBeVisible()

  await tabB.click()
  await expectPath(page, sessionHref(b.id))
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
        settings: { appearance: { tabLayout: "vertical", sidebarOpen: false } },
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

test("vertical tab gaps hover and select the nearest row", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b, c],
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
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
  expect(lower.y - upper.y - upper.height).toBe(4)

  const middle = upper.y + upper.height + 2

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

  await page.mouse.click(upper.x + upper.width / 2, middle + 1)
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
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 1)
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
  const indicators = sidebar.locator('[data-component="activity-ring"]')
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
      .querySelectorAll('[data-slot="vertical-tabs-sidebar"] [data-component="activity-ring"]')
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

test("⌘W closes the session tab again once the window loses focus after the side panel empties", async ({ page }) => {
  const sessions = await emptySidePanel(page)
  // ⌘Tab away and back sends no click or key the page sees.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")))
  await page.keyboard.press("ControlOrMeta+w")
  await expectPath(page, sessionHref(sessions.beta.id))
  await expect(sessions.alphaTab).toHaveCount(0)
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

test("loads a tab's transcript while the pointer rests on it, and not when it passes over", async ({ page }) => {
  const requested: string[] = []
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
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
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
