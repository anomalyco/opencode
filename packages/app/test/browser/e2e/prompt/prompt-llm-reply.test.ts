import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import { cleanupSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("prompt llm reply (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test(
    "can send a prompt and receive a reply",
    async () => {
      const sessionResult = await app.sdk.session.create({})
      if (!sessionResult.data) throw new Error("Failed to create session")
      const sessionID = sessionResult.data.id

      await app.gotoSession(sessionID)

      await app.driver.executeScript(`
        window.__e2ePageErrors = [];
        window.addEventListener("error", function (e) {
          window.__e2ePageErrors.push(e.message || (e.error && e.error.stack) || String(e.error));
        });
      `)

      const prompt = await waitVisible(app.driver, By.css(promptSelector))
      await prompt.click()
      const token = `E2E_OK_${Date.now()}`
      await prompt.sendKeys(`Reply with exactly: ${token}`)
      await app.driver.actions().sendKeys(Key.ENTER).perform()

      await new Promise((r) => setTimeout(r, 2000))

      try {
        await app.driver.wait(
          async () => {
            const messages = await app.sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
            const text = messages
              .filter((m) => m.info.role === "assistant")
              .flatMap((m) => m.parts)
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
            return text.includes(token)
          },
          90_000,
        )
      } finally {
        await cleanupSession({ sdk: app.sdk, sessionID })
      }

      const errs = await app.driver.executeScript(`return window.__e2ePageErrors || []`)
      expect(Array.isArray(errs) ? errs.length : 0).toBe(0)
    },
    120_000,
  )
})
