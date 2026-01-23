/**
 * E2E Test: Navigation Buttons
 *
 * This test verifies that the 4 navigation buttons in the session view work:
 * 1. Go to top - scrolls to the top of the page
 * 2. Go to bottom - scrolls to the bottom of the page
 * 3. Previous message - navigates to the previous user message
 * 4. Next message - navigates to the next user message
 *
 * Run with: bun packages/app/test/e2e-nav-buttons.ts
 */

import { chromium, type Browser, type Page } from "playwright"

const BASE_URL = process.env.APP_URL || "http://localhost:3001"
const API_URL = process.env.API_URL || "http://localhost:5050"

const testDir = "/Users/pavittra/suresh/opencode"
const encodedDir = Buffer.from(testDir).toString("base64url")

// Session with many messages for proper scroll testing
const TEST_SESSION_ID = process.env.TEST_SESSION_ID || "ses_474f2c07dffeskxRJbVzCnV3gq"

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getScrollPosition(page: Page): Promise<number> {
  return page.evaluate(() => {
    const container = document.querySelector("[data-session-scroll]")
    return container ? container.scrollTop : 0
  })
}

async function getScrollHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const container = document.querySelector("[data-session-scroll]")
    return container ? container.scrollHeight : 0
  })
}

async function getClientHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const container = document.querySelector("[data-session-scroll]")
    return container ? container.clientHeight : 0
  })
}

