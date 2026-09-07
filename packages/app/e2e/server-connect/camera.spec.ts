import { expect, test } from "@playwright/test"

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } })

test("stops the camera on cancel", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Scan QR code" }).click()
  const video = page.getByLabel("Pairing camera")
  await expect(video).toHaveJSProperty("readyState", 4)
  await expect(video).toBeVisible()
  await expect(video).toHaveCSS("opacity", "1")
  const stream = await video.evaluateHandle((element: HTMLVideoElement) => element.srcObject as MediaStream)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible()
  await expect
    .poll(() => stream.evaluate((value) => value.getTracks().every((track) => track.readyState === "ended")))
    .toBe(true)
})
