import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { currentSession } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const sessionA = session("ses_server_a", "C:/server-a", "Server A session")
const sessionB = session("ses_server_b", "/home/server-b", "Server B session")

test("closing the active server's last tab opens the remaining server tab", async ({ page }) => {
  const requests: string[] = []
  await mockServers(page, requests)
  await page.addInitScript(
    ({ serverB, sessionA, sessionB }) => {
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server: "http://127.0.0.1:4096", sessionId: sessionA },
          { type: "session", server: serverB, sessionId: sessionB },
        ]),
      )
    },
    { serverB, sessionA: sessionA.id, sessionB: sessionB.id },
  )

  const hrefA = `/server/${base64Encode(serverA)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(hrefA)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()

  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefA}"])`)
  await tabA.locator('[data-slot="tab-close"] button').click()

  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect.poll(() => requests.some((url) => url.startsWith(`${serverB}/api/session/${sessionB.id}`))).toBe(true)
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  const sessionBRequests = requests.filter((url) => url.includes(`/session/${sessionB.id}`))
  expect(sessionBRequests.every((url) => url.startsWith(serverB))).toBe(true)
})

function session(id: string, directory: string, title: string) {
  return {
    id,
    slug: id,
    projectID: `project-${id}`,
    directory,
    title,
    version: "dev",
    time: { created: 1, updated: 1 },
  }
}

async function mockServers(page: Page, requests: string[]) {
  await installSseTransport(page, { server: serverA })
  await installSseTransport(page, { server: serverB })
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverA && url.origin !== serverB) return route.fallback()
    requests.push(url.toString())
    const current = url.origin === serverA ? sessionA : sessionB
    const directory = url.searchParams.get("directory")
    if (directory && directory !== current.directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (url.pathname === "/api/health") return json(route, { pid: 1 })
    if (url.pathname === "/api/session") return json(route, { data: [currentSession(current)], cursor: {} })
    if (url.pathname === "/api/session/active") return json(route, { data: {} })
    if (url.pathname === `/api/session/${current.id}`) return json(route, { data: currentSession(current) })
    if (url.pathname === `/api/session/${current.id}/message`) return json(route, { data: [], cursor: {} })
    if (["/api/agent", "/api/provider", "/api/model", "/api/command", "/api/reference"].includes(url.pathname))
      return json(route, { location: { directory: current.directory }, data: [] })
    if (url.pathname === "/api/model/default")
      return json(route, { location: { directory: current.directory }, data: null })
    if (url.pathname === "/api/permission/request" || url.pathname === "/api/question/request")
      return json(route, { location: { directory: current.directory }, data: [] })
    if (url.pathname === "/api/mcp") return json(route, { location: { directory: current.directory }, data: [] })
    if (url.pathname === "/api/mcp/resource")
      return json(route, { location: { directory: current.directory }, data: { resources: [], templates: [] } })
    if (url.pathname === "/api/project" || url.pathname === "/api/project/current") {
      const project = {
        id: current.projectID,
        canonical: current.directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(route, url.pathname === "/api/project" ? [project] : { id: project.id, directory: current.directory })
    }
    if (url.pathname === "/api/location") return json(route, { directory: current.directory })
    if (url.pathname === "/api/vcs")
      return json(route, {
        location: { directory: current.directory },
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