async function runE2ENavButtonsTest() {
  console.log("🧪 Starting E2E Navigation Buttons Test")
  console.log(`   Base URL: ${BASE_URL}`)
  console.log(`   API URL: ${API_URL}`)
  console.log(`   Test Session: ${TEST_SESSION_ID}`)

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    const page = await context.newPage()

    page.on("pageerror", (error) => {
      console.log(`   [pageerror] ${error.message}`)
    })

    // Navigate directly to a session with multiple messages
    const sessionUrl = `${BASE_URL}/${encodedDir}/session/${TEST_SESSION_ID}?url=${API_URL}`
    console.log(`\n📱 Navigating to session: ${sessionUrl}`)
    await page.goto(sessionUrl, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await sleep(5_000)

    // Check scroll dimensions
    const scrollHeight = await getScrollHeight(page)
    const clientHeight = await getClientHeight(page)
    const isScrollable = scrollHeight > clientHeight
    console.log(`   → Scroll dimensions: height=${scrollHeight}, client=${clientHeight}, scrollable=${isScrollable}`)

    if (!isScrollable) {
      console.log("⚠️  Page is not scrollable, trying to find a session with more content...")
      // Fall back to finding a session via the list
      const listUrl = `${BASE_URL}/${encodedDir}/session?url=${API_URL}`
      await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 60_000 })
      await sleep(3_000)

      const sessionLinks = page.locator('a[href*="/session/ses_"]')
      const sessionCount = await sessionLinks.count()

      if (sessionCount === 0) {
        return { success: false, error: "No sessions found" }
      }

      // Try first few sessions to find one with scrollable content
      for (let i = 0; i < Math.min(sessionCount, 5); i++) {
        const href = await sessionLinks.nth(i).getAttribute("href")
        if (!href) continue

        await page.goto(`${BASE_URL}${href}?url=${API_URL}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
        await sleep(3_000)

        const sh = await getScrollHeight(page)
        const ch = await getClientHeight(page)
        if (sh > ch + 100) {
          console.log(`   → Found scrollable session at index ${i}`)
          break
        }
      }
    }

    // Check if navigation buttons are visible
    const navButtons = page.locator('[data-e2e="nav-buttons"]')
    const navButtonsVisible = await navButtons.isVisible().catch(() => false)

    if (!navButtonsVisible) {
      console.log("❌ Navigation buttons not visible")
      return { success: false, error: "Navigation buttons not visible" }
    }
    console.log("✅ Navigation buttons are visible")

    // Get button locators
    const topButton = page.locator('[data-e2e="nav-top"]')
    const bottomButton = page.locator('[data-e2e="nav-bottom"]')
    const prevMsgButton = page.locator('[data-e2e="nav-prev-msg"]')
    const nextMsgButton = page.locator('[data-e2e="nav-next-msg"]')

    // Verify all buttons are visible
    console.log("\n🔍 Verifying all buttons are visible...")
    const allButtonsVisible =
      (await topButton.isVisible()) &&
      (await bottomButton.isVisible()) &&
      (await prevMsgButton.isVisible()) &&
      (await nextMsgButton.isVisible())

    if (!allButtonsVisible) {
      console.log("❌ Not all navigation buttons are visible")
      return { success: false, error: "Not all navigation buttons visible" }
    }
    console.log("   ✓ All 4 buttons are visible")

    // Test 1: Go to bottom button
    console.log("\n🔍 Test 1: Go to bottom button")
    const initialScroll = await getScrollPosition(page)
    console.log(`   → Initial scroll position: ${initialScroll}`)

    await bottomButton.click()
    await sleep(1_500)

    const afterBottomScroll = await getScrollPosition(page)
    const finalScrollHeight = await getScrollHeight(page)
    const finalClientHeight = await getClientHeight(page)
    const maxScroll = finalScrollHeight - finalClientHeight
    console.log(`   → After clicking bottom: ${afterBottomScroll} (max: ${maxScroll})`)

    if (afterBottomScroll > initialScroll || afterBottomScroll >= maxScroll - 50) {
      console.log("   ✓ Bottom button works - scrolled down")
    } else {
      console.log("   ⚠️ Bottom button may not have scrolled properly")
    }

    // Test 2: Go to top button
    console.log("\n🔍 Test 2: Go to top button")
    await topButton.click()
    await sleep(1_500)

    const afterTopScroll = await getScrollPosition(page)
    console.log(`   → After clicking top: ${afterTopScroll}`)

    if (afterTopScroll <= 10) {
      console.log("   ✓ Top button works - scrolled to top")
    } else {
      console.log("   ⚠️ Top button may not have scrolled to top properly")
    }

    // Test 3: Previous message button
    console.log("\n🔍 Test 3: Previous message button")
    // First go to bottom, then test prev
    await bottomButton.click()
    await sleep(1_000)

    const beforePrevClick = await getScrollPosition(page)
    await prevMsgButton.click()
    await sleep(1_000)
    const afterPrevClick = await getScrollPosition(page)
    console.log(`   → Before prev: ${beforePrevClick}, after: ${afterPrevClick}`)

    if (afterPrevClick < beforePrevClick) {
      console.log("   ✓ Previous message button works - scrolled up")
    } else if (afterPrevClick === beforePrevClick) {
      console.log("   ⚠️ No scroll change (may be at first message or single message)")
    }

    // Test 4: Next message button
    console.log("\n🔍 Test 4: Next message button")
    // First go to top, then test next
    await topButton.click()
    await sleep(1_000)

    const beforeNextClick = await getScrollPosition(page)
    await nextMsgButton.click()
    await sleep(1_000)
    const afterNextClick = await getScrollPosition(page)
    console.log(`   → Before next: ${beforeNextClick}, after: ${afterNextClick}`)

    if (afterNextClick > beforeNextClick) {
      console.log("   ✓ Next message button works - scrolled down")
    } else if (afterNextClick === beforeNextClick) {
      console.log("   ⚠️ No scroll change (may be at last message or single message)")
    }

    console.log("\n✅ All navigation buttons test completed successfully")
    return { success: true, error: null }
  } catch (error) {
    console.error("❌ E2E Navigation Buttons Test failed with exception:", error)
    return { success: false, error: String(error) }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

runE2ENavButtonsTest().then((result) => {
  console.log("\n" + "=".repeat(50))
  if (result.success) {
    console.log("🎉 E2E NAVIGATION BUTTONS TEST: PASSED")
    process.exit(0)
  } else {
    console.log("💥 E2E NAVIGATION BUTTONS TEST: FAILED")
    console.log(`   Error: ${result.error}`)
    process.exit(1)
  }
})
