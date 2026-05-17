import { describe, expect, test } from "vitest"
import { By, logging } from "selenium-webdriver"
import { useAppWebDriver } from "../../support/use-app-webdriver"
import { waitVisible } from "../../support/wd-wait"

describe("home bootstrap (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("home load emits no severe browser logs", async () => {
    const severe: string[] = []
    const end = Date.now() + 8_000
    await app.driver.get(`${app.origin}/`)
    await waitVisible(app.driver, By.xpath("//button[contains(., 'Open project')]"))
    while (Date.now() < end) {
      let batch: { level: { name: string }; message: string }[] = []
      try {
        batch = await app.driver.manage().logs().get(logging.Type.BROWSER)
      } catch {
        expect.fail("Browser log capture unsupported on this WebDriver session (enable chrome logging prefs).")
      }
      for (const e of batch) {
        if (e.level.name === "SEVERE") severe.push(e.message)
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(severe).toEqual([])
  })
})
