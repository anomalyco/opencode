import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import {
  clickMenuItem,
  confirmDialog,
  openSessionMoreMenu,
  openSharePopover,
  openSidebar,
  withSession,
} from "../../../../e2e/actions"
import { inlineInputSelector, sessionItemSelector } from "../../../../e2e/selectors"

const shareDisabled = process.env.OPENCODE_DISABLE_SHARE === "true" || process.env.OPENCODE_DISABLE_SHARE === "1"

type Sdk = Parameters<typeof withSession>[0]

async function seedMessage(sdk: Sdk, sessionID: string) {
  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    parts: [{ type: "text", text: "e2e seed" }],
  })

  await expect
    .poll(
      async () => sdk.session.messages({ sessionID, limit: 1 }).then((r) => (r.data ?? []).length),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
}

describe("session header menu", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("session can be renamed via header menu", async () => {
    const page = app.page
    const stamp = Date.now()
    const originalTitle = `e2e rename test ${stamp}`
    const renamedTitle = `e2e renamed ${stamp}`

    await withSession(app.sdk, originalTitle, async (session) => {
      await seedMessage(app.sdk, session.id)
      await app.gotoSession(session.id)
      expect((await page.getByRole("heading", { level: 1 }).first().textContent())?.trim()).toBe(originalTitle)

      const menu = await openSessionMoreMenu(page, session.id)
      await clickMenuItem(menu, /rename/i)

      const input = page.locator(".scroll-view__viewport").locator(inlineInputSelector).first()
      await input.waitFor({ state: "visible" })
      await expect
        .poll(async () => input.evaluate((el) => document.activeElement === el))
        .toBe(true)
      await input.fill(renamedTitle)
      expect(await input.inputValue()).toBe(renamedTitle)
      await input.press("Enter")

      await expect
        .poll(async () => {
          const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.title
        }, { timeout: 30_000 })
        .toBe(renamedTitle)

      expect((await page.getByRole("heading", { level: 1 }).first().textContent())?.trim()).toBe(renamedTitle)
    })
  })

  test("session can be archived via header menu", async () => {
    const page = app.page
    const stamp = Date.now()
    const title = `e2e archive test ${stamp}`

    await withSession(app.sdk, title, async (session) => {
      await seedMessage(app.sdk, session.id)
      await app.gotoSession(session.id)
      const menu = await openSessionMoreMenu(page, session.id)
      await clickMenuItem(menu, /archive/i)

      await expect
        .poll(async () => {
          const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.time?.archived
        }, { timeout: 30_000 })
        .not.toBeUndefined()

      await openSidebar(page)
      expect(await page.locator(sessionItemSelector(session.id)).count()).toBe(0)
    })
  })

  test("session can be deleted via header menu", async () => {
    const page = app.page
    const stamp = Date.now()
    const title = `e2e delete test ${stamp}`

    await withSession(app.sdk, title, async (session) => {
      await seedMessage(app.sdk, session.id)
      await app.gotoSession(session.id)
      const menu = await openSessionMoreMenu(page, session.id)
      await clickMenuItem(menu, /delete/i)
      await confirmDialog(page, /delete/i)

      await expect
        .poll(async () => {
          const data = await app.sdk.session
            .get({ sessionID: session.id })
            .then((r) => r.data)
            .catch(() => undefined)
          return data?.id
        }, { timeout: 30_000 })
        .toBeUndefined()

      await openSidebar(page)
      expect(await page.locator(sessionItemSelector(session.id)).count()).toBe(0)
    })
  })

  test("session can be shared and unshared via header button", async () => {
    if (shareDisabled) return

    const page = app.page
    const stamp = Date.now()
    const title = `e2e share test ${stamp}`

    await withSession(app.sdk, title, async (session) => {
      await seedMessage(app.sdk, session.id)
      await app.gotoSession(session.id)

      const shared = await openSharePopover(page)
      const publish = shared.popoverBody.getByRole("button", { name: "Publish" }).first()
      await publish.waitFor({ state: "visible", timeout: 30_000 })
      await publish.click()

      await shared.popoverBody.getByRole("button", { name: "Unpublish" }).first().waitFor({ state: "visible", timeout: 30_000 })

      await expect
        .poll(async () => {
          const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          const u = data?.share?.url
          return u !== undefined && u !== ""
        }, { timeout: 30_000 })
        .toBe(true)

      const unpublish = shared.popoverBody.getByRole("button", { name: "Unpublish" }).first()
      await unpublish.waitFor({ state: "visible", timeout: 30_000 })
      await unpublish.click()

      await shared.popoverBody.getByRole("button", { name: "Publish" }).first().waitFor({ state: "visible", timeout: 30_000 })

      await expect
        .poll(async () => {
          const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          const u = data?.share?.url
          return u === undefined || u === ""
        }, { timeout: 30_000 })
        .toBe(true)

      const unshared = await openSharePopover(page)
      await unshared.popoverBody.getByRole("button", { name: "Publish" }).first().waitFor({ state: "visible", timeout: 30_000 })
    })
  })
})
