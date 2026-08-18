import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page, type Route } from "@playwright/test"
import { installSseTransport } from "../utils/sse-transport"
import { currentSession } from "../utils/mock-server"

const serverA = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const serverB = "http://127.0.0.1:4097"
const directoryA = "C:/server-a"
const directoryB = "/home/server-b"
const sessionA = session("ses_server_a", directoryA, "Server A session")
const childSessionA = { ...session("ses_server_a_child", directoryA, "Server A child session"), parentID: sessionA.id }
const sessionB = session("ses_server_b", directoryB, "Server B session")

test("session settings use the remote server context", async ({ page }) => {
  const permissionRequests: string[] = []
  await installSseTransport(page, { server: serverA })
  await installSseTransport(page, { server: serverB })
  await mockServers(page, permissionRequests)
  await configureServers(page)

  await page.goto(`/server/${base64Encode(serverB)}/session/${sessionB.id}`)
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")

  const dialog = page.locator(".settings-v2-dialog")
  const autoAccept = dialog.locator('[data-action="settings-auto-accept-permissions"]')
  const input = autoAccept.getByRole("switch")
  await expect(autoAccept).toBeVisible()
  await expect(input).toBeEnabled()
  permissionRequests.length = 0
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(input).toBeChecked()
  await expect
    .poll(() =>
      permissionRequests.some((request) => {
        const url = new URL(request)
        return url.origin === serverB && url.searchParams.get("location[directory]") === directoryB
      }),
    )
    .toBe(true)
  expect(permissionRequests.every((request) => new URL(request).origin === serverB)).toBe(true)

  await dialog.getByRole("tab", { name: "Models" }).click()
  await expect(dialog.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(dialog.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
})

test("auto-accept responds for an unfocused server session", async ({ page }) => {
  const permissionRequests: string[] = []
  const permissionResponses: PermissionResponse[] = []
  await installSseTransport(page, { server: serverB })
  const transport = await installSseTransport(page, {
    server: serverA,
    retry: 20,
  })
  await mockServers(page, permissionRequests, permissionResponses)
  await configureServers(page, [
    { type: "session", server: serverA, sessionId: sessionA.id },
    { type: "session", server: serverB, sessionId: sessionB.id },
  ])

  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(`/server/${base64Encode(serverA)}/session/${sessionA.id}`)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")
  const autoAccept = page.locator(".settings-v2-dialog").locator('[data-action="settings-auto-accept-permissions"]')
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(autoAccept.getByRole("switch")).toBeChecked()
  await expect
    .poll(() =>
      permissionRequests.some((request) => {
        const url = new URL(request)
        return url.origin === serverA && url.searchParams.get("location[directory]") === directoryA
      }),
    )
    .toBe(true)
  await page.keyboard.press("Escape")

  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefB}"])`).click()
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await transport.waitForConnection()

  await transport.send({
    id: "evt_permission_background_a",
    created: 1700000001000,
    type: "permission.asked",
    location: { directory: directoryA },
    data: {
      id: "permission-background-a",
      sessionID: sessionA.id,
      action: "bash",
      resources: ["git status"],
      metadata: {},
      save: [],
    },
  })

  await expect
    .poll(() => permissionResponses)
    .toEqual([
      {
        origin: serverA,
        directory: undefined,
        sessionID: sessionA.id,
        permissionID: "permission-background-a",
        body: { reply: "once" },
      },
    ])

  await transport.send({
    id: "evt_permission_background_a_child",
    created: 1700000002000,
    type: "permission.asked",
    location: { directory: directoryA },
    data: {
      id: "permission-background-a-child",
      sessionID: childSessionA.id,
      action: "bash",
      resources: ["git diff"],
      metadata: {},
      save: [],
    },
  })

  await expect
    .poll(() => permissionResponses)
    .toEqual([
      {
        origin: serverA,
        directory: undefined,
        sessionID: sessionA.id,
        permissionID: "permission-background-a",
        body: { reply: "once" },
      },
      {
        origin: serverA,
        directory: undefined,
        sessionID: childSessionA.id,
        permissionID: "permission-background-a-child",
        body: { reply: "once" },
      },
    ])
})

type PermissionResponse = {
  origin: string
  directory?: string
  sessionID: string
  permissionID: string
  body: unknown
}

async function configureServers(page: Page, tabs: { type: "session"; server: string; sessionId: string }[] = []) {
  await page.addInitScript(
    ({ serverB, tabs }) => {
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify(tabs))
    },
    { serverB, tabs },
  )
}

