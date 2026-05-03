import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { cleanupSession } from "../actions"

/**
 * E2E: AI responds to a simple prompt (infrastructure smoke; small models may not tool-call reliably).
 */
test("AI responds to user input", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const sessionResult = await sdk.session.create({})
  if (!sessionResult.data) throw new Error("Failed to create session")
  const session = sessionResult.data
  const sessionID = session.id

  await gotoSession(sessionID)

  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type("Say hello")
  await page.keyboard.press("Enter")

  try {
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
  } finally {
    await cleanupSession({ sdk, sessionID })
  }
})
