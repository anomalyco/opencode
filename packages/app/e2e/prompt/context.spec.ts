import { test, expect } from "../fixtures"
import type { Page } from "@playwright/test"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

function contextButton(page: Page) {
  return page
    .locator('[data-component="button"]')
    .filter({ has: page.locator('[data-component="progress-circle"]').first() })
    .first()
}

async function seedContextSession(input: { sessionID: string; sdk: Parameters<typeof withSession>[0] }) {
  await input.sdk.session.promptAsync({
    sessionID: input.sessionID,
    noReply: true,
    parts: [
      {
        type: "text",
        text: "seed context",
      },
    ],
  })

  await expect
    .poll(async () => {
      const messages = await input.sdk.session
        .messages({ sessionID: input.sessionID, limit: 1 })
        .then((r) => r.data ?? [])
      return messages.length
    })
    .toBeGreaterThan(0)
}

test("context panel can be opened from the prompt", async ({ page, sdk, gotoSession }) => {
  const title = `e2e smoke context ${Date.now()}`

  await withSession(sdk, title, async (session) => {
    await seedContextSession({ sessionID: session.id, sdk })

    await gotoSession(session.id)

    const trigger = contextButton(page)
    await expect(trigger).toBeVisible()
    await trigger.click()

    const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
    await expect(tabs.getByRole("tab", { name: "Context" })).toBeVisible()
  })
})

test("context panel can be closed from the context tab close action", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, `e2e context toggle ${Date.now()}`, async (session) => {
    await seedContextSession({ sessionID: session.id, sdk })
    await gotoSession(session.id)

    await page.locator(promptSelector).click()

    const trigger = contextButton(page)
    await expect(trigger).toBeVisible()
    await trigger.click()

    const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
    const context = tabs.getByRole("tab", { name: "Context" })
    await expect(context).toBeVisible()

    await page.getByRole("button", { name: "Close tab" }).first().click()
    await expect(context).toHaveCount(0)
  })
})

test("context panel can open file picker from context actions", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, `e2e context tabs ${Date.now()}`, async (session) => {
    await seedContextSession({ sessionID: session.id, sdk })
    await gotoSession(session.id)

    await page.locator(promptSelector).click()

    const trigger = contextButton(page)
    await expect(trigger).toBeVisible()
    await trigger.click()

    await expect(page.getByRole("tab", { name: "Context" })).toBeVisible()
    await page.getByRole("button", { name: "Open file" }).first().click()

    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByPlaceholder(/search files/i) })
      .first()
    await expect(dialog).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  })
})
