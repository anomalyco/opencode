import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"
import { wdCloseDialog, wdOpenSettings, wdPressEscape } from "../../support/wd-actions"

describe("models visibility (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("hiding a model removes it from the model picker", async () => {
    await app.gotoSession()

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("/model")

    const command = await waitVisible(app.driver, By.css('[data-slash-id="model.choose"]'))
    await app.driver.actions().move({ origin: command }).perform()
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const picker = await waitVisible(app.driver, By.css('[role="dialog"]'))
    const target = await picker.findElement(By.css('[data-slot="list-item"]'))
    const key = await target.getAttribute("data-key")
    if (!key) throw new Error("data-key missing")

    const spans = await target.findElements(By.css("span"))
    let name = ""
    if (spans.length > 0) name = (await spans[0].getText()).trim()
    if (!name) {
      const raw = (await target.getText()).trim().split("\n")[0]
      if (raw) name = raw.trim()
    }
    if (!name) throw new Error("model name missing")

    await wdPressEscape(app.driver)
    await app.driver.wait(async () => (await app.driver.findElements(By.css('[role="dialog"]'))).length === 0, 5000)

    const settings = await wdOpenSettings(app.driver)
    await settings.findElement(By.xpath(`.//*[@role="tab" and contains(., "Models")]`)).click()

    const search = await waitVisible(app.driver, By.css('input[placeholder="Search models"]'))
    await search.clear()
    await search.sendKeys(name)

    const switches = await settings.findElements(By.css('[data-component="switch"]'))
    let hit: (typeof switches)[0] | undefined
    for (const sw of switches) {
      if ((await sw.getText()).includes(name)) {
        hit = sw
        break
      }
    }
    if (!hit) throw new Error("switch not found")
    const toggleInput = await hit.findElement(By.css('[data-slot="switch-input"]'))
    expect(await toggleInput.getAttribute("aria-checked")).toBe("true")
    await hit.findElement(By.css('[data-slot="switch-control"]')).click()
    expect(await toggleInput.getAttribute("aria-checked")).toBe("false")

    await wdCloseDialog(app.driver)

    await prompt.click()
    await prompt.sendKeys("/model")
    const command2 = await waitVisible(app.driver, By.css('[data-slash-id="model.choose"]'))
    await app.driver.actions().move({ origin: command2 }).perform()
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const pickerAgain = await waitVisible(app.driver, By.css('[role="dialog"]'))
    await waitVisible(app.driver, By.css('[data-slot="list-item"]'))
    let count = 0
    for (const el of await pickerAgain.findElements(By.css('[data-slot="list-item"]'))) {
      if ((await el.getAttribute("data-key")) === key) count += 1
    }
    expect(count).toBe(0)

    await wdPressEscape(app.driver)
  })

  test("showing a hidden model restores it to the model picker", async () => {
    await app.gotoSession()

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("/model")

    const command = await waitVisible(app.driver, By.css('[data-slash-id="model.choose"]'))
    await app.driver.actions().move({ origin: command }).perform()
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const picker = await waitVisible(app.driver, By.css('[role="dialog"]'))
    const target = await picker.findElement(By.css('[data-slot="list-item"]'))
    const key = await target.getAttribute("data-key")
    if (!key) throw new Error("data-key missing")

    const spans = await target.findElements(By.css("span"))
    let name = ""
    if (spans.length > 0) name = (await spans[0].getText()).trim()
    if (!name) {
      const raw = (await target.getText()).trim().split("\n")[0]
      if (raw) name = raw.trim()
    }
    if (!name) throw new Error("model name missing")

    await wdPressEscape(app.driver)
    await app.driver.wait(async () => (await app.driver.findElements(By.css('[role="dialog"]'))).length === 0, 5000)

    const settings = await wdOpenSettings(app.driver)
    await settings.findElement(By.xpath(`.//*[@role="tab" and contains(., "Models")]`)).click()

    const search = await waitVisible(app.driver, By.css('input[placeholder="Search models"]'))
    await search.clear()
    await search.sendKeys(name)

    const switches = await settings.findElements(By.css('[data-component="switch"]'))
    let hit: (typeof switches)[0] | undefined
    for (const sw of switches) {
      if ((await sw.getText()).includes(name)) {
        hit = sw
        break
      }
    }
    if (!hit) throw new Error("switch not found")
    const toggleInput = await hit.findElement(By.css('[data-slot="switch-input"]'))
    expect(await toggleInput.getAttribute("aria-checked")).toBe("true")

    await hit.findElement(By.css('[data-slot="switch-control"]')).click()
    expect(await toggleInput.getAttribute("aria-checked")).toBe("false")

    await hit.findElement(By.css('[data-slot="switch-control"]')).click()
    expect(await toggleInput.getAttribute("aria-checked")).toBe("true")

    await wdCloseDialog(app.driver)

    await prompt.click()
    await prompt.sendKeys("/model")
    const command2 = await waitVisible(app.driver, By.css('[data-slash-id="model.choose"]'))
    await app.driver.actions().move({ origin: command2 }).perform()
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    const pickerAgain = await waitVisible(app.driver, By.css('[role="dialog"]'))
    await waitVisible(app.driver, By.css('[data-slot="list-item"]'))
    let found = false
    for (const el of await pickerAgain.findElements(By.css('[data-slot="list-item"]'))) {
      if ((await el.getAttribute("data-key")) === key) {
        found = true
        break
      }
    }
    expect(found).toBe(true)

    await wdPressEscape(app.driver)
  })
})
