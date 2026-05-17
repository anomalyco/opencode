import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { seedSessionTask, withSession } from "../../../../e2e/actions"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("session child navigation (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test(
    "task tool child-session link does not trigger stale show errors",
    async () => {
      await withSession(app.sdk, `e2e child nav ${Date.now()}`, async (session) => {
        const child = await seedSessionTask(app.sdk, {
          sessionID: session.id,
          description: "Open child session",
          prompt: "Search the repository for AssistantParts and then reply with exactly CHILD_OK.",
        })

        await app.gotoSession(session.id)

        await app.driver.executeScript(`
          window.__e2ePageErrors = [];
          window.addEventListener("error", function (e) {
            window.__e2ePageErrors.push(e.message || String(e.error));
          });
        `)

        const link = await app.driver.wait(
          async () => {
            const xs = await app.driver.findElements(By.css("a.subagent-link"))
            for (const el of xs) {
              const t = await el.getText()
              if (/open child session/i.test(t)) return el
            }
            return undefined
          },
          30_000,
        )
        if (!link) throw new Error("subagent link not found")
        await link.click()

        await app.driver.wait(
          async () => new RegExp(`/session/${child.sessionID}(?:[/?#]|$)`).test(await app.driver.getCurrentUrl()),
          30_000,
        )
        await new Promise((r) => setTimeout(r, 1000))

        const errs = (await app.driver.executeScript(`return window.__e2ePageErrors || []`)) as string[]
        expect(errs).toEqual([])
      })
    },
    120_000,
  )
})
