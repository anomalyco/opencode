import { describe, expect, test } from "vitest"
import { useE2eStack } from "../support/use-e2e-stack"

import { By, pollOk, waitVisible } from "../support/wd-wait"
import { cleanupSession } from "../../../e2e/actions"
import { promptSelector } from "../../../e2e/selectors"
import { useAppBrowser } from "../support/use-app-browser"

describe("ai sdk relay (webdriver)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "AI can call SDK through relay",
    async () => {
      await app.page.evaluate(() => {
        const w = window as Window & { __e2ePageErrors?: string[] }
        w.__e2ePageErrors = []
        window.addEventListener("error", (e) => {
          w.__e2ePageErrors!.push(e.message)
        })
      })

      const sessionResult = await app.sdk.session.create({})
      if (!sessionResult.data) throw new Error("Failed to create session")
      const sessionID = sessionResult.data.id

      await app.gotoSession(sessionID)

      await app.page.evaluate(() => {
        const w = window as Window & { __e2ePageErrors?: string[] }
        w.__e2ePageErrors = []
        window.addEventListener("error", (e) => {
          w.__e2ePageErrors!.push(e.message)
        })
      })

      const prompt = await waitVisible(app.page, By.css(promptSelector))
      await prompt.click()
      await prompt.fill(
        "Generate Python code that uses the opencode SDK to check if the browser is connected. " +
          "The code should import the SDK, connect to the relay, and print the connection status.",
      )
      await app.page.keyboard.press("Enter")

      await new Promise((r) => setTimeout(r, 3000))

      try {
        await pollOk(
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
          180_000,
        )

        await pollOk(
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
          120_000,
        )
      } finally {
        await cleanupSession({ sdk: app.sdk, sessionID })
      }

      const errs = await app.page.evaluate(() => {
        const w = window as Window & { __e2ePageErrors?: string[] }
        return w.__e2ePageErrors ?? []
      })
      expect(Array.isArray(errs) ? errs : []).toEqual([])
    },
    420_000,
  )
})
