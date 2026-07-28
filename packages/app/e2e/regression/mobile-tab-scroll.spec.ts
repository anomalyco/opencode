import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { currentSession } from "../utils/mock-server"

const server = "http://127.0.0.1:4096"

// Generate 8 sessions to trigger horizontal overflow on mobile.
const sessions = Array.from({ length: 8 }, (_, i) => session(`ses_tab_${i}`, `Session ${i + 1}`))

test.describe("mobile tab strip scrolling", () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test("tab titles remain visible and scrollable when many tabs are open", async ({ page }) => {
    await mockServer(page, sessions)
    await seedTabs(page, sessions)

    const href = `/server/${base64Encode(server)}/session/${sessions[0].id}`
    await page.goto(href)

    // Wait for all tab slots to render.
    const slots = page.locator("[data-titlebar-tab-slot]")
    await expect(slots).toHaveCount(8, { timeout: 10_000 })

    // Every tab slot must maintain a width >= 200px (shrink-0 keeps them at ~224px).
    const count = await slots.count()
    for (let i = 0; i < count; i++) {
      const box = await slots.nth(i).boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(200)
    }

    // Every tab title must be visible (not hidden by @container query).
    const titles = page.locator("[data-titlebar-tab-title]")
    const titleCount = await titles.count()
    expect(titleCount).toBe(8)
    for (let i = 0; i < titleCount; i++) {
      await expect(titles.nth(i)).toBeVisible()
      const text = await titles.nth(i).textContent()
      expect(text!.length).toBeGreaterThan(0)
    }

    // The scroll container must overflow horizontally.
    const scroll = page.locator('[data-slot="titlebar-tabs-scroll"]')
    await expect(scroll).toBeVisible()
    const overflow = await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflow).toBe(true)
  })
})

function session(id: string, title: string) {
  return {
    id,
    slug: id,
    projectID: "project-mobile-tabs",
    directory: "C:/mobile-tab-project",
    title,
    version: "dev",
    time: { created: 1, updated: 1 },
  }
}

async function seedTabs(page: Page, sessions: ReturnType<typeof session>) {
  await page.addInitScript(
    ({ server, sessionIds }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessionIds.map((id) => ({ type: "session", server, sessionId: id }))),
      )
    },
    { server, sessionIds: sessions.map((s) => s.id) },
  )
}

async function mockServer(page: Page, sessions: ReturnType<typeof session>) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== server) return route.fallback()
    if (url.pathname === "/global/event" || url.pathname === "/event" || url.pathname === "/api/event")
      return sse(route)
    if (url.pathname === "/global/health") return json(route, { healthy: true })
    if (url.pathname === "/api/session") return json(route, { data: sessions.map(currentSession), cursor: {} })
    if (url.pathname === "/api/session/active") return json(route, { data: {} })
    const match = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (match) {
      const s = sessions.find((item) => item.id === match[1])
      if (s) return json(route, { data: currentSession(s) })
    }
    if (/^\/session\/[^/]+\/message$/.test(url.pathname))
      return json(route, [])
    const byId = sessions.find((item) => url.pathname === `/session/${item.id}`)
    if (byId) return json(route, byId)
    if (/^\/session\/[^/]+$/.test(url.pathname)) return json(route, { name: "NotFoundError" }, 404)
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(url.pathname)) return json(route, [])
    if (["/skill", "/command", "/lsp", "/formatter", "/permission", "/question", "/vcs/diff"].includes(url.pathname))
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp"].includes(url.pathname)) return json(route, {})
    if (url.pathname === "/provider")
      return json(route, { all: [], connected: [], default: { providerID: "", modelID: "" } })
    if (url.pathname === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (url.pathname === "/project" || url.pathname === "/project/current") {
      const project = {
        id: sessions[0].projectID,
        worktree: sessions[0].directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(route, url.pathname === "/project" ? [project] : project)
    }
    if (url.pathname === "/path" || url.pathname === "/api/path")
      return json(route, {
        state: sessions[0].directory,
        config: sessions[0].directory,
        worktree: sessions[0].directory,
        directory: sessions[0].directory,
        home: sessions[0].directory,
      })
    if (url.pathname === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    if (url.pathname === "/api/vcs")
      return json(route, {
        location: { directory: sessions[0].directory },
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
