import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { defocus, openSidebar, withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { modKey } from "../../../../e2e/utils"

describe("titlebar history", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("titlebar back/forward navigates between sessions", async () => {
    await app.page.setViewportSize({ width: 1400, height: 800 })
    const slug = app.project.id
    const stamp = Date.now()

    await withSession(app.sdk, `e2e titlebar history 1 ${stamp}`, async (one) => {
      await withSession(app.sdk, `e2e titlebar history 2 ${stamp}`, async (two) => {
        await app.gotoSession(one.id)
        await openSidebar(app.page)

        const link = app.page.locator(`[data-session-id="${two.id}"] a`).first()
        await link.waitFor({ state: "visible" })
        await link.click()

        await app.page.waitForURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await app.page.locator(promptSelector).waitFor({ state: "visible" })

        const back = app.page.getByRole("button", { name: "Back" })
        const forward = app.page.getByRole("button", { name: "Forward" })

        await back.waitFor({ state: "visible" })
        expect(await back.isEnabled()).toBe(true)
        await back.click()

        await app.page.waitForURL(new RegExp(`/${slug}/session/${one.id}(?:\\?|#|$)`))
        await app.page.locator(promptSelector).waitFor({ state: "visible" })

        await forward.waitFor({ state: "visible" })
        expect(await forward.isEnabled()).toBe(true)
        await forward.click()

        await app.page.waitForURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await app.page.locator(promptSelector).waitFor({ state: "visible" })
      })
    })
  })

  test("titlebar forward is cleared after branching history from sidebar", async () => {
    await app.page.setViewportSize({ width: 1400, height: 800 })
    const slug = app.project.id
    const stamp = Date.now()

    await withSession(app.sdk, `e2e titlebar history a ${stamp}`, async (a) => {
      await withSession(app.sdk, `e2e titlebar history b ${stamp}`, async (b) => {
        await withSession(app.sdk, `e2e titlebar history c ${stamp}`, async (c) => {
          await app.gotoSession(a.id)
          await openSidebar(app.page)

          const second = app.page.locator(`[data-session-id="${b.id}"] a`).first()
          await second.waitFor({ state: "visible" })
          await second.click()

          await app.page.waitForURL(new RegExp(`/${slug}/session/${b.id}(?:\\?|#|$)`))
          await app.page.locator(promptSelector).waitFor({ state: "visible" })

          const back = app.page.getByRole("button", { name: "Back" })
          const forward = app.page.getByRole("button", { name: "Forward" })

          await back.waitFor({ state: "visible" })
          await back.click()

          await app.page.waitForURL(new RegExp(`/${slug}/session/${a.id}(?:\\?|#|$)`))
          await app.page.locator(promptSelector).waitFor({ state: "visible" })

          await openSidebar(app.page)

          const third = app.page.locator(`[data-session-id="${c.id}"] a`).first()
          await third.waitFor({ state: "visible" })
          await third.click()

          await app.page.waitForURL(new RegExp(`/${slug}/session/${c.id}(?:\\?|#|$)`))
          await app.page.locator(promptSelector).waitFor({ state: "visible" })

          await forward.waitFor({ state: "visible" })
          expect(await forward.isEnabled()).toBe(false)
        })
      })
    })
  })

  test("keyboard shortcuts navigate titlebar history", async () => {
    await app.page.setViewportSize({ width: 1400, height: 800 })
    const slug = app.project.id
    const stamp = Date.now()

    await withSession(app.sdk, `e2e titlebar shortcuts 1 ${stamp}`, async (one) => {
      await withSession(app.sdk, `e2e titlebar shortcuts 2 ${stamp}`, async (two) => {
        await app.gotoSession(one.id)
        await openSidebar(app.page)

        const link = app.page.locator(`[data-session-id="${two.id}"] a`).first()
        await link.waitFor({ state: "visible" })
        await link.click()

        await app.page.waitForURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await app.page.locator(promptSelector).waitFor({ state: "visible" })

        await defocus(app.page)
        await app.page.keyboard.press(`${modKey}+[`)

        await app.page.waitForURL(new RegExp(`/${slug}/session/${one.id}(?:\\?|#|$)`))
        await app.page.locator(promptSelector).waitFor({ state: "visible" })

        await defocus(app.page)
        await app.page.keyboard.press(`${modKey}+]`)

        await app.page.waitForURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
        await app.page.locator(promptSelector).waitFor({ state: "visible" })
      })
    })
  })
})
