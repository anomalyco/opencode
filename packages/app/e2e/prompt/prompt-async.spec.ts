import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { sessionIDFromUrl } from "../actions"

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
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})
