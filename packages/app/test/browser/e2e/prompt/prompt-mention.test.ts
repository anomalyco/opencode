import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("prompt mention (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("smoke @mention inserts file pill token", async () => {
    await app.gotoSession()

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    const sep = process.platform === "win32" ? "\\" : "/"
    const file = ["packages", "app", "package.json"].join(sep)
    const pathRe = /packages[\\/]+app[\\/]+package\.json/

    await prompt.sendKeys(`@${file}`)

    const suggestion = await waitVisible(
      app.driver,
      By.xpath(
        `//button[.//span[contains(., "packages")]][.//span[contains(., "package.json")]]`,
      ),
      30_000,
    )
    await app.driver.actions().move({ origin: suggestion }).pause(50).perform()
    await app.driver.actions().sendKeys(Key.TAB).perform()

    const pill = await waitVisible(app.driver, By.css(`${promptSelector} [data-type="file"]`))
    expect(await pill.getAttribute("data-path")).toMatch(pathRe)

    await prompt.sendKeys(" ok")
    expect(await prompt.getText()).toContain("ok")
  })
})
