import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { cleanupSession } from "../actions"

/**
 * Comprehensive E2E tests for AI reply flow in stateless architecture.
 * 
 * Architecture:
 * - Projects are database entities with UUIDs
 * - URLs use /projects/<id>/session/<session-id> format  
 * - No local filesystem persistence (files in S3 eventually)
 * - Session + prompt flow against local OpenCode API
 * - Sessions are stateless and belong to database projects
 */

test.describe("AI Reply Flow - Stateless Architecture", () => {
  
  test("complete flow - creates session, sends prompt, receives reply", async ({ page, sdk, project, gotoSession }) => {
    test.setTimeout(120_000)

    console.log(`[Test] Using project: ${project.id}`)

    const pageErrors: string[] = []
    page.on("pageerror", (err) => {
      pageErrors.push(err.message)
      console.error("[Page Error]", err.message)
    })

    const sessionResult = await sdk.session.create({ title: "E2E Test Session" })
    if (!sessionResult.data) throw new Error("Failed to create session")
    const session = sessionResult.data
    const sessionID = session.id
    console.log(`[Test] Created session: ${sessionID}`)

    expect(session.projectID).toBe(project.id)

    try {
      // Navigate to the session
      await gotoSession(sessionID)
      console.log(`[Test] Navigated to session page`)

      // Send a prompt
      const token = `E2E_REPLY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const promptText = `Reply with exactly this token: ${token}`

      const prompt = page.locator(promptSelector)
      await prompt.click()
      await page.keyboard.type(promptText)
      await page.keyboard.press("Enter")
      console.log(`[Test] Sent prompt: "${promptText}"`)

      // Poll for the AI reply via SDK
      console.log("[Test] Polling for AI reply...")
      
      await expect
        .poll(
          async () => {
            const messagesResult = await sdk.session.messages({ sessionID, limit: 50 })
            const messages = messagesResult.data ?? []
            
            const assistantMessages = messages.filter((m) => m.info.role === "assistant")
            
            for (const msg of assistantMessages) {
              const textParts = msg.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
              
              const combinedText = textParts.join("\n")
              if (combinedText.includes(token)) {
                console.log("[Test] ✓ Found token in AI reply!")
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

      console.log("[Test] ✓ Test passed - received AI reply with expected token")

    } finally {
      page.off("pageerror", () => {})
      await cleanupSession({ sdk, sessionID })
      console.log(`[Test] Cleaned up session: ${sessionID}`)
    }

    if (pageErrors.length > 0) {
      throw new Error(`[Test] Page errors occurred:\n${pageErrors.join("\n")}`)
    }
  })

  test("multiple sessions in same project", async ({ page, sdk, project, gotoSession }) => {
    test.setTimeout(180_000)

    console.log(`[Test] Using project: ${project.id}`)

    // Create multiple sessions
    const session1Result = await sdk.session.create({ title: "Session 1" })
    const session2Result = await sdk.session.create({ title: "Session 2" })
    if (!session1Result.data || !session2Result.data) throw new Error("Failed to create sessions")
    const session1 = session1Result.data
    const session2 = session2Result.data
    
    console.log(`[Test] Created sessions: ${session1.id}, ${session2.id}`)

    try {
      // Send prompts to both sessions
      const token1 = `SESSION1_${Date.now()}`
      const token2 = `SESSION2_${Date.now()}`

      // Session 1
      await gotoSession(session1.id)
      await page.locator(promptSelector).click()
      await page.keyboard.type(`Say: ${token1}`)
      await page.keyboard.press("Enter")

      // Session 2
      await gotoSession(session2.id)
      await page.locator(promptSelector).click()
      await page.keyboard.type(`Say: ${token2}`)
      await page.keyboard.press("Enter")

      // Verify both get replies
      await expect
        .poll(
          async () => {
            const messages = await sdk.session.messages({ sessionID: session1.id, limit: 50 }).then((r) => r.data ?? [])
            const texts = messages
              .filter((m) => m.info.role === "assistant")
              .flatMap((m) => m.parts)
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
            return texts.includes(token1)
          },
          { timeout: 90_000 },
        )
        .toBe(true)

      await expect
        .poll(
          async () => {
            const messages = await sdk.session.messages({ sessionID: session2.id, limit: 50 }).then((r) => r.data ?? [])
            const texts = messages
              .filter((m) => m.info.role === "assistant")
              .flatMap((m) => m.parts)
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
            return texts.includes(token2)
          },
          { timeout: 90_000 },
        )
        .toBe(true)

      console.log("[Test] ✓ Both sessions received replies")

    } finally {
      await cleanupSession({ sdk, sessionID: session1.id })
      await cleanupSession({ sdk, sessionID: session2.id })
    }
  })

  test("using withProject to create isolated test project", async ({ sdk, withProject }) => {
    test.setTimeout(120_000)

    await withProject(async (project) => {
      console.log(`[Test] Created isolated project: ${project.id}`)

      // Create session in this isolated project
      const sessionResult = await sdk.session.create({ title: "Isolated Test" })
      if (!sessionResult.data) throw new Error("Failed to create session")
      const session = sessionResult.data
      
      expect(session.id).toBeDefined()
      expect(session.projectID).toBe(project.id)
      
      console.log(`[Test] ✓ Session created in isolated project: ${session.id}`)

      // The session will be cleaned up automatically by withProject
    })
  })
})
