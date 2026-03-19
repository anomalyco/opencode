import { test, expect, licenseKey } from "../fixtures"
import { seedProjects } from "../actions"
import { sessionPath } from "../utils"

test("unlicensed app shows license gate", async ({ page, directory }) => {
  await seedProjects(page, { directory })
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key)
  }, licenseKey)

  await page.goto(sessionPath(directory))

  const gate = page.locator('[data-component="license-gate-panel"]')
  await expect(gate).toBeVisible()
  await expect(page.getByText("Activate OpenCode")).toBeVisible()
})

test("entering a valid license unlocks the app", async ({ page, directory }) => {
  await seedProjects(page, { directory })
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key)
  }, licenseKey)

  await page.route("**/v1/licenses/activate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "active",
        masked_key: "LIVE-XXXX-9999",
        plan: "pro",
        entitlement_token: "entitlement-token",
        refresh_token: "refresh-token",
        last_validated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        grace_until: new Date(Date.now() + 1000 * 60 * 60 * 24 * 37).toISOString(),
      }),
    })
  })

  await page.goto(sessionPath(directory))

  await page.locator('[data-action="license-gate-key"]').fill("VALID-LICENSE-KEY")
  await page.locator('[data-action="license-gate-submit"]').click()

  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, licenseKey)

  expect(stored?.maskedKey).toBe("LIVE-XXXX-9999")
  expect(stored?.state).toBe("active")
})
