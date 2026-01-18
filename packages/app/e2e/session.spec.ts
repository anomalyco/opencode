import { test, expect } from "@playwright/test"
import { createSdk, getWorktree, promptSelector, sessionPath } from "./utils"

test("can open an existing session and type into the prompt", async ({ page }) => {
  const directory = await getWorktree()
  const sdk = createSdk(directory)
  const title = `e2e smoke ${Date.now()}`
  const created = await sdk.session.create({ title }).then((r) => r.data)

  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  try {
    await page.goto(sessionPath(directory, sessionID))

    const prompt = page.locator(promptSelector)
    await expect(prompt).toBeVisible()

    await prompt.click()
    await page.keyboard.type("hello from e2e")
    await expect(prompt).toContainText("hello from e2e")
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})
