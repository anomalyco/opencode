import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

test("context panel can be opened from the prompt", async ({ page, sdk, gotoSession }) => {
  const title = `e2e smoke context ${Date.now()}`

  await withSession(sdk, title, async (session) => {
    await sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [
        {
          type: "text",
          text: "seed context",
        },
      ],
    })

    await expect
      .poll(async () => {
        const messages = await sdk.session.messages({ sessionID: session.id, limit: 1 }).then((r) => r.data ?? [])
        return messages.length
      })
      .toBeGreaterThan(0)

    await gotoSession(session.id)

    const contextButton = page
      .locator('[data-component="button"]')
      .filter({ has: page.locator('[data-component="progress-circle"]').first() })
      .first()

    await expect(contextButton).toBeVisible()
    await contextButton.click()

    const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
    await expect(tabs.getByRole("tab", { name: "Context" })).toBeVisible()
  })
})
