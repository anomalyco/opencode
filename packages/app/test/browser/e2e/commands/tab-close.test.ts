import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitAbsent, waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"
import { wdPressModW } from "../../support/wd-actions"

describe("tab close (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("mod+w closes the active file tab", async () => {
    await app.gotoSession()

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("/open")
    await waitVisible(app.driver, By.css('[data-slash-id="file.open"]'))
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

    const item = await waitVisible(
      app.driver,
      By.css('[data-slot="list-item"][data-key^="file:"]'),
      30_000,
    )
    await item.click()
    await waitAbsent(app.driver, By.css('[role="dialog"]'), 10_000)

    const tab = await waitVisible(app.driver, By.xpath(`(//div[@role="tab"][contains(., "package.json")])[1]`))
    await tab.click()
    expect(await tab.getAttribute("aria-selected")).toBe("true")

    await wdPressModW(app.driver)
    expect((await app.driver.findElements(By.xpath(`//div[@role="tab"][contains(., "package.json")]`))).length).toBe(0)
  })
})
