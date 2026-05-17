import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import { cleanupSession } from "../../../e2e/actions"
import { promptSelector } from "../../../e2e/selectors"
import { waitVisible } from "../support/wd-wait"
import { useAppWebDriver } from "../support/use-app-webdriver"

describe("ai sdk relay (webdriver)", () => {
  const app = useAppWebDriver()

  test(
    "AI can call SDK through relay",
    async () => {
      await app.driver.executeScript(`
        window.__e2ePageErrors = [];
        window.addEventListener("error", function (e) {
          window.__e2ePageErrors.push(e.message);
        });
      `)

      const sessionResult = await app.sdk.session.create({})
      if (!sessionResult.data) throw new Error("Failed to create session")
      const sessionID = sessionResult.data.id

      await app.gotoSession(sessionID)

      await app.driver.executeScript(`
        window.__e2ePageErrors = [];
        window.addEventListener("error", function (e) {
          window.__e2ePageErrors.push(e.message);
        });
      `)

      const prompt = await waitVisible(app.driver, By.css(promptSelector))
      await prompt.click()
      await prompt.sendKeys(
        "Generate Python code that uses the opencode SDK to check if the browser is connected. " +
          "The code should import the SDK, connect to the relay, and print the connection status.",
      )
      await app.driver.actions().sendKeys(Key.ENTER).perform()

      await new Promise((r) => setTimeout(r, 3000))

      try {
        await app.driver.wait(
          async () => {
            const messages = (await app.sdk.session.messages({ sessionID, limit: 50 })).data ?? []
            const assistantMessages = messages.filter((m) => m.info.role === "assistant")
            for (const msg of assistantMessages) {
              const textParts = msg.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n")
              if (textParts.includes("import") && (textParts.includes("opencode") || textParts.includes("sdk"))) return true
            }
            return false
          },
          60_000,
        )

        await app.driver.wait(
          async () => {
            const messages = (await app.sdk.session.messages({ sessionID, limit: 50 })).data ?? []
            const assistantMessages = messages.filter((m) => m.info.role === "assistant")
            for (const msg of assistantMessages) {
              const textParts = msg.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n")
              if (/relay|browser|connect/i.test(textParts)) return true
            }
            return false
          },
          30_000,
        )
      } finally {
        await cleanupSession({ sdk: app.sdk, sessionID })
      }

      const errs = await app.driver.executeScript(`return window.__e2ePageErrors || []`)
      if (Array.isArray(errs) && errs.length > 0) {
        console.log("[ai-sdk-relay] page errors:", errs)
      }
    },
    120_000,
  )
})
