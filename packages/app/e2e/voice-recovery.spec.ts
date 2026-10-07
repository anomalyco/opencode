import { expect, test } from "@playwright/test"

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } })

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/fixtures/voice-recovery/index.html")
  await expect(page.getByRole("button", { name: "Record audio", exact: true })).toBeEnabled()
})

test("opens native settings, rechecks on return, and waits for an explicit recording action", async ({ page }) => {
  await page.getByRole("button", { name: "Record audio", exact: true }).click()
  await expect(page.getByText("Microphone access needed", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Open microphone settings", exact: true }).click()
  await expect(page.getByLabel("Settings destination")).toHaveText("privacy")
  await expect(page.getByText("Microphone access needed", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Return without changes" }).click()
  await expect(page.getByText("Microphone access needed", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Open microphone settings", exact: true }).click()
  await expect(page.getByText("Microphone access needed", { exact: true })).toBeHidden()
  await page.getByRole("button", { name: "Grant access and return" }).click()
  await expect(page.getByText("Microphone access allowed", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Capture requests")).toHaveText("1")
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toHaveCount(0)
  await page
    .locator('[data-slot="toast-v2-actions"]')
    .getByRole("button", { name: "Record audio", exact: true })
    .click()
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled()
  await expect(page.getByLabel("Capture requests")).toHaveText("2")
  await page.getByRole("button", { name: "Discard recording", exact: true }).click()
})

test("keeps a manual recovery path when settings cannot be opened", async ({ page }) => {
  await page.getByRole("button", { name: "Fail to open settings" }).click()
  await page.getByRole("button", { name: "Record audio", exact: true }).click()
  await page.getByRole("button", { name: "Open microphone settings", exact: true }).click()
  await expect(page.getByText("Could not open settings", { exact: true })).toBeVisible()
  await expect(page.getByText("Microphone access needed", { exact: true })).toHaveCount(0)
  await expect(page.getByText(/System Settings → Privacy & Security → Microphone/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled()
  await expect(page.getByLabel("Capture requests")).toHaveText("1")
})

test("explains an administrator restriction without offering ineffective settings actions", async ({ page }) => {
  await page.getByRole("button", { name: "Restrict access" }).click()
  await page.getByRole("button", { name: "Record audio", exact: true }).click()
  await expect(page.getByText(/Microphone access is restricted by your system or administrator/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Open microphone settings", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0)
})
