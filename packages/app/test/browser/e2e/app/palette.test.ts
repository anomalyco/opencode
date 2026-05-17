import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { wdOpenPalette, wdPressEscape } from "../../support/wd-actions"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("palette (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("search palette opens and closes", async () => {
    await app.gotoSession()
    await wdOpenPalette(app.driver)
    await wdPressEscape(app.driver)
    await app.driver.wait(async () => (await app.driver.findElements(By.css('[role="dialog"]'))).length === 0, 10_000)
  })
})
