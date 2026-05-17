import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"
import { withSession } from "../../../../e2e/actions"

describe("session prompt (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("can open an existing session and type into the prompt", async () => {
    const title = `e2e wd smoke ${Date.now()}`
    await withSession(app.sdk, title, async (session) => {
      await app.gotoSession(session.id)
      const prompt = await waitVisible(app.driver, By.css('[data-component="prompt-input"]'))
      await prompt.click()
      await prompt.sendKeys("hello from e2e wd")
      const body = await app.driver.executeScript(`
        const el = document.querySelector('[data-component="prompt-input"]')
        return el ? el.innerText : ""
      `)
      expect(body).toContain("hello from e2e wd")
    })
  })
})
