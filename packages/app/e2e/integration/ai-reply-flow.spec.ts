import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { cleanupSession, sessionIDFromUrl, withSession } from "../actions"

/**
 * End-to-end test that verifies the complete AI reply flow:
 * 1. Uses withSession helper which properly seeds storage
 * 2. Navigates to the session in the browser
 * 3. Sends a prompt via the UI
 * 4. Waits for and verifies the AI reply via SDK polling
 */
test("complete AI reply flow - creates session, sends prompt, receives reply", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  page.on("pageerror", (err) => {
    pageErrors.push(err.message)
    console.error("Page error:", err.message)
  })

  await withSession(sdk, "E2E AI Reply Test", async (session) => {
    console.log(`Created session: ${session.id}`)

    // Navigate to the session in the browser
    await gotoSession(session.id)
    console.log("Navigated to session page")

    // Verify we're on the right page
    await expect(page).toHaveURL(/\/session\/[^/?#]+/)
    const sessionID = sessionIDFromUrl(page.url())
    expect(sessionID).toBe(session.id)
    console.log(`Verified session ID in URL: ${sessionID}`)

    // Send a prompt via the UI
    const token = `E2E_REPLY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const promptText = `Reply with exactly this token: ${token}`

    const prompt = page.locator(promptSelector)
    await expect(prompt).toBeVisible()
    await prompt.click()
    await page.keyboard.type(promptText)
    await page.keyboard.press("Enter")
    console.log(`Sent prompt: "${promptText}"`)

    // Poll for the AI reply via SDK
    console.log("Polling for AI reply...")
    
    await expect
      .poll(
        async () => {
          const messagesResult = await sdk.session.messages({ sessionID: session.id, limit: 50 })
          const messages = messagesResult.data ?? []
          
          // Find assistant messages with text parts
          const assistantMessages = messages.filter((m) => m.info.role === "assistant")
          
          for (const msg of assistantMessages) {
            const textParts = msg.parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
            
            const combinedText = textParts.join("\n")
            if (combinedText.includes(token)) {
              console.log("✓ Found token in AI reply!")
              return combinedText
            }
          }
          
          return null
        },
        { 
          timeout: 90_000,
          intervals: [1_000, 2_000, 2_000],
        },
      )
      .toContain(token)

    console.log("✓ Test passed - received AI reply with expected token")

    // Cleanup is handled by withSession
  })

  page.off("pageerror", (err) => console.error(err))

  if (pageErrors.length > 0) {
    throw new Error(`Page errors occurred during test:\n${pageErrors.join("\n")}`)
  }
})

/**
 * Test that creates a session via SDK directly and verifies the full flow works
 * This tests the scenario where a session is created programmatically
 */
test("session created via SDK - can receive AI reply", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  page.on("pageerror", (err) => {
    pageErrors.push(err.message)
  })

  // Create session via SDK
  const title = `SDK Test ${Date.now()}`
  const session = await sdk.session.create({ title })
  
  expect(session.id).toBeDefined()
  console.log(`Created session via SDK: ${session.id}`)

  try {
    // Navigate to the session
    await gotoSession(session.id)
    
    // Send a message
    const token = `SDK_TOKEN_${Date.now()}`
    const prompt = page.locator(promptSelector)
    await prompt.click()
    await page.keyboard.type(`Say: ${token}`)
    await page.keyboard.press("Enter")

    // Wait for AI reply
    await expect
      .poll(
        async () => {
          const result = await sdk.session.messages({ sessionID: session.id, limit: 50 })
          const messages = result.data ?? []
          
          const assistantTexts = messages
            .filter((m) => m.info.role === "assistant")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
          
          return assistantTexts.includes(token) ? assistantTexts : null
        },
        { timeout: 90_000 },
      )
      .toContain(token)

    console.log("✓ Received AI reply for SDK-created session")

  } finally {
    page.off("pageerror", () => {})
    await cleanupSession({ sdk, sessionID: session.id })
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page errors:\n${pageErrors.join("\n")}`)
  }
})

/**
 * Test that verifies session lifecycle - create, send message, verify appears, cleanup
 */
test("full session lifecycle with AI interaction", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  await withSession(sdk, "Lifecycle Test", async (session) => {
    await gotoSession(session.id)

    // Verify initial state - no messages
    const initialResult = await sdk.session.messages({ sessionID: session.id, limit: 50 })
    const initialMessages = initialResult.data ?? []
    const initialCount = initialMessages.length
    console.log(`Initial message count: ${initialCount}`)

    // Send a prompt
    const token = `LIFECYCLE_${Date.now()}`
    const prompt = page.locator(promptSelector)
    await prompt.click()
    await page.keyboard.type(`Echo: ${token}`)
    await page.keyboard.press("Enter")

    // Wait for user message to appear
    await expect
      .poll(
        async () => {
          const result = await sdk.session.messages({ sessionID: session.id, limit: 50 })
          const messages = result.data ?? []
          const userTexts = messages
            .filter((m) => m.info.role === "user")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("")
          return userTexts.includes(token)
        },
        { timeout: 30_000 },
      )
      .toBe(true)
    
    console.log("✓ User message saved")

    // Wait for AI reply
    await expect
      .poll(
        async () => {
          const result = await sdk.session.messages({ sessionID: session.id, limit: 50 })
          const messages = result.data ?? []
          const assistantTexts = messages
            .filter((m) => m.info.role === "assistant")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
          return assistantTexts.includes(token) ? assistantTexts : null
        },
        { timeout: 90_000 },
      )
      .toContain(token)

    console.log("✓ AI reply received")

    // Verify message count increased
    const finalResult = await sdk.session.messages({ sessionID: session.id, limit: 50 })
    const finalMessages = finalResult.data ?? []
    console.log(`Final message count: ${finalMessages.length}`)
    expect(finalMessages.length).toBeGreaterThan(initialCount)
  })
})
