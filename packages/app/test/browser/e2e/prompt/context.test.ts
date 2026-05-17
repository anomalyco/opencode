import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { waitAbsent, waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

type Sdk = Parameters<typeof withSession>[0]

async function seedContextSession(driver: WebDriver, sdk: Sdk, sessionID: string) {
  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    parts: [{ type: "text", text: "seed context" }],
  })
  await driver.wait(async () => {
    const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
    return messages.length > 0
  }, 30_000)
}

describe("context panel (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("context panel can be opened from the prompt", async () => {
    const title = `e2e smoke context ${Date.now()}`

    await withSession(app.sdk, title, async (session) => {
      await seedContextSession(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)

      const trigger = await waitVisible(
        app.driver,
        By.xpath(`(//*[@data-component="button"][.//*[@data-component="progress-circle"]])[1]`),
      )
      await trigger.click()

      await waitVisible(app.driver, By.xpath(`//*[@data-component="tabs"][@data-variant="normal"]//*[@role="tab" and contains(., "Context")]`))
    })
  })

  test("context panel can be closed from the context tab close action", async () => {
    await withSession(app.sdk, `e2e context toggle ${Date.now()}`, async (session) => {
      await seedContextSession(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)

      await app.driver.findElement(By.css(promptSelector)).click()

      const trigger = await waitVisible(
        app.driver,
        By.xpath(`(//*[@data-component="button"][.//*[@data-component="progress-circle"]])[1]`),
      )
      await trigger.click()

      const context = await waitVisible(
        app.driver,
        By.xpath(`//*[@data-component="tabs"][@data-variant="normal"]//*[@role="tab" and contains(., "Context")]`),
      )
      expect(await context.isDisplayed()).toBe(true)

      const close = await app.driver.findElement(By.xpath(`(//button[contains(., "Close tab")])[1]`))
      await close.click()

      await app.driver.wait(async () => {
        const xs = await app.driver.findElements(
          By.xpath(`//*[@data-component="tabs"][@data-variant="normal"]//*[@role="tab" and contains(., "Context")]`),
        )
        return xs.length === 0
      }, 5000)
    })
  })

  test("context panel can open file picker from context actions", async () => {
    await withSession(app.sdk, `e2e context tabs ${Date.now()}`, async (session) => {
      await seedContextSession(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)

      await app.driver.findElement(By.css(promptSelector)).click()

      const trigger = await waitVisible(
        app.driver,
        By.xpath(`(//*[@data-component="button"][.//*[@data-component="progress-circle"]])[1]`),
      )
      await trigger.click()

      await waitVisible(app.driver, By.xpath(`//*[@role="tab" and contains(., "Context")]`))
      const openFile = await app.driver.findElement(By.xpath(`(//button[contains(., "Open file")])[1]`))
      await openFile.click()

      await waitVisible(
        app.driver,
        By.xpath(`//*[@role="dialog"][.//input[contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search file")]]`),
      )

      await app.driver.actions().sendKeys(Key.ESCAPE).perform()
      await waitAbsent(
        app.driver,
        By.xpath(`//*[@role="dialog"][.//input[contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search file")]]`),
        10_000,
      )
    })
  })
})
