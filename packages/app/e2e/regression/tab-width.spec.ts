import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"

const server = "http://127.0.0.1:4096"
const sessionA = { id: "ses_a", slug: "ses_a", projectID: "proj_a", directory: "/repo/a", title: "Session A", version: "dev", time: { created: 1, updated: 1 } }
const sessionB = { id: "ses_b", slug: "ses_b", projectID: "proj_b", directory: "/repo/b", title: "Session B", version: "dev", time: { created: 2, updated: 2 } }
const sessionC = { id: "ses_c", slug: "ses_c", projectID: "proj_c", directory: "/repo/c", title: "Session C", version: "dev", time: { created: 3, updated: 3 } }

test("tabs shrink from their preferred width before scrolling", async ({ page }) => {
  await mockServers(page)
  await page.addInitScript(
    ({ server, sessionA, sessionB, sessionC }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:tabs", JSON.stringify([
        { type: "session", server, sessionId: sessionA.id },
        { type: "session", server, sessionId: sessionB.id },
        { type: "session", server, sessionId: sessionC.id },
      ]))
    },
    { server, sessionA, sessionB, sessionC },
  )

  const hrefA = `/server/${base64Encode(server)}/session/${sessionA.id}`
  await page.goto(hrefA)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()

  const tabSlots = page.locator("[data-titlebar-tab-slot]")
  await expect(tabSlots).toHaveCount(3)

  for (const tab of await tabSlots.all()) {
    const box = await tab.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeCloseTo(224, 0)
  }

  const strip = await page.locator('[data-slot="titlebar-tabs"]').boundingBox()
  const list = await page.locator("[data-titlebar-tab-list]").boundingBox()
  expect(strip).not.toBeNull()
  expect(list).not.toBeNull()
  expect(strip!.width).toBeGreaterThan(0)
  expect(list!.width).toBeGreaterThan(0)
  expect(strip!.width).toBeCloseTo(list!.width, 0)

  await page.setViewportSize({ width: 700, height: 720 })
  await expect.poll(() => tabSlots.nth(0).evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(224)
  expect(await tabSlots.nth(0).evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(96)
  expect(
    await page.locator('[data-slot="titlebar-tabs-scroll"]').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)

  await page.setViewportSize({ width: 420, height: 720 })
  await expect.poll(() => tabSlots.nth(0).evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(96, 0)
  expect(
    await page.locator('[data-slot="titlebar-tabs-scroll"]').evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true)

  await page.setViewportSize({ width: 1280, height: 720 })
  await expect.poll(() => tabSlots.nth(0).evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(224, 0)

  const first = await tabSlots.nth(0).boundingBox()
  const second = await tabSlots.nth(1).boundingBox()
  expect(first).not.toBeNull()
  expect(second).not.toBeNull()

  const start = { x: first!.x + first!.width / 2, y: first!.y + first!.height / 2 }
  await tabSlots.nth(0).dispatchEvent("pointerdown", {
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
    pointerId: 1,
    pointerType: "mouse",
  })
  await pointerEvent(page, "pointermove", { x: start.x + 10, y: start.y, buttons: 1 })
  await expect(page.locator("[data-titlebar-tab-preview]")).toBeVisible()
  await pointerEvent(page, "pointermove", {
    x: second!.x + second!.width + 100,
    y: second!.y + second!.height / 2,
    buttons: 1,
  })
  await pointerEvent(page, "pointerup", {
    x: second!.x + second!.width + 100,
    y: second!.y + second!.height / 2,
    buttons: 0,
  })

  await expect(tabSlots.nth(0).locator(`a[href$="/session/${sessionB.id}"]`)).toBeVisible()
})

function pointerEvent(page: Page, type: "pointermove" | "pointerup", point: { x: number; y: number; buttons: number }) {
  return page.evaluate(
    ({ type, point }) => {
      window.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          buttons: point.buttons,
          clientX: point.x,
          clientY: point.y,
          pointerId: 1,
          pointerType: "mouse",
        }),
      )
    },
    { type, point },
  )
}

async function mockServers(page: Page) {
  const sessions = [sessionA, sessionB, sessionC]
  const sessionById = (id: string) => sessions.find((s) => s.id === id) ?? sessionA
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== server) return route.fallback()
    const match = url.pathname.match(/^\/session\/([^/]+)/)
    const id = match?.[1]
    const current = id ? sessionById(id) : sessionA
    if (url.pathname === "/global/event" || url.pathname === "/event") return sse(route)
    if (url.pathname === "/global/health") return json(route, { healthy: true })
    if (url.pathname === "/session") return json(route, sessions)
    if (url.pathname === `/session/${current.id}`) return json(route, current)
    if (/^\/session\/[^/]+$/.test(url.pathname)) return json(route, { name: "NotFoundError" }, 404)
    if (url.pathname === `/session/${current.id}/message`) return json(route, [])
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(url.pathname)) return json(route, [])
    if (["/skill", "/command", "/lsp", "/formatter", "/permission", "/question", "/vcs/diff"].includes(url.pathname))
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp", "/session/status"].includes(url.pathname))
      return json(route, {})
    if (url.pathname === "/provider")
      return json(route, { all: [], connected: [], default: { providerID: "", modelID: "" } })
    if (url.pathname === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (url.pathname === "/project" || url.pathname === "/project/current") {
      return json(route, url.pathname === "/project" ? sessions.map((s) => ({ id: s.projectID, worktree: s.directory, vcs: "git", time: { created: 1, updated: 1 }, sandboxes: [] })) : { id: current.projectID, worktree: current.directory, vcs: "git", time: { created: 1, updated: 1 }, sandboxes: [] })
    }
    if (url.pathname === "/path")
      return json(route, { state: current.directory, config: current.directory, worktree: current.directory, directory: current.directory, home: current.directory })
    if (url.pathname === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    return json(route, {})
  })
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) })
}

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
