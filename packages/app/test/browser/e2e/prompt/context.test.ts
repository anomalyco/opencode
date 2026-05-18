import type { Page } from "playwright"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

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
    parts: [{ type: "text", text: "seed context" }],
  })

  await expect
    .poll(
      async () =>
        input.sdk.session.messages({ sessionID: input.sessionID, limit: 1 }).then((r) => (r.data ?? []).length),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
}

describe("context panel", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("context panel can be opened from the prompt", async () => {
    const page = app.page
    const title = `e2e smoke context ${Date.now()}`

    await withSession(app.sdk, title, async (session) => {
      await seedContextSession({ sessionID: session.id, sdk: app.sdk })

      await app.gotoSession(session.id)

      const trigger = contextButton(page)
      await trigger.waitFor({ state: "visible" })
      await trigger.click()

      const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
      await tabs.getByRole("tab", { name: "Context" }).waitFor({ state: "visible" })
    })
  })

  test("context panel can be closed from the context tab close action", async () => {
    const page = app.page
    await withSession(app.sdk, `e2e context toggle ${Date.now()}`, async (session) => {
      await seedContextSession({ sessionID: session.id, sdk: app.sdk })
      await app.gotoSession(session.id)

      await page.locator(promptSelector).click()

      const trigger = contextButton(page)
      await trigger.waitFor({ state: "visible" })
      await trigger.click()

      const tabs = page.locator('[data-component="tabs"][data-variant="normal"]')
      const context = tabs.getByRole("tab", { name: "Context" })
      await context.waitFor({ state: "visible" })

      await page.getByRole("button", { name: "Close tab" }).first().click()
      expect(await context.count()).toBe(0)
    })
  })

  test("context panel can open file picker from context actions", async () => {
    const page = app.page
    await withSession(app.sdk, `e2e context tabs ${Date.now()}`, async (session) => {
      await seedContextSession({ sessionID: session.id, sdk: app.sdk })
      await app.gotoSession(session.id)

      await page.locator(promptSelector).click()

      const trigger = contextButton(page)
      await trigger.waitFor({ state: "visible" })
      await trigger.click()

      await page.getByRole("tab", { name: "Context" }).waitFor({ state: "visible" })
      await page.getByRole("button", { name: "Open file" }).first().click()

      const dialog = page
        .getByRole("dialog")
        .filter({ has: page.getByPlaceholder(/search files/i) })
        .first()
      await dialog.waitFor({ state: "visible" })

      await page.keyboard.press("Escape")
      expect(await dialog.count()).toBe(0)
    })
  })
})
