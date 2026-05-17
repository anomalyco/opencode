import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitAbsent, waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("prompt slash open (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("smoke /open opens file picker dialog", async () => {
    await app.gotoSession()

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("/open")

    const command = await waitVisible(app.driver, By.css('[data-slash-id="file.open"]'))
    await app.driver.actions().move({ origin: command }).perform()
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const dialog = await waitVisible(app.driver, By.css('[role="dialog"]'))
    await waitVisible(app.driver, By.css('[role="dialog"] [role="textbox"], [role="dialog"] input'))

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()
    await waitAbsent(app.driver, By.css('[role="dialog"]'), 10_000)
  })
})
