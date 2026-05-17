import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { serverNamePattern, serverNames } from "../../../../e2e/utils"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("home (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("home renders and shows core entrypoints", async () => {
    const label = serverNames()[0]
    await app.driver.get(`${app.origin}/`)
    await waitVisible(app.driver, By.xpath("//button[contains(., 'Open project')]"))
    await waitVisible(app.driver, By.xpath(`//button[contains(., "${label}")]`))
  })

  test("server picker dialog opens from home", async () => {
    const label = serverNames()[0]
    await app.driver.get(`${app.origin}/`)
    const trigger = await waitVisible(app.driver, By.xpath(`//button[contains(., "${label}")]`))
    await trigger.click()
    await waitVisible(app.driver, By.css('[role="dialog"]'))
    await waitVisible(app.driver, By.css('[role="dialog"] [role="textbox"], [role="dialog"] textarea'))
    const dialog = await app.driver.findElement(By.css('[role="dialog"]'))
    expect(await dialog.getText()).toMatch(serverNamePattern())
  })
})
