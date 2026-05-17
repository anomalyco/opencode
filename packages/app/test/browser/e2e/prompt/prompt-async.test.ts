import { beforeAll, describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import { cleanupSession, sessionIDFromUrl, withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import {
  clearWdPromptFetch,
  ensureWdPromptFetchShim,
  prepareWdPromptFetchAbort,
  prepareWdPromptFetchAsync500,
} from "../../support/wd-prompt-fetch-shim"
import { waitVisible } from "../../support/wd-wait"
import { openProjectSession, useAppWebDriver } from "../../support/use-app-webdriver"

function normPromptText(raw: string | null) {
  if (!raw) return ""
  return raw.replace(/\u200B/g, "").trim()
}

describe("prompt async (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  beforeAll(async () => {
    await ensureWdPromptFetchShim(app.driver)
  })

  test(
    "prompt succeeds when sync message endpoint is unreachable",
    async () => {
      await clearWdPromptFetch(app.driver)
      await app.driver.get(app.origin)
      await prepareWdPromptFetchAbort(app.driver)
      await openProjectSession(app.driver, app.origin, app.project.id)

      const token = `E2E_ASYNC_${Date.now()}`
      const prompt = await waitVisible(app.driver, By.css(promptSelector))
      await prompt.click()
      await prompt.sendKeys(`Reply with exactly: ${token}`)
      await app.driver.actions().sendKeys(Key.ENTER).perform()

      await app.driver.wait(async () => /\/session\/[^/?#]+/.test(await app.driver.getCurrentUrl()), 30_000)
      const sid = sessionIDFromUrl(await app.driver.getCurrentUrl())
      if (!sid) throw new Error("session id missing")

      try {
        await app.driver.wait(
          async () => {
            const messages = await app.sdk.session.messages({ sessionID: sid, limit: 50 }).then((r) => r.data ?? [])
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
        await cleanupSession({ sdk: app.sdk, sessionID: sid })
        await clearWdPromptFetch(app.driver)
      }
    },
    120_000,
  )

  test("failed prompt send restores the composer input", async () => {
    await withSession(app.sdk, `e2e prompt failure ${Date.now()}`, async (session) => {
      await clearWdPromptFetch(app.driver)
      await app.driver.get(app.origin)
      await prepareWdPromptFetchAsync500(app.driver, session.id)
      await openProjectSession(app.driver, app.origin, app.project.id, session.id)

      const prompt = await waitVisible(app.driver, By.css(promptSelector))
      await prompt.click()
      const value = `restore ${Date.now()}`
      await prompt.sendKeys(value)
      await app.driver.actions().sendKeys(Key.ENTER).perform()

      await app.driver.wait(async () => normPromptText(await prompt.getText()) === value, 15_000)

      await app.driver.wait(
        async () => {
          const messages = await app.sdk.session.messages({ sessionID: session.id, limit: 50 }).then((r) => r.data ?? [])
          return messages.length === 0
        },
        15_000,
      )

      await clearWdPromptFetch(app.driver)
    })
  })
})
