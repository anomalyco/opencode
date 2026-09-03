import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { currentSession } from "../utils/mock-server"
import pkg from "../../package.json" with { type: "json" }

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const sessionA = session("ses_tab_a", "Tab A session")
const sessionB = session("ses_tab_b", "Tab B session")
const sessionC = session("ses_tab_c", "Tab C session")
const unresolvedSessionID = "ses_tab_unresolved"

test("new session tab matches neighboring session widths", async ({ page }, testInfo) => {
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA, sessionB, directory }) => {
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server, sessionId: sessionA },
          { type: "draft", server, directory, draftID: "draft_tab_width" },
          { type: "session", server, sessionId: sessionB },
        ]),
      )
    },
    { server, sessionA: sessionA.id, sessionB: sessionB.id, directory: sessionA.directory },
  )

  const href = `/server/${base64Encode(server)}/session/${sessionA.id}`
  await page.goto(href)

  const tabs = page.locator("[data-titlebar-tab-slot]")
  await expect(tabs.locator("[data-titlebar-tab-title]")).toHaveText([sessionA.title, "Session", sessionB.title])
  await testInfo.attach("new-session-between-tabs", {
    body: await page.locator('[data-slot="titlebar-v2"]').screenshot(),
    contentType: "image/png",
  })
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 720 })
    await expect
      .poll(() =>
        tabs.evaluateAll((tabs) => {
          const widths = tabs.map((tab) => tab.getBoundingClientRect().width)
          return Math.max(...widths) - Math.min(...widths)
        }),
      )
      .toBeLessThan(1)
  }
})

test("pressing mouse down on a tab navigates before mouse up", async ({ page }) => {
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA, sessionB }) => {
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server, sessionId: sessionA },
          { type: "session", server, sessionId: sessionB },
        ]),
      )
    },
    { server, sessionA: sessionA.id, sessionB: sessionB.id },
  )

  const hrefA = `/server/${base64Encode(server)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(server)}/session/${sessionB.id}`
  await page.goto(hrefA)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()

  const linkB = page.locator(`a[data-titlebar-tab-link][href="${hrefB}"]`)
  await expect(linkB).toBeVisible()
  const box = await linkB.boundingBox()
  if (!box) throw new Error("tab link has no bounding box")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()

  // Navigation must happen on mousedown, before the button is released.
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await page.mouse.up()
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
})

test("keyboard navigation follows the visible tab order", async ({ page }) => {
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA, unresolved, sessionC }) => {
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server, sessionId: sessionA },
          { type: "session", server, sessionId: unresolved },
          { type: "session", server, sessionId: sessionC },
        ]),
      )
    },
    { server, sessionA: sessionA.id, unresolved: unresolvedSessionID, sessionC: sessionC.id },
  )

  const hrefA = `/server/${base64Encode(server)}/session/${sessionA.id}`
  const hrefC = `/server/${base64Encode(server)}/session/${sessionC.id}`
  await page.goto(hrefA)
  await expect(page.locator("[data-titlebar-tab-slot]:visible")).toHaveCount(2)
  await expect(page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefC}"])`)).toBeVisible()

  await page.keyboard.press("Control+Alt+ArrowRight")

  await expect(page).toHaveURL(new RegExp(`${hrefC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
})

test("mobile drawer exposes close controls and navigates between tabs", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 })
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA, sessionB, sessionC }) => {
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server, sessionId: sessionA },
          { type: "session", server, sessionId: sessionB },
          { type: "session", server, sessionId: sessionC },
        ]),
      )
    },
    { server, sessionA: sessionA.id, sessionB: sessionB.id, sessionC: sessionC.id },
  )

  const hrefA = `/server/${base64Encode(server)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(server)}/session/${sessionB.id}`
  await page.goto(hrefA)
  await page.getByRole("button", { name: "Tabs", exact: true }).click()

  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefA}"])`)
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefB}"])`)
  await expect(tabA).toHaveAttribute("data-active", "true")
  await expect(tabB).toBeVisible()
  await expect(tabA.locator('[data-slot="tab-close"]')).toBeVisible()
  await expect(tabB.locator('[data-slot="tab-close"]')).toBeVisible()

  await tabB.locator(`a[href="${hrefB}"]`).click()

  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()
  await page.getByRole("button", { name: "Tabs", exact: true }).click()
  await expect(tabA.locator('[data-slot="tab-close"]')).toBeVisible()
  await expect(tabB.locator('[data-slot="tab-close"]')).toBeVisible()

  for (const direction of ["ltr", "rtl"]) {
    await page.evaluate((direction) => document.documentElement.setAttribute("dir", direction), direction)
    await page.setViewportSize({ width: 450, height: 720 })
    await expect(tabA).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(tabA.locator("[data-titlebar-tab]")).toHaveAttribute("data-title-overflow", "false")
    await page.setViewportSize({ width: 450, height: 720 })
    await page.getByRole("button", { name: "Tabs", exact: true }).click()
  }
})

