import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { cleanupSession } from "../actions"
import { Executor } from "../../../opencode/src/executor/sdk"

/**
 * E2E test for AI integration with executor
 * 
 * This test verifies:
 * 1. AI responds to user input
 * 2. Executor SDK is accessible
 * 3. Basic session workflow works end-to-end
 * 
 * Note: The qwen2.5:0.5b model is too small for reliable tool calling.
 * This test verifies the infrastructure works, not that AI uses tools.
 */
test("AI responds and executor is accessible", async ({ page, sdk, project, gotoSession }) => {
  test.setTimeout(120_000)

  console.log(`Using project: ${project.id}`)

  // Create a session via SDK
  const sessionResult = await sdk.session.create({})
  if (!sessionResult.data) throw new Error("Failed to create session")
  const session = sessionResult.data
  const sessionID = session.id

  console.log(`Created session: ${sessionID}`)

  await gotoSession(sessionID)

  // Connect to executor via SDK
  const executorUrl = process.env.VERITLY_EXECUTOR_URL
  if (!executorUrl) throw new Error("VERITLY_EXECUTOR_URL not set")
  const executor = Executor.create({ baseUrl: executorUrl })
  
  // Verify executor is healthy
  const health = await executor.health()
  console.log(`[Test] Executor health: ${health.ok}, mode: ${health.mode}`)
  expect(health.ok).toBe(true)

  // Ask AI a simple question
  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type("Say hello")
  await page.keyboard.press("Enter")

  try {
    // Poll for AI's response
    await expect
      .poll(
        async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
          const assistantMessages = messages.filter((m) => m.info.role === "assistant")
          
          for (const msg of assistantMessages) {
            const textParts = msg.parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
            
            if (textParts.length > 0) {
              return textParts
            }
          }
          return ""
        },
        { timeout: 120_000, intervals: [1000, 2000, 5000] },
      )
      .not.toBe("")

    console.log("✓ AI responded")

    // Test executor can run commands
    const execResult = await executor.exec(sessionID, "echo hello from executor", 10000)
    console.log(`[Test] Executor output: ${execResult.output}`)
    expect(execResult.exitCode).toBe(0)
    expect(execResult.output).toContain("hello from executor")

    console.log("✓ Executor SDK works")

  } finally {
    await cleanupSession({ sdk, sessionID })
  }

  console.log("✅ Test passed - AI responds and executor is accessible")
})