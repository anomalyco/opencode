import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

describe("session prompt", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("can open an existing session and type into the prompt", async () => {
    const title = `e2e smoke ${Date.now()}`
    await withSession(app.sdk, title, async (session) => {
      await app.gotoSession(session.id)

      const prompt = app.page.locator(promptSelector)
      await prompt.click()
      await app.page.keyboard.type("hello from e2e")
      await expect
        .poll(async () => (await prompt.textContent()) ?? "", { timeout: 15_000 })
        .toContain("hello from e2e")
    })
  })
})
