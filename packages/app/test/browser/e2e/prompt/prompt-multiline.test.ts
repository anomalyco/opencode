import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitUrlMatches } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("prompt multiline (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("shift+enter inserts a newline without submitting", async () => {
    await app.gotoSession()

    await waitUrlMatches(app.driver, /\/session\/?$/)

    const prompt = await app.driver.findElement(By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("line one")
    await app.driver.actions().keyDown(Key.SHIFT).sendKeys(Key.ENTER).keyUp(Key.SHIFT).perform()
    await prompt.sendKeys("line two")

    await waitUrlMatches(app.driver, /\/session\/?$/)
    const body = await prompt.getText()
    expect(body).toContain("line one")
    expect(body).toContain("line two")
  })
})