test("vertical tabs show project details, resize, and navigate", async ({ page }) => {
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA, sessionB }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ appearance: { tabLayout: "vertical", showProjectName: true }, general: { showStatus: true } }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server, sessionId: sessionA },
          { type: "session", server, sessionId: sessionB },
        ]),
      )
    },
    { server, sessionA: sessionA.id, sessionB: sessionB.id },
  )

  const hrefA = `/server/${base64Encode(server)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(server)}/session/${sessionB.id}`
  await page.goto(hrefA)

  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tabA = sidebar.locator(`[data-titlebar-tab-link][href="${hrefA}"]`)
  const tabB = sidebar.locator(`[data-titlebar-tab-link][href="${hrefB}"]`)
  await expect(sidebar).toHaveCSS("width", "260px")
  await expect(tabA).toContainText(sessionA.title)
  await expect(tabB).toContainText(sessionB.title)
  await expect(tabB.locator('[data-slot="tab-project"]')).toHaveText("tab-project")
  await expect(sidebar.getByRole("button", { name: "Home", exact: true })).toHaveText("Home")
  await expect(sidebar.getByRole("button", { name: "New session" })).toBeVisible()
  await expect(sidebar.locator('[data-slot="vertical-tabs-footer"]')).toBeVisible()
  const status = sidebar.getByRole("button", { name: "Status", exact: true })
  await expect(status).toBeVisible()
  await expect
    .poll(async () => {
      const bounds = await sidebar.boundingBox()
      const button = await status.boundingBox()
      return !!bounds && !!button && button.x >= bounds.x && button.x - bounds.x <= 12
    })
    .toBe(true)
  await expect(page.locator('[data-slot="titlebar-v2"]')).toBeHidden()
  await expect
    .poll(async () => {
      const button = await sidebar.getByRole("button", { name: "New session" }).boundingBox()
      const tab = await tabA.boundingBox()
      return !!button && !!tab && button.y + button.height < tab.y
    })
    .toBe(true)
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)

  const handle = sidebar.locator('[data-component="resize-handle"]')
  await expect(handle).toHaveCSS("cursor", "col-resize")
  const box = await handle.boundingBox()
  if (!box) throw new Error("vertical tab resize handle has no bounding box")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2)
  await page.mouse.up()
  await expect(sidebar).toHaveCSS("width", "180px")
  await expect(tabB.locator('[data-slot="tab-project"]')).toHaveText("tab-project")

  const resized = await handle.boundingBox()
  if (!resized) throw new Error("resized vertical tab handle has no bounding box")
  await page.mouse.move(resized.x + resized.width / 2, resized.y + resized.height / 2)
  await page.mouse.down()
  await page.mouse.move(resized.x - 200, resized.y + resized.height / 2)
  await page.mouse.up()
  await expect(sidebar).toHaveCSS("width", "130px")

  await tabB.click()
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect(tabB).toBeVisible()
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`vertical tabs toggle stays anchored and exposes header navigation (${direction})`, async ({
    page,
  }, testInfo) => {
    await mockServer(page)
    await page.addInitScript(
      ({ server, sessionID }) => {
        localStorage.setItem(
          "settings.v3",
          JSON.stringify({ appearance: { tabLayout: "vertical" }, general: { showStatus: true } }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
        )
      },
      { server, sessionID: sessionA.id },
    )
    const href = `/server/${base64Encode(server)}/session/${sessionA.id}`
    await page.goto(href)
    const header = page.locator("[data-session-title]")
    await expect(header.getByRole("heading", { name: sessionA.title, exact: true })).toBeVisible()
    await page.locator("html").evaluate((element, dir) => element.setAttribute("dir", dir), direction)
    const toggle = page.getByRole("button", { name: "Toggle vertical tabs", exact: true })
    const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
    await expect(sidebar.locator(toggle)).toHaveAttribute("aria-expanded", "true")
    const badge = page.locator('[data-slot="channel-indicator"]')
    await expect(badge).toHaveCount(1)
    await expect(badge).toHaveText((process.env.OPENCODE_CHANNEL ?? "dev").toUpperCase())
    await expect(sidebar.locator('[data-slot="vertical-tabs-controls"]').locator(badge)).toBeVisible()
    await expect(sidebar.locator('[data-slot="vertical-tabs-footer"]').locator(badge)).toHaveCount(0)
    const badgeBounds = await badge.boundingBox()
    const bounds = await toggle.boundingBox()
    expect(bounds).not.toBeNull()
    if (!badgeBounds || !bounds) throw new Error("tab controls have no bounding box")
    expect(
      direction === "ltr" ? bounds.x - badgeBounds.x - badgeBounds.width : badgeBounds.x - bounds.x - bounds.width,
    ).toBe(12)
    expect(badgeBounds.y + badgeBounds.height / 2).toBe(bounds.y + bounds.height / 2)

    await toggle.click()
    await expect(sidebar).toHaveCount(0)
    await expect(header.locator(toggle)).toHaveAttribute("aria-expanded", "false")
    await expect(header.locator('[data-slot="vertical-tabs-controls"]').locator(badge)).toBeVisible()
    await expect.poll(() => badge.boundingBox()).toEqual(badgeBounds)
    await expect(toggle).toBeFocused()
    await expect.poll(() => toggle.boundingBox()).toEqual(bounds)
    await expect(header.getByRole("button", { name: "Home", exact: true })).toBeVisible()
    await expect(header.getByRole("button", { name: "New session", exact: true })).toBeVisible()
    await expect(header.getByRole("button", { name: "Status", exact: true })).toBeVisible()
    await expect(header.locator('[data-slot="titlebar-navigation-start"] button')).toHaveCount(3)
    expect(
      await header
        .locator('[data-slot="titlebar-navigation-start"] button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    ).toEqual(["Toggle vertical tabs", "Home", "New session"])
    await testInfo.attach(`collapsed-${direction}`, { body: await page.screenshot(), contentType: "image/png" })

    await toggle.press("Enter")
    await expect(sidebar.locator(toggle)).toHaveAttribute("aria-expanded", "true")
    await expect(toggle).toBeFocused()
    await expect.poll(() => toggle.boundingBox()).toEqual(bounds)
    await expect(sidebar).toHaveCSS("width", "260px")
    await expect(header.getByRole("button", { name: "Home", exact: true })).toHaveCount(0)

    await page.setViewportSize({ width: 800, height: 720 })
    const narrow = await toggle.boundingBox()
    await toggle.click()
    await expect(header.locator(toggle)).toHaveAttribute("aria-expanded", "false")
    await expect.poll(() => toggle.boundingBox()).toEqual(narrow)
    await expect(header.getByRole("button", { name: "New session", exact: true })).toBeInViewport()
    await page.setViewportSize({ width: 1280, height: 720 })
    await header.getByRole("button", { name: "Home", exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    const toolbar = page.locator('[data-slot="collapsed-tabs-toolbar"]')
    const home = page.locator('[data-slot="home-panel"]')
    await expect(home.locator(toggle)).toBeVisible()
    await expect(toolbar).toBeHidden()
    await expect.poll(() => toggle.boundingBox()).toEqual(bounds)
    await expect
      .poll(() =>
        home.evaluate((panel) => {
          const shell = panel.closest('[data-slot="shell-layout"]')!.getBoundingClientRect()
          const bounds = panel.getBoundingClientRect()
          return {
            top: bounds.top - shell.top,
            bottom: shell.bottom - bounds.bottom,
            left: bounds.left - shell.left,
            right: shell.right - bounds.right,
          }
        }),
      )
      .toEqual({ top: 8, bottom: 8, left: 8, right: 8 })
    await home.getByRole("button", { name: "Home", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${href}$`))
    await expect(header.locator(toggle)).toBeVisible()
    await header.getByRole("button", { name: "New session", exact: true }).click()
    await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
    const draft = page.locator('[data-component="new-session"]')
    await expect(draft.locator(toggle)).toBeVisible()
    await expect(toolbar).toBeHidden()
    await expect.poll(() => toggle.boundingBox()).toEqual(bounds)
    await expect
      .poll(() =>
        draft.evaluate((panel) => {
          const shell = panel.closest('[data-slot="shell-layout"]')!.getBoundingClientRect()
          const bounds = panel.getBoundingClientRect()
          return {
            top: bounds.top - shell.top,
            bottom: shell.bottom - bounds.bottom,
            left: bounds.left - shell.left,
            right: shell.right - bounds.right,
          }
        }),
      )
      .toEqual({ top: 8, bottom: 8, left: 8, right: 8 })
    await toggle.click()
    await expect(sidebar.getByRole("button", { name: "New session", exact: true })).toBeVisible()
  })
}

test("appearance experimental settings control vertical tab details", async ({ page }) => {
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA }) => {
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionA }]),
      )
    },
    { server, sessionA: sessionA.id },
  )

  await page.goto("/")
  await expect(page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-link]')).toBeVisible()
  await page.keyboard.press("Control+,")

  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeVisible()
  const version = settings.getByRole("tablist").getByText(`v${pkg.version}`, { exact: true })
  await expect(settings.getByRole("tablist").getByText("OpenCode Desktop", { exact: true })).toBeInViewport()
  await expect(version).toBeInViewport()
  await settings.getByRole("tab", { name: "Appearance" }).click()
  await expect(settings.getByRole("heading", { name: "Experimental" })).toBeVisible()

  const layout = settings.locator('[data-action="settings-tab-layout"]')
  await expect(layout).toContainText("Horizontal")
  await layout.click()
  await page.getByRole("option", { name: "Vertical" }).click()

  await expect(layout).toContainText("Vertical")
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
  const projectNames = page.locator('[data-slot="vertical-tabs-sidebar"] [data-slot="tab-project"]')
  await expect(projectNames).toHaveCount(0)
  const projectNameSwitch = settings.getByRole("switch", { name: "Show project names", exact: true })
  await settings.locator('[data-action="settings-show-project-name"] [data-slot="switch-control"]').click()
  await expect(projectNameSwitch).toBeChecked()
  await expect(projectNames).toHaveText(["tab-project"])
  await expect(settings.getByRole("tablist")).toHaveCSS("width", "240px")

  await page.setViewportSize({ width: 920, height: 720 })
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCSS("width", "260px")
  await expect(settings.getByRole("tablist")).toBeHidden()
  await expect(settings.getByRole("button", { name: "Appearance", exact: true })).toBeVisible()

  await page.setViewportSize({ width: 800, height: 720 })
  await expect(settings.getByRole("tablist")).toBeHidden()
  await expect(settings.getByRole("button", { name: "Appearance", exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 720 })
  await expect(settings.getByRole("button", { name: "Appearance", exact: true })).toBeVisible()
  await settings.evaluate((element) => element.setAttribute("dir", "rtl"))
  await expect(settings.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport()

  await page.setViewportSize({ width: 390, height: 360 })
  await expect(settings.getByRole("button", { name: "Appearance", exact: true })).toBeInViewport()

  // Reload the UI-selected preference without seeding settings storage.
  await page.reload()
  const href = `/server/${base64Encode(server)}/session/${sessionA.id}`
  await page.getByRole("button", { name: "Tabs", exact: true }).click()
  await expect(page.locator('[data-slot="mobile-tabs-drawer"] [data-slot="tab-project"]')).toHaveText(["tab-project"])
  await expect(
    page
      .locator('[data-slot="mobile-tabs-drawer"]')
      .locator(`[data-titlebar-tab-link][href="${href}"]`)
      .getByText(sessionA.title, { exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)

  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(
    page
      .locator('[data-slot="vertical-tabs-sidebar"]')
      .locator(`[data-titlebar-tab-link][href="${href}"]`)
      .getByText(sessionA.title, { exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
  await page.keyboard.press("Control+,")
  await settings.getByRole("tab", { name: "Appearance" }).click()
  await expect(layout).toContainText("Vertical")
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`collapsed tabs toggle previews every open tab on hover (${direction})`, async ({ page }, testInfo) => {
    await mockServer(page)
    await page.route(`${server}/api/session/active*`, (route) =>
      json(route, { data: { [sessionC.id]: { type: "running" } } }),
    )
    await page.route(`${server}/api/event*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"id":"evt_connected","type":"server.connected","data":{}}\n\n',
      }),
    )
    await page.addInitScript(
      ({ server, sessionA, sessionB, sessionC, directory }) => {
        localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: "vertical" } }))
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([
            { type: "session", server, sessionId: sessionA },
            { type: "draft", server, directory, draftID: "hover-draft" },
            { type: "session", server, sessionId: sessionB },
            { type: "session", server, sessionId: sessionC },
          ]),
        )
        localStorage.setItem(
          "opencode.global.dat:notification",
          JSON.stringify({
            list: [{ type: "turn-complete", session: sessionB, directory, time: Date.now(), viewed: false }],
          }),
        )
      },
      { server, sessionA: sessionA.id, sessionB: sessionB.id, sessionC: sessionC.id, directory: sessionA.directory },
    )
    const hrefA = `/server/${base64Encode(server)}/session/${sessionA.id}`
    const hrefB = `/server/${base64Encode(server)}/session/${sessionB.id}`
    const hrefC = `/server/${base64Encode(server)}/session/${sessionC.id}`
    await page.goto(hrefA)
    await expect(page.locator("[data-session-title] h1")).toHaveText(sessionA.title)
    await page.locator("html").evaluate((element, direction) => element.setAttribute("dir", direction), direction)
    const toggle = page.getByRole("button", { name: "Toggle vertical tabs", exact: true })
    const popup = page.getByRole("navigation", { name: "Open tabs", exact: true })
    const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
    await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([
      sessionA.title,
      "Session",
      sessionB.title,
      sessionC.title,
    ])
    const appearance = await sidebar.locator("[data-titlebar-tab]").evaluateAll((rows) =>
      rows.map((row) => {
        const style = getComputedStyle(row)
        return { height: style.height, radius: style.borderRadius, background: style.backgroundImage }
      }),
    )
    await page.clock.install()
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(toggle).toHaveAttribute("data-hover-blocked", "true")
    await toggle.hover()
    await page.clock.runFor(1000)
    await expect(popup).toHaveCount(0)
    await page.locator("[data-session-title] h1").hover()
    await expect(toggle).toHaveAttribute("data-hover-blocked", "false")
    await toggle.hover()
    await expect(popup.locator("[data-titlebar-tab-title]")).toHaveText([
      sessionA.title,
      "Session",
      sessionB.title,
      sessionC.title,
    ])
    await expect(popup.getByRole("button", { name: "New session", exact: true })).toHaveCount(0)
    await expect(popup.getByRole("button", { name: "Close tab", exact: true })).toHaveCount(4)
    await expect(popup.locator("[data-titlebar-tab-list]")).toHaveCSS("gap", "4px")
    await expect(popup.locator('[data-slot="project-avatar-slot"]')).toHaveCount(3)
    await expect(popup).toHaveCSS("padding", "4px")
    await expect
      .poll(async () => {
        const button = await toggle.boundingBox()
        if (!button) return Infinity
        const centers = await popup.locator('[data-slot="project-avatar-slot"]').evaluateAll((icons) =>
          icons.map((icon) => {
            const bounds = icon.getBoundingClientRect()
            return bounds.x + bounds.width / 2
          }),
        )
        return Math.max(...centers.map((center) => Math.abs(center - button.x - button.width / 2)))
      })
      .toBeLessThanOrEqual(1)
    await expect(
      popup.locator(`[data-titlebar-tab-link][href="${hrefB}"] [data-slot="project-avatar-unread-dot"]`),
    ).toBeVisible()
    await expect(
      popup.locator(`[data-titlebar-tab-link][href="${hrefC}"] [data-component="session-progress-indicator-v2"]`),
    ).toBeVisible()
    expect(
      await popup.locator("[data-titlebar-tab]").evaluateAll((rows) =>
        rows.map((row) => {
          const style = getComputedStyle(row)
          return { height: style.height, radius: style.borderRadius, background: style.backgroundImage }
        }),
      ),
    ).toEqual(appearance)
    await popup.screenshot({ path: testInfo.outputPath("open-tabs.png") })
    await expect(popup.locator('[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-title]')).toHaveText(
      sessionA.title,
    )
    await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)
    const bounds = await toggle.boundingBox()

    await popup.locator(`[data-titlebar-tab-link][href="${hrefB}"]`).hover()
    await expect(popup).toBeVisible()
    await expect(toggle).toHaveAttribute("data-state", "hover")
    await popup.locator(`[data-titlebar-tab-link][href="${hrefB}"]`).click()
    await expect(page).toHaveURL(new RegExp(`${hrefB}$`))
    await expect(page.locator("[data-session-title] h1")).toHaveText(sessionB.title)
    await expect(popup).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect.poll(() => toggle.boundingBox()).toEqual(bounds)

    await expect(popup.locator('[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-title]')).toHaveText(
      sessionB.title,
    )
    const closing = popup
      .locator("[data-titlebar-tab-slot]")
      .filter({ has: page.locator(`[data-titlebar-tab-link][href="${hrefC}"]`) })
    await closing.hover()
    await closing.getByRole("button", { name: "Close tab", exact: true }).click()
    await expect(popup.locator("[data-titlebar-tab-title]")).toHaveText([sessionA.title, "Session", sessionB.title])
    await expect(page).toHaveURL(new RegExp(`${hrefB}$`))
    await page.keyboard.press("Escape")
    await expect(popup).toBeVisible()
    await page.locator("[data-session-title] h1").hover()
    await expect(popup).toBeHidden()
    await expect(toggle).not.toHaveAttribute("data-state", "hover")

    await toggle.click()
    await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toBeVisible()
    await page.locator("[data-session-title] h1").hover()
    await toggle.hover()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(popup).toHaveCount(0)
  })
}

