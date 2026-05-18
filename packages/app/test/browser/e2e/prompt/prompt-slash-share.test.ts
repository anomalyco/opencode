import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

const shareDisabled = process.env.OPENCODE_DISABLE_SHARE === "true" || process.env.OPENCODE_DISABLE_SHARE === "1"

async function seed(sdk: Parameters<typeof withSession>[0], sessionID: string) {
  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    parts: [{ type: "text", text: "e2e share seed" }],
  })

  await expect
    .poll(async () => sdk.session.messages({ sessionID, limit: 1 }).then((r) => (r.data ?? []).length), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0)
}

describe("prompt slash share", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("/share and /unshare update session share state", async () => {
    if (shareDisabled) return

    const page = app.page
    await withSession(app.sdk, `e2e slash share ${Date.now()}`, async (session) => {
      const prompt = page.locator(promptSelector)

      await seed(app.sdk, session.id)
      await app.gotoSession(session.id)

      await prompt.click()
      await page.keyboard.type("/share")
      await page.locator('[data-slash-id="session.share"]').first().waitFor({ state: "visible" })
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => {
          const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.share?.url || undefined
        }, { timeout: 30_000 })
        .not.toBeUndefined()

      await prompt.click()
      await page.keyboard.type("/unshare")
      await page.locator('[data-slash-id="session.unshare"]').first().waitFor({ state: "visible" })
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => {
          const data = await app.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
          return data?.share?.url || undefined
        }, { timeout: 30_000 })
        .toBeUndefined()
    })
  })
})
