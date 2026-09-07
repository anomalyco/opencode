import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

for (const endpoint of ["/api/location/catalog"]) {
  for (const recover of [false, true]) {
    test(`keeps the composer when ${endpoint} ${recover ? "recovers on retry" : "fails"}`, async ({ page }) => {
      const recovery = recoveryRequests(page)
      const directory = "/projects/working-tree"
      const sessionID = "ses_location_sync_failure"
      await mockOpenCodeServer(page, {
        directory: fixture.directory,
        project: fixture.project,
        provider: fixture.provider,
        sessions: [{ id: sessionID, projectID: fixture.project.id, directory, title: "Workspace sync" }],
        fileList: () => [],
        pageMessages: () => ({
          items: [{ id: "msg_saved", type: "user", text: "Keep working in this worktree", time: { created: 1 } }],
        }),
      })
      let requests = 0
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url())
        if (url.pathname !== endpoint || url.searchParams.get("location[directory]") !== directory)
          return route.fallback()
        requests++
        if (recover && requests > 1) return route.fallback()
        return route.fulfill({ status: 500, body: "", headers: { "access-control-allow-origin": "*" } })
      })
      const failure = page.waitForResponse(
        (response) => new URL(response.url()).pathname === endpoint && response.status() === 500,
      )
      const settled = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          url.pathname === endpoint &&
          url.searchParams.get("location[directory]") === directory &&
          (recover ? response.ok() : requests === 3 && response.status() === 500)
        )
      })
      await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
      await failure
      await expect(page.getByText("Keep working in this worktree", { exact: true })).toBeVisible()
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
      await expect(prompt).toBeEditable()
      await prompt.fill("Continue after reconnecting")
      await expect(prompt).toHaveText("Continue after reconnecting")
      await settled
      await expect(prompt).toBeEditable()
      await expect(prompt).toHaveText("Continue after reconnecting")
      expect(requests).toBe(recover ? 2 : 3)
      await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toHaveCount(0)
      expect(recovery).toEqual([])
      await page.screenshot({ path: test.info().outputPath("location-sync.png") })
    })
  }
}

test("follows a live session move while the location catalog is still loading", async ({ page }) => {
  const recovery = recoveryRequests(page)
  const directory = "/projects/old-tree"
  const destination = "/projects/current-tree"
  const sessionID = "ses_location_moved_while_loading"
  const session = { id: sessionID, projectID: fixture.project.id, directory, title: "Moved session" }
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { timelineDetail: { notices: { placement: "separate" } } } }),
    )
  })
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [session],
    fileList: () => [],
    pageMessages: () => ({
      items: [{ id: "msg_saved", type: "user", text: "Follow the session move", time: { created: 1 } }],
    }),
  })
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/location/catalog" && url.searchParams.get("location[directory]") === directory) {
      requested.resolve()
      await release.promise
    }
    return route.fallback()
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await requested.promise
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Keep this draft")
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
  await transport.waitForConnection()
  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location/catalog" &&
      url.searchParams.get("location[directory]") === destination &&
      response.ok()
    )
  })
  session.directory = destination
  await transport.send({
    id: "evt_location_moved_while_loading",
    type: "session.moved",
    created: 2,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, location: { directory: destination }, projectID: fixture.project.id },
  })
  await resolved
  const delayed = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location/catalog" &&
      url.searchParams.get("location[directory]") === directory &&
      response.ok()
    )
  })
  release.resolve()
  await delayed
  await expect(prompt).toBeEditable()
  await expect(prompt).toHaveText("Keep this draft")
  await expect(page.getByText("Follow the session move", { exact: true })).toBeVisible()
  await expect(page.locator('[data-type="location-switched"]').getByText(destination, { exact: true })).toBeVisible()
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toHaveCount(0)
  expect(recovery).toEqual([])
})

test("refreshes a session moved during disconnection without losing the draft", async ({ page }) => {
  const recovery = recoveryRequests(page)
  const directory = "/projects/before-reconnect"
  const destination = "/projects/after-reconnect"
  const sessionID = "ses_location_reconnect"
  const session = { id: sessionID, projectID: fixture.project.id, directory, title: "Reconnected session" }
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [session],
    fileList: () => [],
    pageMessages: () => ({
      items: [{ id: "msg_saved", type: "user", text: "Resume in the current worktree", time: { created: 1 } }],
    }),
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Draft before disconnect")
  const connection = await transport.waitForConnection()
  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location/catalog" &&
      url.searchParams.get("location[directory]") === destination &&
      response.ok()
    )
  })
  session.directory = destination
  await transport.close()
  await transport.waitForConnection({ after: connection.id })
  await resolved
  await expect(prompt).toBeEditable()
  await expect(prompt).toHaveText("Draft before disconnect")
  await expect(page.getByText("Resume in the current worktree", { exact: true })).toBeVisible()
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toHaveCount(0)
  expect(recovery).toEqual([])
})

test("ignores an old failed location read after reconnecting", async ({ page }) => {
  const recovery = recoveryRequests(page)
  const directory = "/projects/reconnected-tree"
  const sessionID = "ses_location_stale_response"
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [{ id: sessionID, projectID: fixture.project.id, directory }],
    fileList: () => [],
    pageMessages: () => ({ items: [] }),
  })
  let requests = 0
  await page.route("**/api/location/catalog?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("location[directory]") !== directory) return route.fallback()
    requests++
    if (requests > 1) return route.fallback()
    requested.resolve()
    await release.promise
    return route.fulfill({
      status: 500,
      body: "",
      headers: { "access-control-allow-origin": "*" },
    })
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await requested.promise
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Keep typing here")
  const connection = await transport.waitForConnection()
  const metadata = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${sessionID}`)
  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location/catalog" &&
      url.searchParams.get("location[directory]") === directory &&
      response.ok()
    )
  })
  await transport.close()
  await transport.waitForConnection({ after: connection.id })
  await metadata
  release.resolve()
  await resolved
  await expect(prompt).toBeEditable()
  await expect(prompt).toHaveText("Keep typing here")
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toHaveCount(0)
  expect(requests).toBe(2)
  expect(recovery).toEqual([])
})

function recoveryRequests(page: Page) {
  const requests: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === "POST" && /^\/api\/(session\/[^/]+\/move$|worktree(?:\/|$))/.test(path))
      requests.push(path)
  })
  return requests
}
