import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

const key = "opencode.settings.dat:defaultServerUrl"

const stored = (page: Page) => page.evaluate((item: string) => localStorage.getItem(item), key)

test.describe("direct-load mode", () => {
  test("loads frontend with ?server= param and connects to API", async ({ page }) => {
    const serverUrl = "http://localhost:4096"
    const appUrl = `/?server=${encodeURIComponent(serverUrl)}`

    await page.goto(appUrl, { waitUntil: "domcontentloaded" })
    await expect.poll(() => stored(page)).toBe(serverUrl)
  })

  test("persisted server URL survives reload without ?server= param", async ({ page }) => {
    const serverUrl = "http://localhost:4096"
    const appUrl = `/?server=${encodeURIComponent(serverUrl)}`

    await page.goto(appUrl, { waitUntil: "domcontentloaded" })
    await expect.poll(() => stored(page)).toBe(serverUrl)

    await page.goto("/", { waitUntil: "domcontentloaded" })
    await expect.poll(() => stored(page)).toBe(serverUrl)
  })

  test("invalid ?server= param is ignored", async ({ page }) => {
    const appUrl = "/?server=ftp://invalid"

    await page.goto(appUrl, { waitUntil: "domcontentloaded" })

    expect(await stored(page)).toBeNull()
  })
})
