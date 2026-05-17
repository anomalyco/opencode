import { describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import { modelVariantCycleSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("thinking level / model variant (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("smoke model variant cycle updates label", async () => {
    await app.gotoSession()

    await app.driver.executeScript((sel: string) => {
      const s = document.createElement("style")
      s.textContent = `${sel} { display: inline-block !important; }`
      document.head.appendChild(s)
    }, modelVariantCycleSelector)

    const xs = await app.driver.findElements(By.css(modelVariantCycleSelector))
    if (xs.length === 0) return

    const button = await waitVisible(app.driver, By.css(modelVariantCycleSelector))
    const before = (await button.getText()).trim()
    await button.click()
    expect((await button.getText()).trim()).not.toBe(before)

    const mid = (await button.getText()).trim()
    await button.click()
    expect((await button.getText()).trim()).not.toBe(mid)
  })
})
