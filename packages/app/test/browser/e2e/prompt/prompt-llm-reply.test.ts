import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { cleanupSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

describe("prompt llm reply", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "can send a prompt and receive a reply",
    async () => {
      const page = app.page
      const pageErrors: string[] = []
      const onPageError = (err: Error) => {
        pageErrors.push(err.message)
      }
      page.on("pageerror", onPageError)

      const sessionResult = await app.sdk.session.create({})
      if (!sessionResult.data) throw new Error("Failed to create session")
      const sessionID = sessionResult.data.id

      await app.gotoSession(sessionID)

      const token = `E2E_OK_${Date.now()}`

      const prompt = page.locator(promptSelector)
      await prompt.click()
      await page.keyboard.type(`Reply with exactly: ${token}`)
      await page.keyboard.press("Enter")

      await new Promise((r) => setTimeout(r, 2000))

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
        page.off("pageerror", onPageError)
        await cleanupSession({ sdk: app.sdk, sessionID })
      }

      if (pageErrors.length > 0) throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
    },
    120_000,
  )
})
