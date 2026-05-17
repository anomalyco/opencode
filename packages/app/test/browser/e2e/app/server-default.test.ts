import { describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import { serverNamePattern, serverUrls } from "../../../../e2e/utils"
import { dropdownMenuContentSelector } from "../../../../e2e/selectors"
import {
  wdClickMenuItem,
  wdCloseDialog,
  wdEnsureServerManagePopover,
} from "../../support/wd-actions"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

describe("default server (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("can set a default server on web", async () => {
    await app.driver.executeScript((k: string) => {
      try {
        localStorage.removeItem(k)
      } catch {
        return
      }
    }, DEFAULT_SERVER_URL_KEY)

    await app.gotoSession()

    const pop = await wdEnsureServerManagePopover(app.driver)
    await pop.findElement(By.xpath(`.//button[contains(., "Manage servers")]`)).click()

    const dialog = await waitVisible(app.driver, By.css('[role="dialog"]'))
    expect(await dialog.getText()).toMatch(serverNamePattern)

    const trigger = await dialog.findElement(By.css('[data-slot="dropdown-menu-trigger"]'))
    await app.driver.executeScript("arguments[0].click()", trigger)

    const menu = await waitVisible(app.driver, By.css(dropdownMenuContentSelector))
    await wdClickMenuItem(menu, /set as default/i)

    await app.driver.wait(async () => {
      const v = await app.driver.executeScript<string | null>(
        (k: string) => localStorage.getItem(k),
        DEFAULT_SERVER_URL_KEY,
      )
      if (!v) return false
      return serverUrls.includes(v)
    }, 20_000)

    await waitVisible(app.driver, By.xpath(`//*[@role="dialog"]//*[normalize-space(.)='Default']`))

    await wdCloseDialog(app.driver)

    const pop2 = await wdEnsureServerManagePopover(app.driver)
    let rowText = ""
    for (const b of await pop2.findElements(By.css("button"))) {
      const t = await b.getText()
      if (serverNamePattern.test(t)) {
        rowText = t
        break
      }
    }
    expect(rowText).toMatch(serverNamePattern)
    expect(rowText).toContain("Default")
  })
})
