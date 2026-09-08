import { expect, test } from "@playwright/test"

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream"] } })

test.beforeEach(async ({ page, baseURL }) => {
  // Serve the production build at real secure/insecure origins without overriding browser APIs.
  await page.route("**://app.example.test/**", async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({ response: await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href }) })
  })
})

test("warns about mixed content and clears the warning for HTTPS and loopback servers", async ({ page }) => {
  await page.goto("https://app.example.test/")
  await expect(page.getByRole("main", { name: "Connect to a server" })).toBeVisible()
  await page.getByLabel("Server address").fill("http://192.168.1.20:4096")
  await expect(page.getByRole("status")).toContainText("Your browser may block connections to HTTP servers.")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled()
  await page.getByLabel("Server address").fill("http://localhost:4096")
  await expect(page.getByRole("status")).toHaveCount(0)
  await page.getByLabel("Server address").fill("https://server.example")
  await expect(page.getByRole("status")).toHaveCount(0)
})

test("disables scanning on non-local HTTP pages even when a camera is installed", async ({ page }) => {
  await page.goto("http://app.example.test/")
  await expect(page.getByRole("button", { name: "Scan QR code" })).toBeDisabled()
  await expect(page.getByText("QR scanning requires opening this page over HTTPS or on localhost.")).toBeVisible()
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
  await page.getByLabel("Server address").fill("http://192.168.1.20:4096")
  await expect(page.getByRole("status")).toHaveCount(0)
})

test("enables scanning on HTTPS when the browser has a camera", async ({ page }) => {
  await page.goto("https://app.example.test/")
  await expect(page.getByRole("button", { name: "Scan QR code" })).toBeEnabled()
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true)
})

test("also warns in the add-server dialog", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ list: [{ type: "http", http: { url: "http://127.0.0.1:4096" } }] }),
    )
  })
  await page.route("http://127.0.0.1:4096/**", (route) => route.abort())
  await page.route("http://server.example:4096/**", (route) => route.abort())
  await page.goto("https://app.example.test/settings")
  await page.getByRole("tab", { name: "Servers", exact: true }).click()
  await page.getByRole("button", { name: "Add server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("http://localhost:4096").fill("http://server.example:4096")
  await expect(dialog.getByRole("status")).toContainText("Your browser may block connections to HTTP servers.")
  await dialog.getByPlaceholder("http://localhost:4096").fill("http://localhost:4096")
  await expect(dialog.getByRole("status")).toHaveCount(0)
})

test("camera permission failure preserves the form and rechecks access on cancel", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await page.getByLabel("Server address").fill("http://127.0.0.1:4096")
  await page.getByRole("button", { name: "Scan QR code" }).click()
  await expect(page.getByRole("alert")).toHaveText(
    "Could not open the camera. Allow camera access or enter your connection details manually.",
  )
  await context.grantPermissions([])
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByLabel("Server address")).toHaveValue("http://127.0.0.1:4096")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Scan QR code" })).toBeDisabled()
})
