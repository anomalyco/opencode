import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"
import { wdClickListItemByKey } from "../../support/wd-actions"

describe("model picker (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("smoke model selection updates prompt footer", async () => {
    await app.gotoSession()

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("/model")

    const command = await waitVisible(app.driver, By.css('[data-slash-id="model.choose"]'))
    await app.driver.actions().move({ origin: command }).perform()
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const dialog = await waitVisible(app.driver, By.css('[role="dialog"]'))
    const inputs = await dialog.findElements(By.xpath(`.//*[@role="textbox"] | .//input[@type="text"]`))
    const input = inputs[0]
    if (!input) throw new Error("dialog input missing")

    const items = await dialog.findElements(By.css('[data-slot="list-item"]'))
    let target = items[0]
    for (const el of items) {
      if ((await el.getAttribute("data-selected")) !== "true") {
        target = el
        break
      }
    }
    if (!target) throw new Error("no list item")

    const key = await target.getAttribute("data-key")
    if (!key) throw new Error("data-key missing")

    const model = key.split(":").slice(1).join(":")
    await input.clear()
    await input.sendKeys(model)

    await wdClickListItemByKey(dialog, key)

    await app.driver.wait(async () => (await app.driver.findElements(By.css('[role="dialog"]'))).length === 0, 10_000)

    await prompt.click()
    await prompt.sendKeys("/model")
    const command2 = await waitVisible(app.driver, By.css('[data-slash-id="model.choose"]'))
    await app.driver.actions().move({ origin: command2 }).perform()
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const again = await waitVisible(app.driver, By.css('[role="dialog"]'))
    let selected = false
    for (const el of await again.findElements(By.css('[data-slot="list-item"]'))) {
      if ((await el.getAttribute("data-key")) === key && (await el.getAttribute("data-selected")) === "true") {
        selected = true
        break
      }
    }
    expect(selected).toBe(true)
  })
})
