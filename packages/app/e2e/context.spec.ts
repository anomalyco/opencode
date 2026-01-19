import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test("context panel can be opened from the prompt", async ({ page, sdk, gotoSession }) => {
  const title = `e2e smoke context ${Date.now()}`
  const created = await sdk.session.create({ title }).then((r) => r.data)

  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  try {
    await sdk.session.promptAsync({
      sessionID,
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
        const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
        return messages.length
      })
      .toBeGreaterThan(0)

    await gotoSession(sessionID)

    const contextButton = page
      .locator('[data-component="button"]')
      .filter({ has: page.locator('[data-component="progress-circle"]').first() })
      .first()

    await expect(contextButton).toBeVisible()
    await contextButton.click()

    const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
    await expect(tabs.getByRole("tab", { name: "Context" })).toBeVisible()
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})
