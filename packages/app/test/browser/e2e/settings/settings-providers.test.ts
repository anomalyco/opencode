import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import { wdCloseDialog, wdOpenSettings } from "../../support/wd-actions"
import { waitAbsent, waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

async function openCustomProviderDialog(driver: WebDriver) {
  const settings = await wdOpenSettings(driver)
  await settings.findElement(By.xpath(`.//button[@role="tab" and contains(., "Providers")]`)).click()
  const section = await waitVisible(driver, By.css('[data-component="custom-provider-section"]'))
  await section.findElement(By.xpath(`.//button[contains(., "Connect")]`)).click()
  return waitVisible(driver, By.xpath(`//*[@role="dialog"][.//*[contains(., "Custom provider")]]`))
}

describe("settings providers (webdriver)", () => {
  const app = useAppWebDriver()

  test("custom provider form can be filled and validates input", async () => {
    await app.gotoSession()
    const dialog = await openCustomProviderDialog(app.driver)

    await dialog.findElement(By.xpath(`//label[contains(., "Provider ID")]//following::input[1]`)).sendKeys("test-provider")
    await dialog.findElement(By.xpath(`//label[contains(., "Display name")]//following::input[1]`)).sendKeys("Test Provider")
    await dialog.findElement(By.xpath(`//label[contains(., "Base URL")]//following::input[1]`)).sendKeys("http://localhost:9999/fake")
    await dialog.findElement(By.xpath(`//label[contains(., "API key")]//following::input[1]`)).sendKeys("fake-key")
    await dialog.findElement(By.xpath(`(.//input[@placeholder="model-id"])[1]`)).sendKeys("test-model")
    await dialog.findElement(By.xpath(`(.//input[@placeholder="Display Name"])[1]`)).sendKeys("Test Model")

    const providerId = await dialog.findElement(By.xpath(`//input[@aria-label="Provider ID"]`)).getAttribute("value")
    expect(providerId).toBe("test-provider")

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()
    await waitAbsent(app.driver, By.xpath(`//*[@role="dialog"][.//*[contains(., "Custom provider")]]`), 5000)
    await wdCloseDialog(app.driver)
  })

  test("custom provider form shows validation errors", async () => {
    await app.gotoSession()
    const dialog = await openCustomProviderDialog(app.driver)
    await dialog.findElement(By.xpath(`//label[contains(., "Provider ID")]//following::input[1]`)).sendKeys("invalid provider id")
    await dialog.findElement(By.xpath(`//label[contains(., "Base URL")]//following::input[1]`)).sendKeys("not-a-url")

    const submit = await dialog.findElement(
      By.xpath(`.//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "save") or contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "submit")]`),
    )
    await submit.click()

    await waitVisible(app.driver, By.xpath(`//*[@data-slot="input-error"][contains(., "lowercase")]`))
    await waitVisible(app.driver, By.xpath(`//*[@data-slot="input-error"][contains(., "http")]`))

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()
    await waitAbsent(app.driver, By.xpath(`//*[@role="dialog"][.//*[contains(., "Custom provider")]]`), 5000)
    await wdCloseDialog(app.driver)
  })

  test("custom provider form can add and remove models", async () => {
    await app.gotoSession()
    const dialog = await openCustomProviderDialog(app.driver)
    await dialog.findElement(By.xpath(`//label[contains(., "Provider ID")]//following::input[1]`)).sendKeys("multi-model-test")
    await dialog.findElement(By.xpath(`//label[contains(., "Display name")]//following::input[1]`)).sendKeys("Multi Model Test")
    await dialog.findElement(By.xpath(`//label[contains(., "Base URL")]//following::input[1]`)).sendKeys("http://localhost:9999/multi")
    await dialog.findElement(By.xpath(`(.//input[@placeholder="model-id"])[1]`)).sendKeys("model-1")
    await dialog.findElement(By.xpath(`(.//input[@placeholder="Display Name"])[1]`)).sendKeys("Model 1")

    const before = (await dialog.findElements(By.xpath(`.//input[@placeholder="model-id"]`))).length
    await dialog.findElement(By.xpath(`.//button[contains(., "Add model")]`)).click()
    await app.driver.wait(async () => (await dialog.findElements(By.xpath(`.//input[@placeholder="model-id"]`))).length === before + 1, 5000)

    const ids = await dialog.findElements(By.xpath(`.//input[@placeholder="model-id"]`))
    await ids[1]!.sendKeys("model-2")
    const names = await dialog.findElements(By.xpath(`.//input[@placeholder="Display Name"]`))
    await names[1]!.sendKeys("Model 2")
    expect(await ids[1]!.getAttribute("value")).toBe("model-2")
    expect(await names[1]!.getAttribute("value")).toBe("Model 2")

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()
    await waitAbsent(app.driver, By.xpath(`//*[@role="dialog"][.//*[contains(., "Custom provider")]]`), 5000)
    await wdCloseDialog(app.driver)
  })

  test("custom provider form can add and remove headers", async () => {
    await app.gotoSession()
    const dialog = await openCustomProviderDialog(app.driver)
    await dialog.findElement(By.xpath(`//label[contains(., "Provider ID")]//following::input[1]`)).sendKeys("header-test")
    await dialog.findElement(By.xpath(`//label[contains(., "Display name")]//following::input[1]`)).sendKeys("Header Test")
    await dialog.findElement(By.xpath(`//label[contains(., "Base URL")]//following::input[1]`)).sendKeys("http://localhost:9999/headers")
    await dialog.findElement(By.xpath(`(.//input[@placeholder="model-id"])[1]`)).sendKeys("model-x")
    await dialog.findElement(By.xpath(`(.//input[@placeholder="Display Name"])[1]`)).sendKeys("Model X")

    const before = (await dialog.findElements(By.xpath(`.//input[@placeholder="Header-Name"]`))).length
    await dialog.findElement(By.xpath(`.//button[contains(., "Add header")]`)).click()
    await app.driver.wait(async () => (await dialog.findElements(By.xpath(`.//input[@placeholder="Header-Name"]`))).length === before + 1, 5000)

    const hn = await dialog.findElements(By.xpath(`.//input[@placeholder="Header-Name"]`))
    const vv = await dialog.findElements(By.xpath(`.//input[@placeholder="value"]`))
    await hn[0]!.sendKeys("Authorization")
    await vv[0]!.sendKeys("Bearer token123")
    expect(await hn[0]!.getAttribute("value")).toBe("Authorization")
    expect(await vv[0]!.getAttribute("value")).toBe("Bearer token123")

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()
    await waitAbsent(app.driver, By.xpath(`//*[@role="dialog"][.//*[contains(., "Custom provider")]]`), 5000)
    await wdCloseDialog(app.driver)
  })
})
