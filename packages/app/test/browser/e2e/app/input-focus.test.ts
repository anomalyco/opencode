import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("input focus (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("ctrl+l focuses the prompt", async () => {
    await app.gotoSession()
    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await app.driver.findElement(By.css("main")).click()
    expect(
      await app.driver.executeScript<boolean>("return arguments[0] === document.activeElement", prompt),
    ).toBe(false)

    await app.driver.actions().keyDown(Key.CONTROL).sendKeys("l").keyUp(Key.CONTROL).perform()

    expect(
      await app.driver.executeScript<boolean>("return arguments[0] === document.activeElement", prompt),
    ).toBe(true)
  })
})
