import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { waitUrlMatches, waitVisible } from "../../support/wd-wait"
import { wdDefocus, wdOpenSidebar } from "../../support/wd-actions"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("titlebar history (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("titlebar back/forward navigates between sessions", async () => {
    await app.driver.manage().window().setRect({ width: 1400, height: 800, x: 0, y: 0 })
    const slug = app.project.id
    const stamp = Date.now()

    await withSession(app.sdk, `e2e titlebar history 1 ${stamp}`, async (one) => {
      await withSession(app.sdk, `e2e titlebar history 2 ${stamp}`, async (two) => {
        await app.gotoSession(one.id)
        await wdOpenSidebar(app.driver)

        const link = await waitVisible(app.driver, By.css(`[data-session-id="${two.id}"] a`))
        await link.click()

        await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await waitVisible(app.driver, By.css(promptSelector))

        const back = await waitVisible(app.driver, By.xpath(`//button[normalize-space(.)='Back']`))
        expect(await back.isEnabled()).toBe(true)
        await back.click()

        await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${one.id}(?:\\?|#|$)`))
        await waitVisible(app.driver, By.css(promptSelector))

        const forward = await waitVisible(app.driver, By.xpath(`//button[normalize-space(.)='Forward']`))
        expect(await forward.isEnabled()).toBe(true)
        await forward.click()

        await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await waitVisible(app.driver, By.css(promptSelector))
      })
    })
  })

  test("titlebar forward is cleared after branching history from sidebar", async () => {
    await app.driver.manage().window().setRect({ width: 1400, height: 800, x: 0, y: 0 })
    const slug = app.project.id
    const stamp = Date.now()

    await withSession(app.sdk, `e2e titlebar history a ${stamp}`, async (a) => {
      await withSession(app.sdk, `e2e titlebar history b ${stamp}`, async (b) => {
        await withSession(app.sdk, `e2e titlebar history c ${stamp}`, async (c) => {
          await app.gotoSession(a.id)
          await wdOpenSidebar(app.driver)

          const second = await waitVisible(app.driver, By.css(`[data-session-id="${b.id}"] a`))
          await second.click()
          await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${b.id}(?:\\?|#|$)`))
          await waitVisible(app.driver, By.css(promptSelector))

          const back = await waitVisible(app.driver, By.xpath(`//button[normalize-space(.)='Back']`))
          await back.click()
          await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${a.id}(?:\\?|#|$)`))
          await waitVisible(app.driver, By.css(promptSelector))

          await wdOpenSidebar(app.driver)
          const third = await waitVisible(app.driver, By.css(`[data-session-id="${c.id}"] a`))
          await third.click()
          await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${c.id}(?:\\?|#|$)`))
          await waitVisible(app.driver, By.css(promptSelector))

          const forward = await waitVisible(app.driver, By.xpath(`//button[normalize-space(.)='Forward']`))
          expect(await forward.isEnabled()).toBe(false)
        })
      })
    })
  })

  test("keyboard shortcuts navigate titlebar history", async () => {
    await app.driver.manage().window().setRect({ width: 1400, height: 800, x: 0, y: 0 })
    const slug = app.project.id
    const stamp = Date.now()
    const mod = process.platform === "darwin" ? Key.META : Key.CONTROL

    await withSession(app.sdk, `e2e titlebar shortcuts 1 ${stamp}`, async (one) => {
      await withSession(app.sdk, `e2e titlebar shortcuts 2 ${stamp}`, async (two) => {
        await app.gotoSession(one.id)
        await wdOpenSidebar(app.driver)

        const link = await waitVisible(app.driver, By.css(`[data-session-id="${two.id}"] a`))
        await link.click()
        await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await waitVisible(app.driver, By.css(promptSelector))

        await wdDefocus(app.driver)
        await app.driver.actions().keyDown(mod).sendKeys("[").keyUp(mod).perform()
        await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${one.id}(?:\\?|#|$)`))
        await waitVisible(app.driver, By.css(promptSelector))

        await wdDefocus(app.driver)
        await app.driver.actions().keyDown(mod).sendKeys("]").keyUp(mod).perform()
        await waitUrlMatches(app.driver, new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await waitVisible(app.driver, By.css(promptSelector))
      })
    })
  })
})
