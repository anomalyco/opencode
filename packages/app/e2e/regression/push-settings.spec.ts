import { expect, test } from "@playwright/test"
import { createECDH, randomBytes } from "node:crypto"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({
  channel: "chromium",
  permissions: ["notifications"],
  contextOptions: { reducedMotion: "reduce" },
  colorScheme: "dark",
})

test.beforeEach(async ({ page }) => {
  const directory = "/tmp/push-settings"
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_push_settings",
      canonical: directory,
      name: "Push settings",
      vcs: "git",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
})

test("push requires opt-in and explains denied permission without contacting the server", async ({ page }, info) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/push")) requests.push(request.url())
  })
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "default" })
    Object.defineProperty(Notification, "requestPermission", { value: async () => "denied" })
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Notifications", exact: true }).click()
  await expect(settings.getByRole("status")).toHaveText("Push notifications are off for this server on this browser.")
  expect(requests).toEqual([])
  const enable = settings.getByRole("button", { name: "Enable push", exact: true })
  await expect(enable).toBeEnabled()
  await enable.focus()
  await page.keyboard.press("Enter")
  await expect(settings.getByRole("status")).toHaveText(/Notification permission is not granted/)
  await expect(settings.getByRole("button", { name: "Disable push", exact: true })).toHaveCount(0)
  expect(requests).toEqual([])
  await page.screenshot({ path: info.outputPath("push-denied-desktop.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(enable).toBeInViewport()
  await expect
    .poll(() => settings.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: info.outputPath("push-denied-mobile.png") })
})

test("iOS browser explains installation before requesting permission", async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "iPhone" })
    Object.defineProperty(Notification, "requestPermission", {
      value: () => {
        throw new Error("No gesture without installation")
      },
    })
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Notifications", exact: true }).click()
  await expect(settings.getByRole("status")).toHaveText(/On iPhone or iPad, use Add to Home Screen/)
  await page.setViewportSize({ width: 390, height: 844 })
  const enable = settings.getByRole("button", { name: "Enable push", exact: true })
  await enable.click()
  await expect(settings.getByRole("status")).toHaveText(/Requires iOS or iPadOS 16.4 or later/)
  await expect
    .poll(() => settings.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: info.outputPath("push-install-mobile.png") })
})

test("long server names wrap on mobile and older servers show an actionable error", async ({ page }, info) => {
  const name = "remote-development-server-" + "long-name-without-spaces-".repeat(8)
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  await page.addInitScript(
    ({ name, server }) => {
      // Test the server capability error independently of headless browser notification policy.
      Object.defineProperty(Notification, "permission", { get: () => "granted" })
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ list: [{ type: "http", http: { url: server }, displayName: name }] }),
      )
    },
    { name, server },
  )
  await page.route("**/api/push", (route) =>
    route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" } }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Notifications", exact: true }).click()
  await expect(settings.getByText(`Notifications from ${name}`, { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await settings.getByRole("button", { name: "Enable push", exact: true }).click()
  await expect(settings.getByRole("status")).toHaveText(
    "This server does not support push notifications. Update the server and try again.",
  )
  await expect
    .poll(() => settings.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: info.outputPath("push-long-server-mobile.png") })
})

test.describe("push opt-in lifecycle", () => {
  test("enables, updates preferences, and disables through the real settings controls", async ({ page }, info) => {
    const key = createECDH("prime256v1")
    key.generateKeys()
    const publicKey = key.getPublicKey().toString("base64url")
    const keys = { p256dh: publicKey, auth: randomBytes(16).toString("base64url") }
    // Keep actual permission, worker installation, UI, and API transport. Replace only the external push service.
    await page.addInitScript((keys) => {
      let subscription: PushSubscription | null = null
      Object.defineProperties(PushManager.prototype, {
        getSubscription: { value: async () => subscription },
        subscribe: {
          value: async (options: PushSubscriptionOptionsInit) => {
            subscription = {
              endpoint: "https://fcm.googleapis.com/fcm/send/test-browser",
              expirationTime: null,
              options: {
                userVisibleOnly: true,
                applicationServerKey: new Uint8Array(options.applicationServerKey as Uint8Array).buffer,
              },
              getKey: () => null,
              toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test-browser", keys }),
              unsubscribe: async () => {
                subscription = null
                return true
              },
            }
            return subscription
          },
        },
      })
    }, keys)
    const requests: { method: string; path: string; body: Record<string, unknown> | null }[] = []
    await page.route("**/api/push{,/**}", async (route) => {
      const request = route.request()
      const method = request.method()
      if (method === "GET") return route.fulfill({ json: { publicKey } })
      requests.push({
        method,
        path: new URL(request.url()).pathname,
        body: method === "PUT" ? request.postDataJSON() : null,
      })
      await route.fulfill({ status: 204 })
    })
    await page.goto("/")
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    const settings = page.getByTestId("settings-screen")
    await settings.getByRole("tab", { name: "Notifications", exact: true }).click()
    await expect(settings.getByRole("status")).toHaveText("Push notifications are off for this server on this browser.")
    expect(requests).toEqual([])
    await settings.getByRole("button", { name: "Enable push", exact: true }).click()
    await expect(settings.getByRole("status")).toHaveText(
      "Push notifications are enabled for this server on this browser.",
    )
    expect(requests[0]).toMatchObject({
      method: "PUT",
      path: "/api/push/subscription",
      body: { keys, notifications: { agent: true, errors: false } },
    })
    const id = requests[0].body?.id
    await page.screenshot({ path: info.outputPath("push-enabled-desktop.png") })

    const errors = settings.locator('[data-action="settings-notifications-errors"]')
    await errors.locator('[data-slot="switch-control"]').click()
    await expect(errors.getByRole("switch")).toBeChecked()
    await expect
      .poll(() => requests.at(-1)?.body)
      .toMatchObject({
        id,
        notifications: { agent: true, errors: true },
      })
    await expect(settings.getByRole("button", { name: "Disable push", exact: true })).toBeEnabled()
    await settings.getByRole("button", { name: "Disable push", exact: true }).click()
    await expect(settings.getByRole("status")).toHaveText("Push notifications are off for this server on this browser.")
    expect(requests.at(-1)).toEqual({ method: "DELETE", path: `/api/push/subscription/${id}`, body: null })
    await expect(settings.getByRole("button", { name: "Enable push", exact: true })).toBeEnabled()
  })
})
