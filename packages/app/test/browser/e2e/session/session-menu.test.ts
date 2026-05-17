import { describe, expect, test } from "vitest"
import type { WebDriver } from "selenium-webdriver"
import { By, Key } from "selenium-webdriver"
import { withSession } from "../../../../e2e/actions"
import { inlineInputSelector, sessionItemSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"
import {
  wdClickMenuItem,
  wdConfirmDialog,
  wdOpenSessionMoreMenu,
  wdOpenSharePopover,
  wdOpenSidebar,
} from "../../support/wd-actions"

const shareDisabled = process.env.OPENCODE_DISABLE_SHARE === "true" || process.env.OPENCODE_DISABLE_SHARE === "1"

type Sdk = Parameters<typeof withSession>[0]

async function seedMessage(driver: WebDriver, sdk: Sdk, sessionID: string) {
  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    parts: [{ type: "text", text: "e2e seed" }],
  })
  await driver.wait(async () => {
    const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
    return messages.length > 0
  }, 30_000)
}

describe("session header menu (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("session can be renamed via header menu", async () => {
    const stamp = Date.now()
    const originalTitle = `e2e rename test ${stamp}`
    const renamedTitle = `e2e renamed ${stamp}`

    await withSession(app.sdk, originalTitle, async (session) => {
      await seedMessage(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)

      const h1 = await waitVisible(app.driver, By.css(".scroll-view__viewport h1"))
      expect(await h1.getText()).toBe(originalTitle)

      const menu = await wdOpenSessionMoreMenu(app.driver, session.id)
      await wdClickMenuItem(menu, /rename/i)

      const scroller = await waitVisible(app.driver, By.css(".scroll-view__viewport"))
      const input = await scroller.findElement(By.css(inlineInputSelector))
      await waitVisible(app.driver, By.css(inlineInputSelector))
      await input.clear()
      await input.sendKeys(renamedTitle)
      await input.sendKeys(Key.ENTER)

      await app.driver.wait(async () => {
        const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        return data?.title === renamedTitle
      }, 30_000)

      const h1b = await waitVisible(app.driver, By.css(".scroll-view__viewport h1"))
      expect(await h1b.getText()).toBe(renamedTitle)
    })
  })

  test("session can be archived via header menu", async () => {
    const stamp = Date.now()
    const title = `e2e archive test ${stamp}`

    await withSession(app.sdk, title, async (session) => {
      await seedMessage(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)
      const menu = await wdOpenSessionMoreMenu(app.driver, session.id)
      await wdClickMenuItem(menu, /archive/i)

      await app.driver.wait(async () => {
        const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        return data?.time?.archived !== undefined
      }, 30_000)

      await wdOpenSidebar(app.driver)
      expect((await app.driver.findElements(By.css(sessionItemSelector(session.id)))).length).toBe(0)
    })
  })

  test("session can be deleted via header menu", async () => {
    const stamp = Date.now()
    const title = `e2e delete test ${stamp}`

    await withSession(app.sdk, title, async (session) => {
      await seedMessage(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)
      const menu = await wdOpenSessionMoreMenu(app.driver, session.id)
      await wdClickMenuItem(menu, /delete/i)
      await wdConfirmDialog(app.driver, /delete/i)

      await app.driver.wait(async () => {
        const data = await app.sdk.session
          .get({ sessionID: session.id })
          .then((r) => r.data)
          .catch(() => undefined)
        return data?.id === undefined
      }, 30_000)

      await wdOpenSidebar(app.driver)
      expect((await app.driver.findElements(By.css(sessionItemSelector(session.id)))).length).toBe(0)
    })
  })

  test("session can be shared and unshared via header button", async () => {
    if (shareDisabled) return

    const stamp = Date.now()
    const title = `e2e share test ${stamp}`

    await withSession(app.sdk, title, async (session) => {
      await seedMessage(app.driver, app.sdk, session.id)
      await app.gotoSession(session.id)

      await wdOpenSharePopover(app.driver)
      const publish = await waitVisible(app.driver, By.xpath(`//*[@data-slot="popover-body"]//button[normalize-space(.)="Publish"]`), 30_000)
      await publish.click()
      await waitVisible(app.driver, By.xpath(`//*[@data-slot="popover-body"]//button[normalize-space(.)="Unpublish"]`), 30_000)

      await app.driver.wait(async () => {
        const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        return data?.share?.url !== undefined && data.share.url !== ""
      }, 30_000)

      const unpublish = await waitVisible(app.driver, By.xpath(`//*[@data-slot="popover-body"]//button[normalize-space(.)="Unpublish"]`), 30_000)
      await unpublish.click()
      await waitVisible(app.driver, By.xpath(`//*[@data-slot="popover-body"]//button[normalize-space(.)="Publish"]`), 30_000)

      await app.driver.wait(async () => {
        const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        const u = data?.share?.url
        return u === undefined || u === ""
      }, 30_000)

      const pop2 = await wdOpenSharePopover(app.driver)
      await waitVisible(app.driver, By.xpath(`//*[@data-slot="popover-body"]//button[normalize-space(.)="Publish"]`), 30_000)
      expect(await pop2.isDisplayed()).toBe(true)
    })
  })
})
