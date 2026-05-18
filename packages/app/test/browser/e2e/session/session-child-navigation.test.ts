import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { seedSessionTask, withSession } from "../../../../e2e/actions"

describe("session child navigation", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "task tool child-session link does not trigger stale show errors",
    async () => {
      const page = app.page
      const errs: string[] = []
      const onError = (err: Error) => {
        errs.push(err.message)
      }
      page.on("pageerror", onError)

      await withSession(app.sdk, `e2e child nav ${Date.now()}`, async (session) => {
        const child = await seedSessionTask(app.sdk, {
          sessionID: session.id,
          description: "Open child session",
          prompt: "Search the repository for AssistantParts and then reply with exactly CHILD_OK.",
        })

        try {
          await app.gotoSession(session.id)

          const link = page.locator("a.subagent-link").filter({ hasText: /open child session/i }).first()
          await link.waitFor({ state: "visible", timeout: 30_000 })
          await link.click()

          await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(new RegExp(`/session/${child.sessionID}(?:[/?#]|$)`))
          await new Promise((r) => setTimeout(r, 1000))
          expect(errs).toEqual([])
        } finally {
          page.off("pageerror", onError)
        }
      })
    },
    120_000,
  )
})
