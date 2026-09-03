import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { currentSession } from "../utils/mock-server"

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

test("dedicated experimental settings control vertical tab details", async ({ page }) => {
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
  await expect(settings.getByRole("tablist").getByText("OpenCode Desktop", { exact: true })).toHaveCount(0)
  await expect(settings.getByRole("tablist").getByText(/^v\d+\./)).toHaveCount(0)
  await settings.getByRole("tab", { name: "Appearance" }).click()
  await expect(settings.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible()
  await expect(settings.locator('[data-action="settings-tab-layout"]')).toHaveCount(0)
  await expect(settings.getByRole("switch", { name: "Show project names", exact: true })).toHaveCount(0)
  await settings.getByRole("tab", { name: "Experimental", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Experimental", level: 2, exact: true })).toBeVisible()

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
  await expect(settings.getByRole("button", { name: "Experimental", exact: true })).toBeVisible()

  await page.setViewportSize({ width: 800, height: 720 })
  await expect(settings.getByRole("tablist")).toBeHidden()
  await expect(settings.getByRole("button", { name: "Experimental", exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 720 })
  await settings.getByRole("button", { name: "Experimental", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Appearance", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible()
  await expect(layout).toHaveCount(0)
  await settings.getByRole("button", { name: "Appearance", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Experimental", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Experimental", level: 2, exact: true })).toBeVisible()
  await expect(layout).toContainText("Vertical")
  await expect(projectNameSwitch).toBeChecked()
  await settings.evaluate((element) => element.setAttribute("dir", "rtl"))
  await expect(settings.getByRole("button", { name: "Experimental", exact: true })).toBeInViewport()

  await page.setViewportSize({ width: 390, height: 360 })
  await expect(settings.getByRole("button", { name: "Experimental", exact: true })).toBeInViewport()

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
  await settings.getByRole("tab", { name: "Experimental", exact: true }).click()
  await expect(layout).toContainText("Vertical")
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
    if (url.pathname === "/api/location") return json(route, { directory: sessionA.directory })
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
