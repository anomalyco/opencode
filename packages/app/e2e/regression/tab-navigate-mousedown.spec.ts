import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { currentSession } from "../utils/mock-server"
import pkg from "../../package.json" with { type: "json" }

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const sessionA = session("ses_tab_a", "Tab A session")
const sessionB = session("ses_tab_b", "Tab B session")
const sessionC = session("ses_tab_c", "Tab C session")
const unresolvedSessionID = "ses_tab_unresolved"

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

test("cramped tabs only show the close button for the active tab", async ({ page }) => {
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

  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefA}"])`)
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefB}"])`)
  await expect(tabA).toHaveAttribute("data-active", "true")
  await expect(tabB).toBeVisible()
  await expect(tabA.locator('[data-slot="tab-close"]')).toBeVisible()
  await expect(tabB.locator('[data-slot="tab-close"]')).toBeHidden()

  await tabB.locator(`a[href="${hrefB}"]`).click()

  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect(tabA.locator('[data-slot="tab-close"]')).toBeHidden()
  await expect(tabB.locator('[data-slot="tab-close"]')).toBeVisible()
})

test("vertical tabs show project details, resize, and navigate", async ({ page }) => {
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

  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tabA = sidebar.locator(`[data-titlebar-tab-link][href="${hrefA}"]`)
  const tabB = sidebar.locator(`[data-titlebar-tab-link][href="${hrefB}"]`)
  await expect(sidebar).toHaveCSS("width", "260px")
  await expect(tabA).toContainText(sessionA.title)
  await expect(tabB).toContainText(sessionB.title)
  await expect(tabB.locator('[data-slot="tab-project"]')).toHaveText("tab-project")
  await expect(sidebar.getByRole("button", { name: "New session" })).toBeVisible()
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

test("appearance experimental setting switches tab orientation", async ({ page }) => {
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
  await expect(settings.getByRole("tablist")).toHaveCSS("width", "240px")

  await page.setViewportSize({ width: 920, height: 720 })
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCSS("width", "260px")
  await expect(settings.getByRole("tablist")).toHaveCSS("width", "160px")

  await page.setViewportSize({ width: 800, height: 720 })
  await expect(settings.getByRole("tablist")).toHaveCSS("width", "160px")
  await expect(version).toBeInViewport()

  await page.setViewportSize({ width: 390, height: 720 })
  await expect(version).toBeInViewport()
  await settings.evaluate((element) => element.setAttribute("dir", "rtl"))
  await expect(version).toBeInViewport()
  await expect(version).toHaveCSS("direction", "ltr")

  await page.setViewportSize({ width: 390, height: 360 })
  await version.scrollIntoViewIfNeeded()
  await expect(version).toBeInViewport()

  // Reload the UI-selected preference without seeding settings storage.
  await page.reload()
  const href = `/server/${base64Encode(server)}/session/${sessionA.id}`
  await expect(
    page
      .locator('[data-slot="titlebar-tabs"]')
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

test("vertical tab preference falls back to horizontal on mobile", async ({ page }) => {
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

  const tabs = page.locator('[data-slot="titlebar-tabs"]')
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
    if (["/api/agent", "/api/provider", "/api/model", "/api/command", "/api/reference"].includes(url.pathname))
      return json(route, { location: { directory: sessionA.directory }, data: [] })
    if (url.pathname === "/api/model/default")
      return json(route, { location: { directory: sessionA.directory }, data: null })
    if (url.pathname === "/api/permission/request" || url.pathname === "/api/question/request")
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
