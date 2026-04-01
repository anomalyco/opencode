import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

const shareDisabled = process.env.OPENCODE_DISABLE_SHARE === "true" || process.env.OPENCODE_DISABLE_SHARE === "1"

async function seed(sdk: Parameters<typeof withSession>[0], sessionID: string) {
  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    parts: [{ type: "text", text: "e2e share seed" }],
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

test("/share and /unshare update session share state", async ({ page, withBackendProject }) => {
  test.skip(shareDisabled, "Share is disabled in this environment (OPENCODE_DISABLE_SHARE).")

  await withBackendProject(async (project) => {
    await withSession(project.sdk, `e2e slash share ${Date.now()}`, async (session) => {
      project.trackSession(session.id)
      const prompt = page.locator(promptSelector)

      await seed(project.sdk, session.id)
      await project.gotoSession(session.id)

      await prompt.click()
      await page.keyboard.type("/share")
      await expect(page.locator('[data-slash-id="session.share"]').first()).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(
          async () => {
            const data = await project.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
            return data?.share?.url || undefined
          },
          { timeout: 30_000 },
        )
        .not.toBeUndefined()

      await prompt.click()
      await page.keyboard.type("/unshare")
      await expect(page.locator('[data-slash-id="session.unshare"]').first()).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(
          async () => {
            const data = await project.sdk.session.get({ sessionID: session.id }).then((r) => r.data)
            return data?.share?.url || undefined
          },
          { timeout: 30_000 },
        )
        .toBeUndefined()
    })
  })
})
