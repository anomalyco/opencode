import { test, expect } from "./fixtures"
import { modKey, promptSelector } from "./utils"

type Locator = {
  first: () => Locator
  getAttribute: (name: string) => Promise<string | null>
  scrollIntoViewIfNeeded: () => Promise<void>
  click: () => Promise<void>
}

type Page = {
  locator: (selector: string) => Locator
  keyboard: {
    press: (key: string) => Promise<void>
  }
}

type Fixtures = {
  page: Page
  slug: string
  sdk: {
    session: {
      create: (input: { title: string }) => Promise<{ data?: { id?: string } }>
      delete: (input: { sessionID: string }) => Promise<unknown>
    }
  }
  gotoSession: (sessionID?: string) => Promise<void>
}

test("sidebar session links navigate to the selected session", async ({ page, slug, sdk, gotoSession }: Fixtures) => {
  const stamp = Date.now()

  const one = await sdk.session.create({ title: `e2e sidebar nav 1 ${stamp}` }).then((r) => r.data)
  const two = await sdk.session.create({ title: `e2e sidebar nav 2 ${stamp}` }).then((r) => r.data)

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

    const target = page.locator(`[data-session-id="${two.id}"] a`).first()
    await expect(target).toBeVisible()
    await target.scrollIntoViewIfNeeded()
    await target.click()

    await expect(page).toHaveURL(new RegExp(`/${slug}/session/${two.id}(?:\\?|#|$)`))
    await expect(page.locator(promptSelector)).toBeVisible()
    await expect(page.locator(`[data-session-id="${two.id}"] a`).first()).toHaveClass(/\bactive\b/)
  } finally {
    await sdk.session.delete({ sessionID: one.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: two.id }).catch(() => undefined)
  }
})
