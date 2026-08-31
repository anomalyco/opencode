import { expect, test } from "@playwright/test"
import { renderSVG } from "uqr"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ serviceWorkers: "block" })

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: "/pairing-demo",
    project: { id: "proj_pairing_demo", canonical: "/pairing-demo", time: { created: 1, updated: 1 } },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Servers", exact: true }).click()
  await settings.getByRole("button", { name: "Add server", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Add server" }).getByLabel("Server address")).toBeEditable()
})

test("imports a pairing image and authenticates only after confirmation", async ({ page }) => {
  const info = {
    urls: ["http://192.168.1.20:49374", "http://100.100.10.20:49374"],
    username: "opencode",
    password: "pairing-test-password",
  }
  const requests: string[] = []
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (!info.urls.includes(url.origin)) return route.fallback()
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization",
          "access-control-allow-methods": "GET",
        },
      })
    requests.push(url.origin)
    const authorized = route.request().headers().authorization === `Basic ${btoa(`${info.username}:${info.password}`)}`
    return route.fulfill({
      status: authorized ? 200 : 401,
      headers: { "access-control-allow-origin": "*" },
      json: url.pathname === "/api/health" ? { healthy: true, version: "2.0.0" } : {},
    })
  })
  const dialog = page.getByRole("dialog", { name: "Add server" })
  await expect(dialog.getByText(/Run opencode2 pair on the server/)).toBeVisible()
  await dialog.getByLabel("Choose QR image").setInputFiles({
    name: "pairing.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(renderSVG(JSON.stringify(info), { border: 2 })),
  })
  await expect(dialog.getByLabel("Server address")).toHaveValue(info.urls[1])
  await expect(dialog.getByLabel("Username (optional)")).toHaveValue(info.username)
  await expect(dialog.getByLabel("Password (optional)")).toHaveValue(info.password)
  await expect(dialog.getByRole("status")).toHaveText(
    "Connection details filled in. Review the server address, then select Add server.",
  )
  const addresses = dialog.getByRole("group", { name: "Addresses from the pairing code" })
  await addresses.getByRole("button").click()
  await page.getByRole("option").filter({ hasText: info.urls[0] }).click()
  await expect(dialog.getByLabel("Server address")).toHaveValue(info.urls[0])
  await expect(page.getByRole("listbox")).toBeHidden()
  await addresses.getByRole("button").click()
  await page.getByRole("option").filter({ hasText: info.urls[1] }).click()
  await expect(dialog.getByLabel("Server address")).toHaveValue(info.urls[1])
  expect(requests).toEqual([])

  const health = page.waitForResponse(`${info.urls[1]}/api/health`)
  await dialog.getByRole("button", { name: "Add server", exact: true }).click()
  expect((await health).status()).toBe(200)
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId("settings-screen").getByText("100.100.10.20:49374", { exact: true })).toBeVisible()
})

test("rejects an unrelated QR image without changing the form", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Add server" })
  await dialog.getByLabel("Choose QR image").setInputFiles({
    name: "unrelated.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(renderSVG("https://example.test", { border: 2 })),
  })
  await expect(dialog.getByRole("alert")).toHaveText(
    "This is not an OpenCode pairing code. Run opencode2 pair on the server to get one.",
  )
  await expect(dialog.getByLabel("Server address")).toBeEmpty()
  await expect(dialog.getByLabel("Password (optional)")).toBeEmpty()
})

test("keeps camera controls accessible on a short screen and releases the camera", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.evaluate(() => {
    // Supply a real browser MediaStream without requiring camera hardware or OS permission dialogs.
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 640
      canvas.height = 480
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Missing canvas context")
      context.fillStyle = "white"
      context.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.captureStream(10)
    }
  })
  const dialog = page.getByRole("dialog", { name: "Add server" })
  await dialog.getByRole("button", { name: "Scan QR code" }).click()
  const video = dialog.getByLabel("QR code camera preview")
  await expect
    .poll(() => video.evaluate((element) => element instanceof HTMLVideoElement && element.videoWidth > 0))
    .toBe(true)
  const track = await video.evaluateHandle((element) => {
    if (!(element instanceof HTMLVideoElement) || !(element.srcObject instanceof MediaStream))
      throw new Error("Expected a camera stream")
    return element.srcObject.getVideoTracks()[0]
  })
  await expect(dialog.getByRole("heading", { name: "Add server" })).toBeInViewport()
  await expect(dialog.getByRole("button", { name: "Add server", exact: true })).toBeInViewport()
  await dialog.getByRole("button", { name: "Stop camera" }).click()
  await expect(video).toHaveCount(0)
  await expect.poll(() => track.evaluate((value) => value.readyState)).toBe("ended")
})
