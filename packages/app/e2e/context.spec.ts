import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test("context panel can be opened from the prompt", async ({ page, sdk, gotoSession }) => {
  const title = `e2e smoke context ${Date.now()}`
  const created = await sdk.session.create({ title }).then((r) => r.data)

  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  try {
    await gotoSession(sessionID)

    const promptForm = page.locator("form").filter({ has: page.locator(promptSelector) }).first()
    const contextButton = promptForm
      .locator("button")
      .filter({ has: promptForm.locator('[data-component="progress-circle"]').first() })
      .first()

    await expect(contextButton).toBeVisible()
    await contextButton.click()

    const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
    await expect(tabs.getByRole("tab", { name: "Context" })).toBeVisible()
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})
