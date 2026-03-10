import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { cleanupSession, sessionIDFromUrl, withSession } from "../actions"

const text = (value: string | null) => (value ?? "").replace(/\u200B/g, "").trim()

// Regression test for Issue #12453: the synchronous POST /message endpoint holds
// the connection open while the agent works, causing "Failed to fetch" over
// VPN/Tailscale. The fix switches to POST /prompt_async which returns immediately.
test("prompt succeeds when sync message endpoint is unreachable", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  // Simulate Tailscale/VPN killing the long-lived sync connection
  await page.route("**/session/*/message", (route) => route.abort("connectionfailed"))

  await gotoSession()

  const token = `E2E_ASYNC_${Date.now()}`
  await page.locator(promptSelector).click()
  await page.keyboard.type(`Reply with exactly: ${token}`)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })
  const sessionID = sessionIDFromUrl(page.url())!

  try {
    // Agent response arrives via SSE despite sync endpoint being dead
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
        { timeout: 90_000 },
      )
      .toContain(token)
  } finally {
    await cleanupSession({ sdk, sessionID })
  }
})

test("failed prompt send restores the composer input", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, `e2e prompt failure ${Date.now()}`, async (session) => {
    const prompt = page.locator(promptSelector)
    const value = `restore ${Date.now()}`

    await page.route(`**/session/${session.id}/prompt_async`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "e2e prompt failure" }),
      }),
    )

    await gotoSession(session.id)
    await prompt.click()
    await page.keyboard.type(value)
    await page.keyboard.press("Enter")

    await expect.poll(async () => text(await prompt.textContent())).toBe(value)
    await expect
      .poll(
        async () => {
          const messages = await sdk.session.messages({ sessionID: session.id, limit: 50 }).then((r) => r.data ?? [])
          return messages.length
        },
        { timeout: 15_000 },
      )
      .toBe(0)
  })
})
