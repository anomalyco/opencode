import { describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import { serverNamePattern, serverNames } from "../../../../e2e/utils"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("home (webdriver migration)", () => {
  const app = useAppWebDriver()
  const serverLabel = serverNames[0]

  test("home renders and shows core entrypoints", async () => {
    await app.driver.get(`${app.origin}/`)
    await waitVisible(app.driver, By.xpath("//button[contains(., 'Open project')]"))
    await waitVisible(app.driver, By.xpath(`//button[contains(., "${serverLabel}")]`))
  })

  test("server picker dialog opens from home", async () => {
    await app.driver.get(`${app.origin}/`)
    const trigger = await waitVisible(app.driver, By.xpath(`//button[contains(., "${serverLabel}")]`))
    await trigger.click()
    await waitVisible(app.driver, By.css('[role="dialog"]'))
    await waitVisible(app.driver, By.css('[role="dialog"] [role="textbox"], [role="dialog"] textarea'))
    const dialog = await app.driver.findElement(By.css('[role="dialog"]'))
    expect(await dialog.getText()).toMatch(serverNamePattern)
  })
})
