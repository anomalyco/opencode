import { test, expect } from "../fixtures"
import { defocus, openSidebar, withSession } from "../actions"
import { promptSelector } from "../selectors"
import { modKey } from "../utils"

test("titlebar back/forward navigates between sessions", async ({ page, slug, sdk, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const stamp = Date.now()

  await withSession(sdk, `e2e titlebar history 1 ${stamp}`, async (one) => {
    await withSession(sdk, `e2e titlebar history 2 ${stamp}`, async (two) => {
      await gotoSession(one.id)

      await openSidebar(page)

      const link = page.locator(`[data-session-id="${two.id}"] a`).first()
      await expect(link).toBeVisible()
      await link.scrollIntoViewIfNeeded()
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
      await expect(page.locator(promptSelector)).toBeVisible()

      const back = page.getByRole("button", { name: "Back" })
      const forward = page.getByRole("button", { name: "Forward" })

      await expect(back).toBeVisible()
      await expect(back).toBeEnabled()
      await back.click()

      await expect(page).toHaveURL(new RegExp(`/${slug}/session/${one.id}(?:\\?|#|$)`))
      await expect(page.locator(promptSelector)).toBeVisible()

      await expect(forward).toBeVisible()
      await expect(forward).toBeEnabled()
      await forward.click()

      await expect(page).toHaveURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })
})

test("titlebar forward is cleared after branching history from sidebar", async ({ page, slug, sdk, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const stamp = Date.now()

  await withSession(sdk, `e2e titlebar history a ${stamp}`, async (a) => {
    await withSession(sdk, `e2e titlebar history b ${stamp}`, async (b) => {
      await withSession(sdk, `e2e titlebar history c ${stamp}`, async (c) => {
        await gotoSession(a.id)

        await openSidebar(page)

        const second = page.locator(`[data-session-id="${b.id}"] a`).first()
        await expect(second).toBeVisible()
        await second.scrollIntoViewIfNeeded()
        await second.click()

        await expect(page).toHaveURL(new RegExp(`/${slug}/session/${b.id}(?:\\?|#|$)`))
        await expect(page.locator(promptSelector)).toBeVisible()

        const back = page.getByRole("button", { name: "Back" })
        const forward = page.getByRole("button", { name: "Forward" })

        await expect(back).toBeVisible()
        await expect(back).toBeEnabled()
        await back.click()

        await expect(page).toHaveURL(new RegExp(`/${slug}/session/${a.id}(?:\\?|#|$)`))
        await expect(page.locator(promptSelector)).toBeVisible()

        await openSidebar(page)

        const third = page.locator(`[data-session-id="${c.id}"] a`).first()
        await expect(third).toBeVisible()
        await third.scrollIntoViewIfNeeded()
        await third.click()

        await expect(page).toHaveURL(new RegExp(`/${slug}/session/${c.id}(?:\\?|#|$)`))
        await expect(page.locator(promptSelector)).toBeVisible()

        await expect(forward).toBeVisible()
        await expect(forward).toBeDisabled()
      })
    })
  })
})

test("keyboard shortcuts navigate titlebar history", async ({ page, slug, sdk, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const stamp = Date.now()

  await withSession(sdk, `e2e titlebar shortcuts 1 ${stamp}`, async (one) => {
    await withSession(sdk, `e2e titlebar shortcuts 2 ${stamp}`, async (two) => {
      await gotoSession(one.id)

      await openSidebar(page)

      const link = page.locator(`[data-session-id="${two.id}"] a`).first()
      await expect(link).toBeVisible()
      await link.scrollIntoViewIfNeeded()
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
      await expect(page.locator(promptSelector)).toBeVisible()

      await defocus(page)
      await page.keyboard.press(`${modKey}+[`)

      await expect(page).toHaveURL(new RegExp(`/${slug}/session/${one.id}(?:\\?|#|$)`))
      await expect(page.locator(promptSelector)).toBeVisible()

      await defocus(page)
      await page.keyboard.press(`${modKey}+]`)

      await expect(page).toHaveURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })
})
