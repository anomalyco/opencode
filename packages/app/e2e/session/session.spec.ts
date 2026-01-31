import { test, expect } from "../fixtures"
import {
  openSidebar,
  openSessionMoreMenu,
  clickMenuItem,
  confirmDialog,
  openSharePopover,
  clickPopoverButton,
  withSession,
} from "../actions"
import { sessionItemSelector, inlineInputSelector } from "../selectors"

test("sidebar session can be renamed", async ({ page, sdk, gotoSession }) => {
  const stamp = Date.now()
  const originalTitle = `e2e rename test ${stamp}`
  const newTitle = `e2e renamed ${stamp}`

  await withSession(sdk, originalTitle, async (session) => {
    await gotoSession(session.id)
    await openSidebar(page)

    const menu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(menu, /rename/i)

    const input = page.locator(sessionItemSelector(session.id)).locator(inlineInputSelector).first()
    await expect(input).toBeVisible()
    await input.fill(newTitle)
    await input.press("Enter")

    await expect(page.locator(sessionItemSelector(session.id)).locator("a").first()).toContainText(newTitle)
  })
})

test("sidebar session can be archived", async ({ page, sdk, gotoSession }) => {
  const stamp = Date.now()
  const title = `e2e archive test ${stamp}`

  await withSession(sdk, title, async (session) => {
    await gotoSession(session.id)
    await openSidebar(page)

    const sessionEl = page.locator(sessionItemSelector(session.id))
    const menu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(menu, /archive/i)

    await expect(sessionEl).not.toBeVisible()
  })
})

test("sidebar session can be deleted", async ({ page, sdk, gotoSession }) => {
  const stamp = Date.now()
  const title = `e2e delete test ${stamp}`

  await withSession(sdk, title, async (session) => {
    await gotoSession(session.id)
    await openSidebar(page)

    const sessionEl = page.locator(sessionItemSelector(session.id))
    const menu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(menu, /delete/i)
    await confirmDialog(page, /delete/i)

    await expect(sessionEl).not.toBeVisible()
  })
})

test("session can be shared and unshared via header button", async ({ page, sdk, gotoSession }) => {
  const stamp = Date.now()
  const title = `e2e share test ${stamp}`

  await withSession(sdk, title, async (session) => {
    await gotoSession(session.id)

    const { rightSection } = await openSharePopover(page)
    await clickPopoverButton(page, "Publish")

    await expect
      .poll(async () => {
        const data = await sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        return data?.share?.url
      })
      .not.toBeUndefined()

    await gotoSession(session.id)

    await openSharePopover(page)
    await expect(page.getByRole("button", { name: "Unpublish" }).first()).toBeVisible()
    await expect(rightSection.locator('button[aria-label="Copy link"]').first()).toBeVisible()

    await clickPopoverButton(page, "Unpublish")

    await expect
      .poll(async () => {
        const data = await sdk.session.get({ sessionID: session.id }).then((r) => r.data)
        return data?.share?.url
      })
      .toBeUndefined()

    await gotoSession(session.id)

    await openSharePopover(page)
    await expect(page.getByRole("button", { name: "Publish" }).first()).toBeVisible()
    await expect(rightSection.locator('button[aria-label="Copy link"]')).not.toBeVisible()
  })
})
