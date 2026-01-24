/**
 * E2E Test: App Switch / Browser Reload Scenario
 *
 * This test simulates the Android app switch behavior where:
 * 1. User opens OpenCode in browser
 * 2. User switches to another app (page becomes hidden)
 * 3. User switches back to browser (page becomes visible)
 * 4. The app should recover without showing "Could not connect to server" error
 *
 * Run with: npx playwright test packages/app/test/e2e-app-switch.ts
 * Or directly: npx tsx packages/app/test/e2e-app-switch.ts
 */

import { chromium, type Page, type Browser } from "playwright"

const BASE_URL = process.env.APP_URL || "http://localhost:3000"
const API_URL = process.env.API_URL || "http://localhost:5050"

// Encode a test directory path
const testDir = "/Users/pavittra/suresh/opencode"
const encodedDir = Buffer.from(testDir).toString("base64url")

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function testAppSwitchRecovery() {
  console.log("🧪 Starting E2E App Switch Test")
  console.log(`   Base URL: ${BASE_URL}`)
  console.log(`   API URL: ${API_URL}`)

  let browser: Browser | null = null

  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
    })

    const context = await browser.newContext()
    const page = await context.newPage()

    // Collect console errors
    const errors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text())
      }
    })

    // Navigate to the app
    const url = `${BASE_URL}/${encodedDir}/session?url=${API_URL}`
    console.log(`\n📱 Navigating to: ${url}`)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await sleep(3000)

    // Check for initial error
    const initialError = await page.evaluate(() => {
      const errorEl = document.querySelector('[data-error="true"]')
      const errorText = document.body.innerText
      if (errorText.includes("Could not connect")) {
        return errorText.match(/Could not connect[^.]*\.?/)?.[0] || "Error found"
      }
      return null
    })

    if (initialError) {
      console.log(`❌ Initial load failed: ${initialError}`)
      return { success: false, error: initialError }
    }

    console.log("✅ Initial load successful")

    // Test 1: Simulate visibility change (app switch)
    console.log("\n🔄 Test 1: Simulating app switch (visibility change)...")

    // Dispatch visibility change to simulate going to background
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    console.log("   → Page hidden")
    await sleep(500)

    // Simulate coming back to foreground
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    console.log("   → Page visible")
    await sleep(2000)

    // Check for error after visibility change
    const errorAfterVisibility = await page.evaluate(() => {
      const bodyText = document.body.innerText
      if (bodyText.includes("Could not connect")) {
        return bodyText.match(/Could not connect[^.]*\.?/)?.[0] || "Error found"
      }
      return null
    })

    if (errorAfterVisibility) {
      console.log(`❌ Error after visibility change: ${errorAfterVisibility}`)
      return { success: false, error: errorAfterVisibility }
    }
    console.log("✅ No error after visibility change")

    // Test 2: Simulate page reload
    console.log("\n🔄 Test 2: Simulating page reload...")
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 })
    await sleep(3000)

    const errorAfterReload = await page.evaluate(() => {
      const bodyText = document.body.innerText
      if (bodyText.includes("Could not connect")) {
        return bodyText.match(/Could not connect[^.]*\.?/)?.[0] || "Error found"
      }
      return null
    })

    if (errorAfterReload) {
      console.log(`❌ Error after reload: ${errorAfterReload}`)
      return { success: false, error: errorAfterReload }
    }
    console.log("✅ No error after reload")

    // Test 3: Simulate multiple rapid visibility changes (like rapid app switching)
    console.log("\n🔄 Test 3: Simulating rapid app switches...")
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          writable: true,
        })
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await sleep(200)
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          writable: true,
        })
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await sleep(500)
    }
    await sleep(2000)

    const errorAfterRapid = await page.evaluate(() => {
      const bodyText = document.body.innerText
      if (bodyText.includes("Could not connect")) {
        return bodyText.match(/Could not connect[^.]*\.?/)?.[0] || "Error found"
      }
      return null
    })

    if (errorAfterRapid) {
      console.log(`❌ Error after rapid switches: ${errorAfterRapid}`)
      return { success: false, error: errorAfterRapid }
    }
    console.log("✅ No error after rapid app switches")

    // Test 4: Simulate network failure during app switch (most realistic Android scenario)
    console.log("\n🔄 Test 4: Simulating network failure + app switch (Android scenario)...")

    // Block network requests to simulate Android killing connections
    await page.route("**/global/health", (route) => route.abort("connectionfailed"))
    console.log("   → Network blocked")

    // Simulate going to background
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await sleep(1000)

    // Restore network before coming back (simulates Android restoring connections)
    await page.unroute("**/global/health")
    console.log("   → Network restored")

    // Simulate coming back to foreground
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    console.log("   → Page visible, waiting for recovery...")
    await sleep(4000) // Wait for retry logic

    // Final check
    const finalError = await page.evaluate(() => {
      const bodyText = document.body.innerText
      if (bodyText.includes("Could not connect")) {
        return bodyText.match(/Could not connect[^.]*\.?/)?.[0] || "Error found"
      }
      return null
    })

    if (finalError) {
      console.log(`❌ Final check failed: ${finalError}`)
      return { success: false, error: finalError }
    }
    console.log("✅ Recovered from network failure after app switch")

    // Check console errors
    const relevantErrors = errors.filter((e) => e.includes("connect") || e.includes("server") || e.includes("health"))
    if (relevantErrors.length > 0) {
      console.log(`⚠️  Console errors detected: ${relevantErrors.join(", ")}`)
    }

    console.log("\n✅ All tests passed!")
    return { success: true, error: null }
  } catch (error) {
    console.error(`❌ Test failed with exception: ${error}`)
    return { success: false, error: String(error) }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

// Run the test
testAppSwitchRecovery().then((result) => {
  console.log("\n" + "=".repeat(50))
  if (result.success) {
    console.log("🎉 E2E APP SWITCH TEST: PASSED")
    process.exit(0)
  } else {
    console.log(`💥 E2E APP SWITCH TEST: FAILED`)
    console.log(`   Error: ${result.error}`)
    process.exit(1)
  }
})
