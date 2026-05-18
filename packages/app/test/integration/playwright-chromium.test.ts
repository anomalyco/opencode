import { describe, expect, test } from "vitest"
import { chromium } from "playwright"

describe("playwright chromium", () => {
  test("launches and loads about:blank", async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto("about:blank")
    expect(await page.title()).toBe("")
    await page.close()
    await browser.close()
  })
})
