import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

type Sdk = Parameters<typeof withSession>[0]

const shareDisabled = process.env.OPENCODE_DISABLE_SHARE === "true" || process.env.OPENCODE_DISABLE_SHARE === "1"

async function seed(driver: WebDriver, sdk: Sdk, sessionID: string) {
  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    parts: [{ type: "text", text: "e2e share seed" }],
  })
  await driver.wait(async () => {
    const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
    return messages.length > 0
  }, 30_000)
}

describe("prompt slash share (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("/share and /unshare update session share state", async () => {
    if (shareDisabled) return

    await withSession(app.sdk, `e2e slash share ${Date.now()}`, async (session) => {
      await seed(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)

      const prompt = await waitVisible(app.driver, By.css(promptSelector))
      await prompt.click()
      await prompt.sendKeys("/share")
      await waitVisible(app.driver, By.css('[data-slash-id="session.share"]'))
      await app.driver.actions().sendKeys(Key.ENTER).perform()

      await app.driver.wait(async () => {
        const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        const u = data?.share?.url
        return u !== undefined && u !== ""
      }, 30_000)

      await prompt.click()
      await prompt.sendKeys("/unshare")
      await waitVisible(app.driver, By.css('[data-slash-id="session.unshare"]'))
      await app.driver.actions().sendKeys(Key.ENTER).perform()

      await app.driver.wait(async () => {
        const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        const u = data?.share?.url
        return u === undefined || u === ""
      }, 30_000)
    })
  })
})
