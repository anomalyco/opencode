import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const server = "http://127.0.0.1:4096"
const password = "pairing-test-password"

test("checks the password before saving and restores the connection after reload", async ({ page }) => {
  await mockOpenCodeServer(page, {
    provider: { all: [], default: {}, connected: [] },
    directory: "/fixture",
    project: { id: "fixture", worktree: "/fixture", time: { created: 1 } },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route(`${server}/api/health`, (route) =>
    route.fulfill({
      status:
        route.request().headers().authorization === `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
          ? 200
          : 401,
      json: { healthy: true, version: "2.0.0" },
    }),
  )
  await page.goto("/")
  await expect(page.getByRole("main", { name: "Connect to a server" })).toBeVisible()
  await page.getByLabel("Server address").fill(server)
  await page.getByLabel("Password", { exact: true }).fill("wrong-password")
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText(
    "Could not connect. Check the server address and password, then try again.",
  )
  expect(await page.evaluate(() => localStorage.getItem("opencode.global.dat:server"))).toBeNull()

  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible()
  await expect(page.getByRole("main", { name: "Connect to a server" })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem("opencode.global.dat:server"))).toContain(password)

  await page.reload()
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible()
  await expect(page.getByRole("main", { name: "Connect to a server" })).toHaveCount(0)
})

test("a saved offline server does not trigger first-server onboarding", async ({ page }) => {
  await page.addInitScript((server) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ list: [{ type: "http", http: { url: server } }] }),
    )
  }, server)
  await page.route(`${server}/**`, (route) => route.abort())
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible()
  await expect(page.getByRole("main", { name: "Connect to a server" })).toHaveCount(0)
})

test("disables scanning when camera access is unavailable", async ({ page }) => {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), "Permissions-Policy": "camera=()" } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Scan QR code" })).toBeDisabled()
  await expect(
    page.getByText("No camera is available to this browser. Enter your connection details manually."),
  ).toBeVisible()
  await expect(page.getByLabel("Pairing camera")).toHaveCount(0)
})
