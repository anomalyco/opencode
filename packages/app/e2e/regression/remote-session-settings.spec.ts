import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page, type Route } from "@playwright/test"

const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const directoryA = "C:/server-a"
const directoryB = "/home/server-b"
const sessionB = {
  id: "ses_server_b",
  slug: "ses_server_b",
  projectID: "project-server-b",
  directory: directoryB,
  title: "Server B session",
  version: "dev",
  time: { created: 1, updated: 1 },
}

test("session settings use the remote server context", async ({ page }) => {
  const permissionRequests: string[] = []
  await mockServers(page, permissionRequests)
  await page.addInitScript(
    ({ serverB }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
    },
    { serverB },
  )

  await page.goto(`/server/${base64Encode(serverB)}/session/${sessionB.id}`)
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,")

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
        return url.origin === serverB && url.searchParams.get("directory") === directoryB
      }),
    )
    .toBe(true)
  expect(permissionRequests.every((request) => new URL(request).origin === serverB)).toBe(true)

  await dialog.getByRole("tab", { name: "Models" }).click()
  await expect(dialog.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(dialog.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
})

async function mockServers(page: Page, permissionRequests: string[]) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverA && url.origin !== serverB) return route.fallback()
    const remote = url.origin === serverB
    const directory = remote ? directoryB : directoryA
    const requestDirectory = url.searchParams.get("directory")
    if (requestDirectory && requestDirectory !== directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (url.pathname === "/global/event" || url.pathname === "/event") return sse(route)
    if (url.pathname === "/global/health") return json(route, { healthy: true })
    if (url.pathname === "/session/status") return json(route, {})
    if (url.pathname === "/session") return json(route, remote ? [sessionB] : [])
    if (url.pathname === `/session/${sessionB.id}` && remote) return json(route, sessionB)
    if (/^\/session\/[^/]+$/.test(url.pathname)) return json(route, { name: "NotFoundError" }, 404)
    if (url.pathname === `/session/${sessionB.id}/message`) return json(route, [])
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(url.pathname)) return json(route, [])
    if (url.pathname === "/permission") {
      permissionRequests.push(url.toString())
      return json(route, [])
    }
    if (["/skill", "/command", "/lsp", "/formatter", "/question", "/vcs/diff", "/pty/shells"].includes(url.pathname))
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp"].includes(url.pathname)) return json(route, {})
    if (url.pathname === "/provider") return json(route, provider(remote ? "server-b" : "server-a"))
    if (url.pathname === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (url.pathname === "/project" || url.pathname === "/project/current") {
      const project = {
        id: remote ? sessionB.projectID : "project-server-a",
        worktree: directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(route, url.pathname === "/project" ? [project] : project)
    }
    if (url.pathname === "/path")
      return json(route, {
        state: directory,
        config: directory,
        worktree: directory,
        directory,
        home: directory,
      })
    if (url.pathname === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    return json(route, {})
  })
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
