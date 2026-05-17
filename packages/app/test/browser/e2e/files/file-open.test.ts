import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("file open (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("can open a file tab from the search palette", async () => {
    await app.gotoSession()

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("/open")

    const command = await waitVisible(app.driver, By.css('[data-slash-id="file.open"]'))
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const dialog = await waitVisible(
      app.driver,
      By.xpath(`//*[@role="dialog"][.//input[contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search file")]]`),
    )
    const search = await dialog.findElement(
      By.xpath(`.//input[contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search file")]`),
    )
    await search.clear()
    await search.sendKeys("package.json")

    const item = await waitVisible(app.driver, By.css('[data-slot="list-item"][data-key^="file:"]'), 30_000)
    await item.click()

    await app.driver.wait(async () => (await app.driver.findElements(By.css('[role="dialog"]'))).length === 0, 10_000)

    await waitVisible(app.driver, By.css('[data-component="tabs"][data-variant="normal"] [data-slot="tabs-trigger"]'))
  })
})
