import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { cleanupSession, sessionIDFromUrl } from "../actions"

/**
 * E2E test for stateless architecture with database projects
 * 
 * In the new architecture:
 * - Projects are database entities with UUIDs, not filesystem directories
 * - Sessions belong to projects (via project_id foreign key)
 * - URLs use /projects/<id>/session/<session-id> format
 * - Files are not persisted locally (eventually will be in S3)
 * - Prompt and session flow
 */
test("can send a prompt and receive a reply", async ({ page, sdk, project, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  console.log(`Using project: ${project.id}`)

  // Create a session via SDK - it will be associated with the seeded project
  const sessionResult = await sdk.session.create({})
  if (!sessionResult.data) throw new Error("Failed to create session")
  const session = sessionResult.data
  const sessionID = session.id

  console.log(`Created session: ${sessionID}`)

  await gotoSession(sessionID)

  const token = `E2E_OK_${Date.now()}`

  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type(`Reply with exactly: ${token}`)
  await page.keyboard.press("Enter")

  // Wait a bit for the LLM request to be initiated
  await page.waitForTimeout(2000)

  try {
    await expect
      .poll(
        async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
          return messages
            .filter((m) => m.info.role === "assistant")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
        },
        { timeout: 90_000, intervals: [1000, 2000, 2000] },
      )
      .toContain(token)
    
    console.log("✓ Received AI reply with expected token")
  } finally {
    page.off("pageerror", onPageError)
    await cleanupSession({ sdk, sessionID })
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})
