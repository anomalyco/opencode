import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { cleanupSession, sessionIDFromUrl, withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

const text = (value: string | null) => (value ?? "").replace(/\u200B/g, "").trim()

describe("prompt async", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "prompt succeeds when sync message endpoint is unreachable",
    async () => {
      const page = app.page
      const abort = (route: import("playwright").Route) => route.abort("connectionfailed")
      await page.route("**/session/*/message", abort)

      await app.gotoSession()

      const token = `E2E_ASYNC_${Date.now()}`
      await page.locator(promptSelector).click()
      await page.keyboard.type(`Reply with exactly: ${token}`)
      await page.keyboard.press("Enter")

      await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/session\/[^/?#]+/)
      const sessionID = sessionIDFromUrl(page.url())
      if (!sessionID) throw new Error("session id missing")

      try {
        await expect
          .poll(
            async () => {
              const messages = await app.sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
              return messages
                .filter((m) => m.info.role === "assistant")
                .flatMap((m) => m.parts)
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n")
            },
            { timeout: 90_000 },
          )
          .toContain(token)
      } finally {
        await cleanupSession({ sdk: app.sdk, sessionID })
        await page.unroute("**/session/*/message", abort)
      }
    },
    120_000,
  )

  test("failed prompt send restores the composer input", async () => {
    await withSession(app.sdk, `e2e prompt failure ${Date.now()}`, async (session) => {
      const page = app.page
      const prompt = page.locator(promptSelector)
      const value = `restore ${Date.now()}`

      const fail = (route: import("playwright").Route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "e2e prompt failure" }),
        })

      await page.route(`**/session/${session.id}/prompt_async`, fail)

      await app.gotoSession(session.id)
      await prompt.click()
      await page.keyboard.type(value)
      await page.keyboard.press("Enter")

      await expect.poll(async () => text(await prompt.textContent())).toBe(value)
      await expect
        .poll(
          async () => {
            const messages = await app.sdk.session
              .messages({ sessionID: session.id, limit: 50 })
              .then((r) => r.data ?? [])
            return messages.length
          },
          { timeout: 15_000 },
        )
        .toBe(0)

      await page.unroute(`**/session/${session.id}/prompt_async`, fail)
    })
  })
})