async function mockServers(page: Page, permissionRequests: string[], permissionResponses: PermissionResponse[] = []) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverA && url.origin !== serverB) return route.fallback()
    const remote = url.origin === serverB
    const directory = remote ? directoryB : directoryA
    const sessions = remote ? [sessionB] : [sessionA, childSessionA]
    const requestDirectory = url.searchParams.get("location[directory]")
    const response = url.pathname.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/)
    if (route.request().method() === "POST" && response) {
      permissionResponses.push({
        origin: url.origin,
        directory: requestDirectory ?? undefined,
        sessionID: response[1]!,
        permissionID: response[2]!,
        body: route.request().postDataJSON(),
      })
      return json(route, true)
    }
    if (requestDirectory && requestDirectory !== directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (url.pathname === "/api/provider")
      return json(route, {
        location: { directory },
        data: [
          {
            id: remote ? "server-b" : "server-a",
            name: remote ? "Server B Provider" : "Server A Provider",
            package: "test",
          },
        ],
      })
    if (url.pathname === "/api/model") return json(route, { location: { directory }, data: [model(remote)] })
    if (url.pathname === "/api/model/default") return json(route, { location: { directory }, data: model(remote) })
    if (url.pathname === "/api/agent") return json(route, { location: { directory }, data: [] })
    if (url.pathname === "/api/permission/request") {
      permissionRequests.push(url.toString())
      return json(route, { location: { directory }, data: [] })
    }
    if (["/api/command", "/api/reference", "/api/question/request"].includes(url.pathname))
      return json(route, { location: { directory }, data: [] })
    if (url.pathname === "/api/mcp") return json(route, { location: { directory }, data: [] })
    if (url.pathname === "/api/mcp/resource")
      return json(route, { location: { directory }, data: { resources: [], templates: [] } })
    if (url.pathname === "/api/project") {
      return json(route, [
        {
          id: remote ? sessionB.projectID : "project-server-a",
          worktree: directory,
          vcs: "git",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
      ])
    }
    if (url.pathname === "/api/project/current")
      return json(route, { id: remote ? sessionB.projectID : "project-server-a", directory })
    if (url.pathname === "/api/session")
      return json(route, { data: sessions.map((session) => currentSession(session)), cursor: {} })
    if (url.pathname === "/api/session/active") return json(route, { data: {} })
    const currentSessionInfo = sessions.find((session) => url.pathname === `/api/session/${session.id}`)
    if (currentSessionInfo) return json(route, { data: currentSession(currentSessionInfo) })
    if (sessions.some((session) => url.pathname === `/api/session/${session.id}/message`))
      return json(route, { data: [], cursor: {} })
    if (url.pathname === "/api/location") return json(route, { directory })
    if (url.pathname === "/api/vcs")
      return json(route, { location: { directory }, data: { branch: "main", defaultBranch: "main" } })
    if (url.pathname === "/api/pty/shells") return json(route, { location: { directory }, data: [] })
    return json(route, {})
  })
}

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

function provider(id: string) {
  const name = id === "server-b" ? "Server B" : "Server A"
  return {
    all: [
      {
        id,
        name: `${name} Provider`,
        models: {
          [id]: {
            id,
            name: `${name} Model`,
            family: id,
            release_date: "2026-01-01",
            limit: { context: 200_000 },
          },
        },
      },
    ],
    connected: [id],
    default: { providerID: id, modelID: id },
  }
}

function model(remote: boolean) {
  const id = remote ? "server-b" : "server-a"
  const name = remote ? "Server B" : "Server A"
  return {
    id,
    modelID: id,
    providerID: id,
    name: `${name} Model`,
    family: id,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: Date.now() },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context: 200_000, output: 32_000 },
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}
