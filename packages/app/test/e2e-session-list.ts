/**
 * E2E Test: Past Sessions Are Visible
 *
 * This test verifies that when opening a project directory that already has
 * sessions on the server, the web UI shows a non-zero session count in the
 * session header. This ensures the "missing past sessions" bug is fixed.
 *
 * Run with: bun packages/app/test/e2e-session-list.ts
 */

import { chromium, type Browser } from "playwright"

const BASE_URL = process.env.APP_URL || "http://localhost:3000"
const API_URL = process.env.API_URL || "http://localhost:5050"

// Directory with many existing sessions
const testDir = "/Users/pavittra/suresh/opencode"
const encodedDir = Buffer.from(testDir).toString("base64url")

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runE2ESessionListTest() {
  console.log("🧪 Starting E2E Session List Test")
  console.log(`   Base URL: ${BASE_URL}`)
  console.log(`   API URL: ${API_URL}`)

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()

    // Capture page errors
    page.on("pageerror", (error) => {
      console.log(`   [pageerror] ${error.message}`)
    })

    const url = `${BASE_URL}/${encodedDir}/session?url=${API_URL}`
    console.log(`\n📱 Navigating to: ${url}`)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })

    // Give the app some time to bootstrap and fetch sessions
    await sleep(5_000)

    // Check localStorage for server URL persistence
    const localStorageState = await page.evaluate(() => ({
      serverUrl: localStorage.getItem("opencode-server-url"),
      serverV3: localStorage.getItem("server.v3"),
    }))
    console.log(`   → localStorage.opencode-server-url: ${localStorageState.serverUrl}`)

    if (!localStorageState.serverUrl) {
      console.log("❌ Server URL not persisted in localStorage")
      return { success: false, error: "Server URL not persisted in localStorage" }
    }

    // Wait for the session-count element to appear and have content
    const locator = page.locator('[data-e2e="session-count"]')

    // Wait for sessions to load (element becomes visible with count > 0)
    try {
      await locator.waitFor({ state: "visible", timeout: 15_000 })
    } catch {
      console.log("⚠️  session-count element not visible within timeout")
    }

    if (await locator.isVisible().catch(() => false)) {
      const text = (await locator.innerText()).trim()
      console.log(`   → Raw session-count text: "${text}"`)

      const match = text.match(/^(\d+)/)
      if (!match || !match[1]) {
        console.log("❌ Could not parse numeric session count from label")
        return { success: false, error: `Invalid session-count text: ${text}` }
      }

      const count = Number.parseInt(match[1], 10)
      console.log(`   → Parsed session count: ${count}`)

      if (!Number.isFinite(count) || count <= 0) {
        console.log("❌ Expected session count to be > 0, but got", count)
        return { success: false, error: `Expected session count > 0, got ${count}` }
      }

      console.log("✅ Past sessions are visible in the UI")
      return { success: true, error: null }
    } else {
      // Fallback: check if there are any session links in the sidebar
      const sessionLinks = await page.locator('a[href*="/session/ses_"]').count()
      console.log(`   → Session links found in sidebar: ${sessionLinks}`)

      if (sessionLinks > 0) {
        console.log("✅ Past sessions are visible in the UI (via sidebar links)")
        return { success: true, error: null }
      }

      return { success: false, error: "No sessions found in UI" }
    }
  } catch (error) {
    console.error("❌ E2E Session List Test failed with exception:", error)
    return { success: false, error: String(error) }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

runE2ESessionListTest().then((result) => {
  console.log("\n" + "=".repeat(50))
  if (result.success) {
    console.log("🎉 E2E SESSION LIST TEST: PASSED")
    process.exit(0)
  } else {
    console.log("💥 E2E SESSION LIST TEST: FAILED")
    console.log(`   Error: ${result.error}`)
    process.exit(1)
  }
})
