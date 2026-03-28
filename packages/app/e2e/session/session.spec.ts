import { test, expect } from "../fixtures"
import {
  openSidebar,
  openSessionMoreMenu,
  clickMenuItem,
  confirmDialog,
  openSharePopover,
  withSession,
} from "../actions"
import { sessionItemSelector, inlineInputSelector } from "../selectors"

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
      async () => {
        const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
        return messages.length
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
}

test("session can be renamed via header menu", async ({ page, sdk, gotoSession }) => {
  const stamp = Date.now()
  const originalTitle = `e2e rename test ${stamp}`
  const renamedTitle = `e2e renamed ${stamp}`

  await withSession(sdk, originalTitle, async (session) => {
    await seedMessage(sdk, session.id)
    await gotoSession(session.id)
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(originalTitle)

    const menu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(menu, /rename/i)

    const input = page.locator(".scroll-view__viewport").locator(inlineInputSelector).first()
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
    await input.fill(renamedTitle)
    await expect(input).toHaveValue(renamedTitle)
    await input.press("Enter")

    await expect
      .poll(
        async () => {
          const data = await sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.title
        },
        { timeout: 30_000 },
      )
      .toBe(renamedTitle)

    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(renamedTitle)
  })
})

test("session can be archived via header menu", async ({ page, sdk, gotoSession }) => {
  const stamp = Date.now()
  const title = `e2e archive test ${stamp}`

  await withSession(sdk, title, async (session) => {
    await seedMessage(sdk, session.id)
    await gotoSession(session.id)
    const menu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(menu, /archive/i)

    await expect
      .poll(
        async () => {
          const data = await sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.time?.archived
        },
        { timeout: 30_000 },
      )
      .not.toBeUndefined()

    await openSidebar(page)
    await expect(page.locator(sessionItemSelector(session.id))).toHaveCount(0)
  })
})

test("session can be deleted via header menu", async ({ page, sdk, gotoSession }) => {
  const stamp = Date.now()
  const title = `e2e delete test ${stamp}`

  await withSession(sdk, title, async (session) => {
    await seedMessage(sdk, session.id)
    await gotoSession(session.id)
    const menu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(menu, /delete/i)
    await confirmDialog(page, /delete/i)

    await expect
      .poll(
        async () => {
          const data = await sdk.session
            .get({ sessionID: session.id })
            .then((r) => r.data)
            .catch(() => undefined)
          return data?.id
        },
        { timeout: 30_000 },
      )
      .toBeUndefined()

    await openSidebar(page)
    await expect(page.locator(sessionItemSelector(session.id))).toHaveCount(0)
  })
})

test("session can be shared and unshared via header button", async ({ page, sdk, gotoSession }) => {
  test.skip(shareDisabled, "Share is disabled in this environment (OPENCODE_DISABLE_SHARE).")

  const stamp = Date.now()
  const title = `e2e share test ${stamp}`

  await withSession(sdk, title, async (session) => {
    await seedMessage(sdk, session.id)
    await gotoSession(session.id)

    const shared = await openSharePopover(page)
    const publish = shared.popoverBody.getByRole("button", { name: "Publish" }).first()
    await expect(publish).toBeVisible({ timeout: 30_000 })
    await publish.click()

    await expect(shared.popoverBody.getByRole("button", { name: "Unpublish" }).first()).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(
        async () => {
          const data = await sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.share?.url || undefined
        },
        { timeout: 30_000 },
      )
      .not.toBeUndefined()

    const unpublish = shared.popoverBody.getByRole("button", { name: "Unpublish" }).first()
    await expect(unpublish).toBeVisible({ timeout: 30_000 })
    await unpublish.click()

    await expect(shared.popoverBody.getByRole("button", { name: "Publish" }).first()).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(
        async () => {
          const data = await sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.share?.url || undefined
        },
        { timeout: 30_000 },
      )
      .toBeUndefined()

    const unshared = await openSharePopover(page)
    await expect(unshared.popoverBody.getByRole("button", { name: "Publish" }).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
