import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { createMockServerHandler } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

const serverA = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const serverB = "http://127.0.0.1:4097"
const sessionA = session("ses_server_a", "C:/server-a", "Server A session")
const sessionB = session("ses_server_b", "/home/server-b", "Server B session")
const childB = { ...session("ses_server_b_child", sessionB.directory, "Server B subagent"), parentID: sessionB.id }

test.use({ serviceWorkers: "block" })

test("tab busy indicator reflects activity in the tab session family", async ({ page }, info) => {
  await mockServers(page)
  await page.addInitScript(
    ({ serverA, serverB, sessionA, sessionB }) => {
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server: serverA, sessionId: sessionA },
          { type: "session", server: serverB, sessionId: sessionB },
        ]),
      )
    },
    { serverA, serverB, sessionA: sessionA.id, sessionB: sessionB.id },
  )

  const hrefA = `/server/${base64Encode(serverA)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(hrefB)
  await expect(page.getByRole("heading", { name: sessionB.title, exact: true })).toBeVisible()

  // The parent is idle, but its tab remains active while the background child runs.
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefB}"])`)
  await expect(tabB.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()
  await tabB.screenshot({ path: info.outputPath("subagent-tab-activity.png") })

  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefA}"])`)
  await expect(tabA.locator("[data-titlebar-tab-title]")).toHaveText(sessionA.title)
  await expect(tabA.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
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

async function mockServers(page: Page) {
  // Both servers stay connected while the client hydrates their active-session snapshots.
  await installSseTransport(page, { server: serverA })
  await installSseTransport(page, { server: serverB })
  const servers = new Map(
    [sessionA, sessionB].map(
      (current) =>
        [
          current === sessionA ? serverA : serverB,
          createMockServerHandler({
            directory: current.directory,
            project: {
              id: current.projectID,
              worktree: current.directory,
              vcs: "git",
              time: { created: 1, updated: 1 },
              sandboxes: [],
            },
            sessions: current === sessionB ? [current, childB] : [current],
            sessionStatus: current === sessionB ? { [childB.id]: { type: "running" } } : {},
            provider: { all: [], connected: [], default: {} },
            pageMessages: () => ({ items: [] }),
          }),
        ] as const,
    ),
  )
  page.on("close", () => servers.forEach((server) => void server.dispose()))
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const server = servers.get(url.origin)
    if (!server) return route.fallback()
    const current = url.origin === serverA ? sessionA : sessionB
    const directory = url.searchParams.get("directory")
    if (directory && directory !== current.directory)
      return route.fulfill({
        status: 500,
        json: { name: "InvalidDirectory" },
        headers: { "access-control-allow-origin": "*" },
      })
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      })
    const body = route.request().postDataBuffer()
    const response = await server.handler(
      new Request(url, {
        method: route.request().method(),
        headers: route.request().headers(),
        body: body ? Uint8Array.from(body) : undefined,
      }),
    )
    return route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), "access-control-allow-origin": "*" },
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
}