test("closing the active and final dropdown tabs keeps it open", async ({ page }) => {
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA, sessionB }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: "vertical" } }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server, sessionId: sessionA },
          { type: "session", server, sessionId: sessionB },
        ]),
      )
    },
    { server, sessionA: sessionA.id, sessionB: sessionB.id },
  )
  const hrefA = `/server/${base64Encode(server)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(server)}/session/${sessionB.id}`
  await page.goto(hrefA)
  await expect(page.locator("[data-session-title] h1")).toHaveText(sessionA.title)
  const toggle = page.getByRole("button", { name: "Toggle vertical tabs", exact: true })
  await toggle.click()
  await page.locator("[data-session-title] h1").hover()
  await toggle.hover()
  const popup = page.getByRole("navigation", { name: "Open tabs", exact: true })
  const active = popup.locator('[data-titlebar-tab-slot][data-active="true"]')
  await expect(active.locator("[data-titlebar-tab-title]")).toHaveText(sessionA.title)
  await active.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${hrefB}$`))
  await expect(popup.locator("[data-titlebar-tab-title]")).toHaveText([sessionB.title])
  await expect(active.locator("[data-titlebar-tab-title]")).toHaveText(sessionB.title)
  await active.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(popup).toHaveText("No open tabs")
  await expect(toggle).toHaveAttribute("data-state", "hover")
  await page.locator('[data-slot="home-panel"]').getByRole("button", { name: "Home", exact: true }).hover()
  await expect(popup).toBeHidden()
})

test("collapsed tabs hover list handles an empty tab list", async ({ page }) => {
  await mockServer(page)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: "vertical" } }))
  })
  await page.goto("/")
  const toggle = page.getByRole("button", { name: "Toggle vertical tabs", exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await page.locator('[data-slot="home-panel"]').getByRole("button", { name: "Home", exact: true }).hover()
  await toggle.hover()
  const popup = page.getByRole("navigation", { name: "Open tabs", exact: true })
  await expect(popup).toHaveText("No open tabs")
  await expect(popup.getByRole("button")).toHaveCount(0)
})

test("collapsed tabs dropdown scrolls the sidebar rows", async ({ page }) => {
  await mockServer(page)
  await page.addInitScript(
    ({ server, directory }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: "vertical" } }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(
          Array.from({ length: 20 }, (_, index) => ({
            type: "draft",
            server,
            directory,
            draftID: `hover-${index}`,
          })),
        ),
      )
    },
    { server, directory: sessionA.directory },
  )
  await page.goto("/")
  const toggle = page.getByRole("button", { name: "Toggle vertical tabs", exact: true })
  await toggle.click()
  await page.locator('[data-slot="home-panel"]').getByRole("button", { name: "Home", exact: true }).hover()
  await toggle.hover()
  const popup = page.getByRole("navigation", { name: "Open tabs", exact: true })
  await expect(popup.locator("[data-titlebar-tab-slot]")).toHaveCount(20)
  const scroll = popup.locator('[data-slot="vertical-tabs-scroll"]')
  await expect.poll(() => scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  const tab = popup.locator('[data-tab-key="draft:hover-19"] [data-titlebar-tab-link]')
  await tab.scrollIntoViewIfNeeded()
  await expect(tab).toBeInViewport()
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test("vertical tab preference uses the drawer on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 })
  await mockServer(page)
  await page.addInitScript(
    ({ server, sessionA }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: "vertical" } }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionA }]),
      )
    },
    { server, sessionA: sessionA.id },
  )

  const href = `/server/${base64Encode(server)}/session/${sessionA.id}`
  await page.goto(href)

  await page.getByRole("button", { name: "Tabs", exact: true }).click()
  const tabs = page.locator('[data-slot="mobile-tabs-drawer"]')
  await expect(tabs.locator(`[data-titlebar-tab-link][href="${href}"]`)).toContainText(sessionA.title)
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)

  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(
    page.locator('[data-slot="vertical-tabs-sidebar"]').locator(`[data-titlebar-tab-link][href="${href}"]`),
  ).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
})

function session(id: string, title: string) {
  return {
    id,
    slug: id,
    projectID: "project-tabs",
    directory: "C:/tab-project",
    title,
    version: "dev",
    time: { created: 1, updated: 1 },
  }
}

async function mockServer(page: Page) {
  const sessions = [sessionA, sessionB, sessionC]
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== server) return route.fallback()
    if (url.pathname === `/api/session/${unresolvedSessionID}`) return new Promise(() => {})
    if (url.pathname === "/api/event") return sse(route)
    if (url.pathname === "/api/session")
      return json(route, { data: sessions.map((session) => currentSession(session)), cursor: {} })
    if (url.pathname === "/api/session/active") return json(route, { data: {} })
    const currentSessionInfo = sessions.find((item) => url.pathname === `/api/session/${item.id}`)
    if (currentSessionInfo) return json(route, { data: currentSession(currentSessionInfo) })
    if (sessions.some((item) => url.pathname === `/api/session/${item.id}/message`))
      return json(route, { data: [], cursor: {} })
    if (sessions.some((item) => url.pathname === `/api/session/${item.id}/inbox`)) return json(route, { data: [] })
    if (["/api/agent", "/api/provider", "/api/model", "/api/command", "/api/reference"].includes(url.pathname))
      return json(route, { location: { directory: sessionA.directory }, data: [] })
    if (url.pathname === "/api/model/default")
      return json(route, { location: { directory: sessionA.directory }, data: null })
    if (url.pathname === "/api/permission/request" || url.pathname === "/api/form/request")
      return json(route, { location: { directory: sessionA.directory }, data: [] })
    if (url.pathname === "/api/mcp") return json(route, { location: { directory: sessionA.directory }, data: [] })
    if (url.pathname === "/api/mcp/resource")
      return json(route, { location: { directory: sessionA.directory }, data: { resources: [], templates: [] } })
    if (url.pathname === "/api/project" || url.pathname === "/api/project/current") {
      const project = {
        id: sessionA.projectID,
        canonical: sessionA.directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(
        route,
        url.pathname === "/api/project" ? [project] : { id: project.id, directory: sessionA.directory },
      )
    }
    if (url.pathname === "/api/location")
      return json(route, {
        directory: sessionA.directory,
        project: { id: sessionA.projectID, directory: sessionA.directory, canonical: sessionA.directory },
      })
    if (url.pathname === "/api/vcs")
      return json(route, {
        location: { directory: sessionA.directory },
        data: { branch: "main", defaultBranch: "main" },
      })
    return json(route, {})
  })
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
