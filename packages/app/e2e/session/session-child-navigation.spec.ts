import { seedSessionTask, withSession } from "../actions"
import { test, expect } from "../fixtures"

test("task tool child-session link does not trigger stale show errors", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const errs: string[] = []
  const onError = (err: Error) => {
    errs.push(err.message)
  }
  page.on("pageerror", onError)

  await withSession(sdk, `e2e child nav ${Date.now()}`, async (session) => {
    const child = await seedSessionTask(sdk, {
      sessionID: session.id,
      description: "Open child session",
      prompt: "Search the repository for AssistantParts and then reply with exactly CHILD_OK.",
    })

    try {
      await gotoSession(session.id)

      const link = page
        .locator("a.subagent-link")
        .filter({ hasText: /open child session/i })
        .first()
      await expect(link).toBeVisible({ timeout: 30_000 })
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/session/${child.sessionID}(?:[/?#]|$)`), { timeout: 30_000 })
      await page.waitForTimeout(1000)
      expect(errs).toEqual([])
    } finally {
      page.off("pageerror", onError)
    }
  })
})
