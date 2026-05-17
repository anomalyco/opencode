import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { wdChordModF } from "../../support/wd-actions"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

async function openPackagesAppPackageJson(driver: WebDriver) {
  const prompt = await waitVisible(driver, By.css(promptSelector))
  await prompt.click()
  await prompt.sendKeys("/open")

  await waitVisible(driver, By.css('[data-slash-id="file.open"]'))
  await driver.actions().sendKeys(Key.ENTER).perform()

  const dialog = await waitVisible(
    driver,
    By.xpath(`//*[@role="dialog"][.//*[contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search file")]]`),
  )
  const search = await dialog.findElement(
    By.xpath(`.//*[self::input or self::textarea][contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search file")]`),
  )
  await search.clear()
  await search.sendKeys("package.json")

  await driver.wait(
    async () => {
      for (const el of await driver.findElements(By.css('[data-slot="list-item"][data-key^="file:"]'))) {
        const k = await el.getAttribute("data-key")
        if (!k) continue
        const rel = k.replace(/^file:/, "")
        if (/packages[\\/]+app[\\/]+package\.json$/i.test(rel)) {
          await el.click()
          return true
        }
      }
      return false
    },
    30_000,
  )

  await driver.wait(async () => (await driver.findElements(By.css('[role="dialog"]'))).length === 0, 10_000)

  const tabs = await driver.findElements(By.xpath(`//button[@role="tab" and normalize-space(.)="package.json"]`))
  if (tabs.length === 0) throw new Error("expected package.json tab")
  const tab = tabs[0]!
  await tab.click()
}

describe("file viewer (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("smoke file viewer renders real file content", async () => {
    await app.gotoSession()
    await openPackagesAppPackageJson(app.driver)

    const viewer = await waitVisible(app.driver, By.css('[data-component="file"][data-mode="text"]'))
    expect(await viewer.getText()).toMatch(/"name"\s*:\s*"@opencode-ai\/app"/)
  })

  test("cmd+f opens text viewer search while prompt is focused", async () => {
    await app.gotoSession()
    await openPackagesAppPackageJson(app.driver)

    await waitVisible(app.driver, By.css('[data-component="file"][data-mode="text"]'))

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await wdChordModF(app.driver)

    await waitVisible(app.driver, By.xpath(`//*[@placeholder="Find"]`))
    const active = await app.driver.switchTo().activeElement()
    expect(await active.getAttribute("placeholder")).toBe("Find")
  })

  test("cmd+f opens text viewer search while prompt is not focused", async () => {
    await app.gotoSession()
    await openPackagesAppPackageJson(app.driver)

    const viewer = await waitVisible(app.driver, By.css('[data-component="file"][data-mode="text"]'))
    await viewer.click()
    await wdChordModF(app.driver)

    await waitVisible(app.driver, By.xpath(`//*[@placeholder="Find"]`))
    const active = await app.driver.switchTo().activeElement()
    expect(await active.getAttribute("placeholder")).toBe("Find")
  })
})
