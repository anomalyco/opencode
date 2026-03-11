import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

test("can open an existing session and type into the prompt", async ({ page, sdk, gotoSession }) => {
  const title = `e2e smoke ${Date.now()}`

  await withSession(sdk, title, async (session) => {
    await gotoSession(session.id)

    const prompt = page.locator(promptSelector)
    await prompt.click()
    await page.keyboard.type("hello from e2e")
    await expect(prompt).toContainText("hello from e2e")
  })
})
