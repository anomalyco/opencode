import { test, expect } from "./fixtures"
import { modKey, promptSelector } from "./utils"

test("titlebar back/forward navigates between sessions", async ({ page, slug, sdk, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const stamp = Date.now()
  const one = await sdk.session.create({ title: `e2e titlebar history 1 ${stamp}` }).then((r) => r.data)
  const two = await sdk.session.create({ title: `e2e titlebar history 2 ${stamp}` }).then((r) => r.data)

  if (!one?.id) throw new Error("Session create did not return an id")
  if (!two?.id) throw new Error("Session create did not return an id")

  try {
    await gotoSession(one.id)

    const main = page.locator("main")
    const collapsed = ((await main.getAttribute("class")) ?? "").includes("xl:border-l")
    if (collapsed) {
      await page.keyboard.press(`${modKey}+B`)
      await expect(main).not.toHaveClass(/xl:border-l/)
    }

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
  } finally {
    await sdk.session.delete({ sessionID: one.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: two.id }).catch(() => undefined)
  }
})
