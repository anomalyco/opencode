import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { assistantText, withSession } from "../actions"

const text = (value: string | null) => (value ?? "").replace(/\u200B/g, "").trim()

// Regression test for Issue #12453: the synchronous POST /message endpoint holds
// the connection open while the agent works, causing "Failed to fetch" over
// VPN/Tailscale. The fix switches to POST /prompt_async which returns immediately.
test("prompt succeeds when sync message endpoint is unreachable", async ({ page, project, assistant }) => {
  test.setTimeout(120_000)

  // Simulate Tailscale/VPN killing the long-lived sync connection
  await page.route("**/session/*/message", (route) => route.abort("connectionfailed"))

  const token = `E2E_ASYNC_${Date.now()}`
  await project.open()
  await assistant.reply(token)
  const sessionID = await project.prompt(`Reply with exactly: ${token}`)

  await expect.poll(() => assistant.calls()).toBeGreaterThanOrEqual(1)
  await expect.poll(() => assistantText(project.sdk, sessionID), { timeout: 90_000 }).toContain(token)
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
