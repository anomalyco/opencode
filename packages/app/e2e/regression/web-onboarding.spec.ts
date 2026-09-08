import { expect, test, type Page } from "@playwright/test"
import { createMockServerHandler, type MockServerConfig } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

const initial = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const remote = "http://127.0.0.1:4097"
const session = {
  id: "ses_web_onboarding",
  projectID: "project_web_onboarding",
  directory: "/home/remote/project",
  title: "Session from the newly connected server",
  time: { created: 1, updated: 1 },
}

test("failed initial connection offers server setup instead of an indefinite loading screen", async ({ page }) => {
  await fixture(page, initial, "failed")
  await page.goto("/")
  await expectOnboarding(page)
  const onboarding = page.getByRole("region", { name: "Connect a server", exact: true })
  await expect(onboarding.getByText(/OpenCode web interface/)).toBeVisible()
  await expect(onboarding.getByText(/Run OpenCode on the machine with your code/)).toBeVisible()
  await expect(onboarding.getByText(/Check that this server is running and reachable/)).toBeVisible()

  await onboarding.getByRole("button", { name: "Manage servers", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await expect(settings.getByRole("tab", { name: "Servers", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(settings.getByRole("button", { name: "Add server", exact: true })).toBeEnabled()
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expectOnboarding(page)
})

test("a configured server with health and event requests still pending leaves setup usable", async ({ page }) => {
  await fixture(page, initial, "failed")
  await fixture(page, remote, "pending")
  await configure(page, remote, "Pending remote")
  const health = page.waitForRequest(`${remote}/api/health`)
  const events = page.waitForRequest(`${remote}/api/event`)
  await page.goto("/")
  await Promise.all([health, events])
  await expectOnboarding(page)

  await page.getByRole("button", { name: "Add remote server", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Add server", exact: true })
  await expect(editor.getByPlaceholder("http://localhost:4096", { exact: true })).toBeFocused()
  await editor.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(editor).toBeHidden()
  await expectOnboarding(page)
})

test("the setup dialog supports keyboard entry, Escape, cancel, and clean reopening", async ({ page }) => {
  await fixture(page, initial, "failed")
  await fixture(page, remote, "failed")
  await page.goto("/")
  await expectOnboarding(page)
  const add = page.getByRole("button", { name: "Add remote server", exact: true })
  await add.focus()
  await add.press("Enter")
  const editor = page.getByRole("dialog", { name: "Add server", exact: true })
  const url = editor.getByPlaceholder("http://localhost:4096", { exact: true })
  const name = editor.getByPlaceholder("Localhost", { exact: true })
  const password = editor.getByPlaceholder("password", { exact: true })
  await expect(url).toBeFocused()
  await url.fill(remote)
  await page.keyboard.press("Tab")
  await expect(name).toBeFocused()
  await name.fill("Cancelled remote")
  await page.keyboard.press("Tab")
  await expect(password).toBeFocused()
  await password.fill("fixture-password")
  await page.keyboard.press("Escape")
  await expect(editor).toBeHidden()
  await expect(add).toBeFocused()

  await add.press("Space")
  await expect(url).toBeFocused()
  await expect(url).toHaveValue("")
  await expect(name).toHaveValue("")
  await expect(password).toHaveValue("")
  await editor.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(add).toBeFocused()
  await expectOnboarding(page)
  await expect(page.getByText("Cancelled remote", { exact: true })).toHaveCount(0)
})

test("adding a healthy remote focuses it and loads its sessions without another server selection", async ({ page }) => {
  await fixture(page, initial, "failed")
  await fixture(page, remote, "connected", [session])
  await page.goto("/")
  await expectOnboarding(page)
  await page.getByRole("button", { name: "Add remote server", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Add server", exact: true })
  await expect(editor.getByPlaceholder("http://localhost:4096", { exact: true })).toBeFocused()
  await editor.getByPlaceholder("http://localhost:4096", { exact: true }).fill(remote)
  await editor.getByPlaceholder("Localhost", { exact: true }).fill("Working remote")
  await editor.getByPlaceholder("Localhost", { exact: true }).press("Enter")
  await expect(editor).toBeHidden()
  await expectSessions(page, "Working remote")

  await page.reload()
  await expectSessions(page, "Working remote")
})

test("a returning configured remote shows its sessions even when the initial server is unavailable", async ({
  page,
}) => {
  await fixture(page, initial, "failed")
  await fixture(page, remote, "connected", [session])
  await configure(page, remote, "Saved remote")
  await page.goto("/")
  await expectSessions(page, "Saved remote")
})

test("a healthy initial server retains the normal session search", async ({ page }) => {
  await fixture(page, initial, "connected", [session])
  await page.goto("/")
  await expectSessions(page)
})

for (const origin of ["https://opencode.ai", "https://beta.opencode.ai"]) {
  test(`${origin} starts with zero servers and no localhost connection attempts`, async ({ page, baseURL }) => {
    const requests = await proxyHosted(page, baseURL, origin)
    await page.goto(origin)
    await expectOnboarding(page)
    await expect(page.getByText(/Could not connect/)).toHaveCount(0)
    await page.getByRole("button", { name: "Manage servers", exact: true }).click()
    const settings = page.getByTestId("settings-screen")
    await expect(settings.getByRole("tab", { name: "Servers", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(settings.getByText("No servers yet", { exact: true })).toBeVisible()
    expect(requests).toEqual([])
  })
}

test("hosted web preserves saved remote servers without inserting a local server", async ({ page, baseURL }) => {
  const origin = "https://beta.opencode.ai"
  const server = "https://remote.example.test"
  const requests = await proxyHosted(page, baseURL, origin)
  await fixture(page, server, "connected", [session])
  await configure(page, server, "Saved remote")
  await page.goto(origin)
  await expectSessions(page)
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Servers", exact: true }).click()
  await expect(settings.getByText("Saved remote", { exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "More options", exact: true })).toHaveCount(1)
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every((url) => new URL(url).origin === server)).toBe(true)
})

test("a server added on hosted web can be removed again", async ({ page, baseURL }) => {
  const origin = "https://beta.opencode.ai"
  const server = "https://remote.example.test"
  const requests = await proxyHosted(page, baseURL, origin)
  await fixture(page, server, "connected", [session])
  await page.goto(origin)
  await expectOnboarding(page)
  await page.getByRole("button", { name: "Add remote server", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Add server", exact: true })
  await expect(editor.getByPlaceholder("http://localhost:4096", { exact: true })).toBeFocused()
  await editor.getByPlaceholder("http://localhost:4096", { exact: true }).fill(server)
  await editor.getByPlaceholder("Localhost", { exact: true }).fill("Removable remote")
  await editor.getByRole("button", { name: "Add server", exact: true }).click()
  await expect(editor).toBeHidden()
  await expectSessions(page)

  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Servers", exact: true }).click()
  await expect(settings.getByText("Removable remote", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
  await expect(settings.getByText("No servers yet", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expectOnboarding(page)
  await expect(page.getByText(/Could not connect/)).toHaveCount(0)
  await page.reload()
  await expectOnboarding(page)
  await expect(page.getByText("Removable remote", { exact: true })).toHaveCount(0)
  expect(requests.every((url) => new URL(url).origin === server)).toBe(true)
})

test("reconnecting a loaded server preserves an in-progress session rename", async ({ page }) => {
  const stream = await fixture(page, initial, "connected", [session])
  if (!stream) throw new Error("Connected fixture must provide an event stream")
  await page.goto("/")
  await expectSessions(page)
  const connected = await stream.waitForConnection()
  const row = page.locator('[data-component="home-session-row"]').filter({ hasText: session.title })
  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Rename", exact: true })
  await expect(editor).toBeFocused()
  await editor.fill("Keep this unfinished rename")

  await stream.disconnect()
  await stream.waitForConnection({ after: connected.id })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue("Keep this unfinished rename")
  await expect(page.getByRole("heading", { name: "Connect a server", exact: true })).toHaveCount(0)
  await editor.press("Escape")
  await expectSessions(page)
})

for (const displayName of ["RemoteDevelopmentServer".repeat(10), undefined]) {
  test(`disconnected ${displayName ? "server name" : "server URL"} wraps at a narrow viewport`, async ({ page }) => {
    const url = `https://${"development-".repeat(4)}server.${"remote-".repeat(7)}example.test`
    await page.setViewportSize({ width: 360, height: 740 })
    await fixture(page, initial, "failed")
    await fixture(page, url, "failed")
    await configure(page, url, displayName)
    await page.goto("/")
    await expectOnboarding(page)
    const onboarding = page.getByRole("region", { name: "Connect a server", exact: true })
    const identity = onboarding.getByText(displayName ?? url.replace(/^https?:\/\//, ""), { exact: true })
    await expect(identity).toBeVisible()
    await expect(onboarding.getByRole("button", { name: "Add remote server", exact: true })).toBeInViewport()
    await expect(onboarding.getByRole("button", { name: "Manage servers", exact: true })).toBeInViewport()
    await expect
      .poll(() => identity.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1)
    await expect
      .poll(() => onboarding.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1)
  })
}

async function expectOnboarding(page: Page) {
  await expect(page.getByRole("heading", { name: "Connect a server", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add remote server", exact: true })).toBeEnabled()
  await expect(page.getByRole("textbox", { name: /^Search sessions/ })).toHaveCount(0)
  await expect(page.getByText("Loading", { exact: true })).toHaveCount(0)
}

async function expectSessions(page: Page, server?: string) {
  const sessions = page.getByRole("region", { name: "Recent sessions", exact: true })
  await expect(sessions.getByText(session.title, { exact: true })).toBeVisible()
  await expect(
    page.getByRole("textbox", { name: server ? `Search sessions in ${server}` : "Search sessions", exact: true }),
  ).toBeEditable()
  await expect(page.getByRole("heading", { name: "Connect a server", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Add remote server", exact: true })).toHaveCount(0)
  await expect(page.getByText("Loading", { exact: true })).toHaveCount(0)
}

async function configure(page: Page, url: string, displayName?: string) {
  await page.addInitScript(
    ({ url, displayName }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ list: [{ type: "http", http: { url }, displayName }] }),
      )
      localStorage.setItem("opencode.global.dat:layout", JSON.stringify({ home: { selection: { server: url } } }))
    },
    { url, displayName },
  )
}

async function proxyHosted(page: Page, source: string | undefined, origin: string) {
  if (!source) throw new Error("Hosted-origin tests require the local app baseURL")
  const requests: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url())
  })
  // Keep the real hostname-dependent app code, but serve every asset locally.
  await page.routeWebSocket("**/*", (socket) => socket.close())
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith("/api/")) return route.abort("connectionrefused")
    const response = await route.fetch({ url: new URL(url.pathname + url.search, source).href })
    await route.fulfill({ response })
  })
  return requests
}

async function fixture(
  page: Page,
  server: string,
  state: "connected" | "failed" | "pending",
  sessions: MockServerConfig["sessions"] = [],
) {
  const stream = state === "connected" ? await installSseTransport(page, { server }) : undefined
  const transport = createMockServerHandler({
    provider: [],
    directory: session.directory,
    project: {
      id: session.projectID,
      canonical: session.directory,
      vcs: "git",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    sessions,
    pageMessages: () => ({ items: [] }),
  })
  page.on("close", () => void transport.dispose())
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).origin !== server) return route.fallback()
    if (state === "failed") return route.abort("connectionrefused")
    // Deliberately leave both health and SSE unanswered until the isolated page closes.
    if (state === "pending") return
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    }
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    const response = await transport.handler(
      new Request(route.request().url(), { method: route.request().method(), headers: route.request().headers() }),
    )
    await route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), ...headers },
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  return stream
}
