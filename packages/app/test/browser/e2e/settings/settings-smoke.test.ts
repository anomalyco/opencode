import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { wdChordModF, wdCloseDialog, wdOpenSettings } from "../../support/wd-actions"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("settings smoke (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("smoke settings dialog opens, switches tabs, closes", async () => {
    await app.gotoSession()

    const dialog = await wdOpenSettings(app.driver)
    await dialog.findElement(By.xpath(`.//button[@role="tab" and contains(., "Shortcuts")]`)).click()

    await waitVisible(app.driver, By.xpath(`//*[@role="dialog"]//button[contains(., "Reset to defaults")]`))
    await waitVisible(
      app.driver,
      By.xpath(
        `//*[@role="dialog"]//*[self::input or self::textarea][contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search shortcuts")]`,
      ),
    )

    await wdCloseDialog(app.driver)
    expect((await app.driver.findElements(By.css('[role="dialog"]'))).length).toBe(0)
  })
})
